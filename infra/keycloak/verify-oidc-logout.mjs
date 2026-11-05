// Native T011 acceptance: actual Keycloak Code+PKCE login, signed back-channel logout,
// session restart and JDBC invalidation. Run only against the dedicated Compose TEST stack.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";

const issuer = "http://127.0.0.1:18081/realms/giaokhoa-it";
const database = "jdbc:postgresql://127.0.0.1:15432/giaokhoa_test";
assert.equal(process.env.TEST_KEYCLOAK_BASE_URL, "http://127.0.0.1:18081");
assert.equal(process.env.TEST_KEYCLOAK_REALM, "giaokhoa-it");
assert.equal(process.env.TEST_DATABASE_URL, database);
const schema = "gk_t011_" + randomUUID().replaceAll("-", "").slice(0, 12);
const clientId = "t011-" + randomUUID();
const clientSecret = randomBytes(24).toString("base64url");
const password = randomBytes(24).toString("base64url") + "Aa1!";
const username = "t011-" + randomUUID();
const appJar = resolve("backend/target/giaokhoa-backend-0.0.1-SNAPSHOT.jar");
const keycloakBase = "http://127.0.0.1:18081";
let app;
let clientUuid;
let userId;
let proxy;
let received;
let backendLogs = "";
let schemaCreated = false;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function dockerSql(query) {
    return execFileSync("docker", [
        "exec", "giaokhoa-test-test-app-db-1", "psql",
        "-v", "ON_ERROR_STOP=1", "-U", "giaokhoa_test", "-d", "giaokhoa_test",
        "-Atc", query,
    ], { encoding: "utf8" }).trim();
}

async function fetchAdminToken() {
    const response = await fetch(keycloakBase + "/realms/master/protocol/openid-connect/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "password", client_id: "admin-cli",
            username: "test-admin", password: "test-only-password",
        }),
    });
    assert.equal(response.status, 200, "TEST-only Keycloak admin login");
    return (await response.json()).access_token;
}

async function admin(method, path, body) {
    const response = await fetch(keycloakBase + "/admin/realms/giaokhoa-it" + path, {
        method,
        headers: {
            authorization: "Bearer " + await fetchAdminToken(),
            ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(response.ok, "TEST Keycloak admin " + method + " " + path + ": " + response.status);
    return response;
}

function reservePort() {
    return new Promise((done, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "0.0.0.0", () => {
            const port = server.address().port;
            server.close(() => done(port));
        });
    });
}

async function startBackend(port) {
    const appOrigin = "http://127.0.0.1:" + port;
    const environment = {
        ...process.env,
        SPRING_DATASOURCE_URL: database,
        SPRING_DATASOURCE_USERNAME: "giaokhoa_test",
        SPRING_DATASOURCE_PASSWORD: "test-only-password",
        SPRING_FLYWAY_USER: "giaokhoa_test",
        SPRING_FLYWAY_PASSWORD: "test-only-password",
        OIDC_ISSUER_URI: issuer,
        OIDC_CLIENT_ID: clientId,
        OIDC_CLIENT_SECRET: clientSecret,
        APP_ORIGIN: appOrigin,
        KEYCLOAK_AUTHZ_AUDIENCE: "giaokhoa-it-api",
        KEYCLOAK_ADMIN_BASE_URL: keycloakBase,
        KEYCLOAK_PROVISIONER_CLIENT_ID: "giaokhoa-it-fixtures",
        KEYCLOAK_PROVISIONER_CLIENT_SECRET: "ci-fixtures-only",
    };
    app = spawn("java", [
        "-jar", appJar,
        "--server.address=0.0.0.0",
        "--server.port=" + port,
        "--spring.flyway.schemas=" + schema,
        "--spring.flyway.default-schema=" + schema,
        "--spring.datasource.hikari.schema=" + schema,
    ], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (chunk) => { backendLogs = (backendLogs + chunk.toString()).slice(-12000); };
    app.stdout.on("data", collect);
    app.stderr.on("data", collect);
    for (let retry = 0; retry < 80; retry++) {
        if (app.exitCode !== null) {
            throw new Error("Backend exited during startup: " + backendLogs.slice(-3500));
        }
        try {
            const response = await fetch(appOrigin + "/api/me/workspaces", {
                redirect: "manual", signal: AbortSignal.timeout(1000),
            });
            if (response.status >= 200 && response.status < 500) return appOrigin;
        } catch {
            // Spring/JDBC/Keycloak discovery still starting.
        }
        await sleep(250);
    }
    throw new Error("Backend did not start: " + backendLogs.slice(-3500));
}

async function stopBackend() {
    if (!app) return;
    const instance = app;
    app = undefined;
    if (instance.exitCode === null) {
        const ended = new Promise((done) => instance.once("exit", done));
        instance.kill("SIGTERM");
        await Promise.race([ended, sleep(8000)]);
        if (instance.exitCode === null) instance.kill("SIGKILL");
    }
}

const jars = new Map();
async function browserFetch(url, options = {}) {
    const origin = new URL(url).origin;
    const jar = jars.get(origin) ?? new Map();
    jars.set(origin, jar);
    const headers = new Headers(options.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => k + "=" + v).join("; "));
    const response = await fetch(url, { ...options, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
        const first = cookie.split(";")[0];
        const index = first.indexOf("=");
        if (index > 0) {
            if (/max-age=0/i.test(cookie)) jar.delete(first.slice(0, index));
            else jar.set(first.slice(0, index), first.slice(index + 1));
        }
    }
    return response;
}

async function followRedirects(url, firstResponse) {
    let response = firstResponse;
    for (let step = 0; step < 12; step++) {
        if (!response) response = await browserFetch(url);
        if (response.status < 300 || response.status >= 400) return { url, response };
        const location = response.headers.get("location");
        assert.ok(location, "Redirect is missing Location");
        url = new URL(location, url).href;
        response = await browserFetch(url);
    }
    throw new Error("Unexpected redirect loop");
}

async function login(appOrigin) {
    const started = await followRedirects(appOrigin + "/oauth2/authorization/keycloak");
    assert.equal(started.response.status, 200, "Keycloak login page");
    assert.match(started.url, /\/realms\/giaokhoa-it\//);
    const html = await started.response.text();
    const form = html.match(/<form\b[^>]*id="kc-form-login"[^>]*>/);
    assert.ok(form, "Keycloak test login form was not found");
    const action = form[0].match(/action="([^"]+)"/);
    assert.ok(action, "Keycloak test login action was not found");
    const loginUrl = action[1].replaceAll("&amp;", "&");
    const loggedIn = await browserFetch(loginUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, password }).toString(),
    });
    const returned = await followRedirects(loginUrl, loggedIn);
    assert.equal(new URL(returned.url).origin, appOrigin, "OIDC Code callback must return to Spring");
    const cookie = jars.get(appOrigin)?.get("SESSION");
    assert.match(cookie ?? "", /^[a-f0-9-]{36}$/, "raw SESSION id rather than Base64");
    return cookie;
}

async function signedIdTokenWithoutLogoutEvent(appOrigin) {
    const verifier = randomBytes(32).toString("base64url");
    const nonce = randomBytes(20).toString("base64url");
    const redirectUri = appOrigin + "/oidc-negative-callback";
    const url = new URL(issuer + "/protocol/openid-connect/auth");
    for (const [key, value] of Object.entries({
        response_type: "code", client_id: clientId, redirect_uri: redirectUri,
        scope: "openid", nonce, state: "t011-event-validation",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
    })) url.searchParams.set(key, value);
    // Reuse the real SSO browser session established by the preceding login.
    const authorized = await browserFetch(url.href);
    assert.equal(authorized.status, 302, "Keycloak SSO authorization code");
    const callback = new URL(authorized.headers.get("location"), url);
    assert.equal(callback.origin + callback.pathname, redirectUri);
    const code = callback.searchParams.get("code");
    assert.ok(code);
    const exchanged = await fetch(issuer + "/protocol/openid-connect/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code", client_id: clientId,
            client_secret: clientSecret, redirect_uri: redirectUri,
            code, code_verifier: verifier,
        }),
    });
    assert.equal(exchanged.status, 200, "Keycloak must sign a test ID token");
    return (await exchanged.json()).id_token;
}

async function rejectedWithoutRevocation(appOrigin, signedToken, sessionCount) {
    const response = await fetch(appOrigin + "/logout/connect/back-channel/keycloak", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ logout_token: signedToken }),
    });
    assert.equal(response.status, 400, "Invalid logout claims must be rejected");
    assert.equal(sessionCount(), "1", "Invalid logout token cannot delete a JDBC session");
}

async function waitUntil(check, message) {
    for (let attempt = 0; attempt < 80; attempt++) {
        if (await check()) return;
        await sleep(250);
    }
    throw new Error("Timed out: " + message);
}

async function run() {
    const port = await reservePort();
    const appOrigin = "http://127.0.0.1:" + port;
    const gateway = JSON.parse(execFileSync("docker", [
        "inspect", "giaokhoa-test-test-keycloak-1", "--format", "{{json .NetworkSettings.Networks}}",
    ], { encoding: "utf8" }))["giaokhoa-test_default"].Gateway;
    assert.match(gateway, /^172\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);

    received = [];
    proxy = createServer(async (request, response) => {
        try {
            assert.equal(request.method, "POST");
            assert.equal(request.url, "/logout/connect/back-channel/keycloak");
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = Buffer.concat(chunks).toString();
            const token = new URLSearchParams(body).get("logout_token");
            assert.ok(token);
            const relay = await fetch(appOrigin + request.url, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body,
            });
            received.push({ token, status: relay.status });
            response.writeHead(relay.status);
            response.end();
        } catch {
            response.writeHead(500);
            response.end();
        }
    });
    await new Promise((done) => proxy.listen(0, "0.0.0.0", done));
    const proxyPort = proxy.address().port;
    dockerSql("CREATE SCHEMA " + schema);
    schemaCreated = true;

    const createdClient = await admin("POST", "/clients", {
        clientId, secret: clientSecret, name: "T011 ephemeral signed logout acceptance",
        enabled: true, protocol: "openid-connect",
        publicClient: false, standardFlowEnabled: true, directAccessGrantsEnabled: false,
        serviceAccountsEnabled: false,
        redirectUris: [appOrigin + "/login/oauth2/code/keycloak", appOrigin + "/oidc-negative-callback"],
        attributes: {
            "pkce.code.challenge.method": "S256",
            "backchannel.logout.url":
                "http://" + gateway + ":" + proxyPort + "/logout/connect/back-channel/keycloak",
            "backchannel.logout.session.required": "true",
        },
    });
    clientUuid = createdClient.headers.get("location")?.split("/").at(-1);
    assert.ok(clientUuid, "Ephemeral TEST client ID");

    const createdUser = await admin("POST", "/users", {
        username, email: username + "@test.giaokhoa.localhost",
        firstName: "T011", lastName: "Acceptance", enabled: true, emailVerified: true,
        credentials: [{ type: "password", value: password, temporary: false }],
    });
    userId = createdUser.headers.get("location")?.split("/").at(-1);
    assert.ok(userId, "Ephemeral TEST user ID");

    await startBackend(port);
    const cookie = await login(appOrigin);
    const sessionCount = () => dockerSql(
        "SELECT count(*) FROM " + schema + ".spring_session WHERE session_id='" + cookie + "'");
    const correlation = () => dockerSql(
        "SELECT sub || '|' || COALESCE(sid, '') FROM " + schema +
        ".oidc_session_correlation WHERE session_id='" + cookie + "'");
    assert.equal(sessionCount(), "1", "JDBC session persisted after Code+PKCE login");
    const recorded = correlation().split("|");
    assert.equal(recorded[0], userId, "OIDC sub must match session owner");
    assert.ok(recorded[1], "OIDC sid must be recorded");
    const sessionSetCookie = jars.get(appOrigin)?.get("SESSION");
    assert.equal(sessionSetCookie, cookie);

    await stopBackend();
    backendLogs = "";
    await startBackend(port);
    assert.equal(sessionCount(), "1", "JDBC session survives backend restart");
    assert.equal(correlation(), recorded.join("|"), "OIDC correlation survives restart");
    const active = await browserFetch(appOrigin + "/api/me/workspaces");
    assert.equal(active.status, 404, "Old SESSION cookie authenticates after restart");

    const badToken = await fetch(appOrigin + "/logout/connect/back-channel/keycloak", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ logout_token: "not.a.signed.jwt" }),
    });
    assert.equal(badToken.status, 400, "Unsigned logout token rejected");
    assert.equal(sessionCount(), "1", "Invalid token cannot invalidate JDBC session");

    const validIdToken = await signedIdTokenWithoutLogoutEvent(appOrigin);
    const idClaims = JSON.parse(Buffer.from(validIdToken.split(".")[1], "base64url").toString());
    assert.equal(idClaims.iss, issuer);
    assert.equal(idClaims.aud, clientId);
    assert.equal(idClaims.events, undefined, "A signed ID token is not a logout event");
    await rejectedWithoutRevocation(appOrigin, validIdToken, sessionCount);

    // These tokens are also Keycloak-signed but have the wrong issuer or audience.
    const masterToken = await fetchAdminToken();
    const masterClaims = JSON.parse(Buffer.from(masterToken.split(".")[1], "base64url").toString());
    assert.notEqual(masterClaims.iss, issuer);
    await rejectedWithoutRevocation(appOrigin, masterToken, sessionCount);
    const fixtureTokenResponse = await fetch(issuer + "/protocol/openid-connect/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials", client_id: "giaokhoa-it-fixtures",
            client_secret: "ci-fixtures-only",
        }),
    });
    assert.equal(fixtureTokenResponse.status, 200);
    const fixtureToken = (await fixtureTokenResponse.json()).access_token;
    const fixtureClaims = JSON.parse(Buffer.from(fixtureToken.split(".")[1], "base64url").toString());
    assert.equal(fixtureClaims.iss, issuer);
    assert.ok(![].concat(fixtureClaims.aud ?? []).includes(clientId));
    await rejectedWithoutRevocation(appOrigin, fixtureToken, sessionCount);

    await admin("POST", "/users/" + userId + "/logout");
    await waitUntil(() => received.length > 0, "Keycloak signed back-channel callback");
    const event = received[0];
    assert.equal(event.status, 200, "Spring native signed-token back-channel handler");
    const parts = event.token.split(".");
    assert.equal(parts.length, 3, "Keycloak must sign a JWT logout_token");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    assert.equal(claims.iss, issuer);
    assert.equal(claims.aud, clientId);
    assert.equal(claims.sub, userId);
    assert.equal(claims.sid, recorded[1]);
    assert.deepEqual(claims.events, {
        "http://schemas.openid.net/event/backchannel-logout": {},
    });
    await waitUntil(() => sessionCount() === "0", "Keycloak logout must delete JDBC session");
    assert.equal(correlation(), "", "No stale OIDC correlation after logout");
    const expired = await browserFetch(appOrigin + "/api/me/workspaces");
    assert.equal(expired.status, 302, "Old browser cookie no longer authenticates");
    console.log("PASS: Keycloak-signed logout, issuer/aud/events/sid/sub, DB deletion, restart and old cookie rejection");
}

try {
    await run();
} catch (error) {
    console.error("Native OIDC back-channel acceptance failed:", error);
    if (backendLogs) console.error("Backend startup diagnostics:", backendLogs.slice(-3000));
    process.exitCode = 1;
} finally {
    await stopBackend();
    if (proxy) await new Promise((done) => proxy.close(done));
    if (userId) await admin("DELETE", "/users/" + userId).catch((error) => console.error("TEST user cleanup:", error));
    if (clientUuid) await admin("DELETE", "/clients/" + clientUuid).catch((error) => console.error("TEST client cleanup:", error));
    // Only the randomly named schema created by this run is removed.
    if (schemaCreated) {
        try { dockerSql("SET client_min_messages=warning; DROP SCHEMA " + schema + " CASCADE"); }
        catch (error) { console.error("TEST schema cleanup:", error); process.exitCode = 1; }
    }
}
