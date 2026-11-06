package com.giaokhoa.authorization;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.io.IOException;
import java.net.CookieManager;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.json.JsonMapper;

/**
 * Disposable, native Keycloak 26.8.1 policy graph on the allowlisted integration TEST realm. The
 * Direct Grant client is test-only: never giaokhoa-web, never an application auth path.
 */
final class NativeRevocationFixture implements AutoCloseable {
    private static final JsonMapper JSON = new JsonMapper();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String REDIRECT_URI = "http://127.0.0.1:18888/callback";
    private static final Pattern LOGIN_FORM =
            Pattern.compile("<form[^>]*id=\"kc-form-login\"[^>]*action=\"([^\"]+)\"");
    private static final String DEFAULT_PERMISSION = "Default Permission";
    private static final String DEFAULT_RESOURCE = "Default Resource";
    private static final String DEFAULT_POLICY = "Default Policy";
    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIST =
            new ParameterizedTypeReference<>() {};

    private final RestClient http = RestClient.create();
    private final String base;
    private final String adminToken;
    private final String clientName;
    private final String clientSecret;
    private String clientId;
    private String userId;
    private String groupA;
    private String groupB;
    private String resourceA;
    private String resourceB;

    NativeRevocationFixture() {
        base = required("TEST_KEYCLOAK_BASE_URL");
        if (!"http://127.0.0.1:18081".equals(base)
                || !"giaokhoa-it".equals(required("TEST_KEYCLOAK_REALM"))) {
            throw new IllegalArgumentException("T014 native fixture is limited to TEST Keycloak");
        }
        clientName = "t014-" + UUID.randomUUID();
        clientSecret = "test-secret-" + UUID.randomUUID();
        adminToken = masterToken();
        boolean provisioned = false;
        try {
            provision();
            provisioned = true;
        } finally {
            if (!provisioned) {
                close();
            }
        }
    }

    String userSubject() {
        return userId;
    }

    String userToken() {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "password");
        form.add("client_id", clientName);
        form.add("client_secret", clientSecret);
        form.add("username", clientName + "-user");
        form.add("password", clientSecret);
        Map<String, Object> tokens =
                http.post()
                        .uri(base + "/realms/giaokhoa-it/protocol/openid-connect/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(MAP);
        assertNotNull(tokens);
        return (String) tokens.get("access_token");
    }

    record WebTokens(String accessToken, String idToken, String refreshToken) {}

    WebTokens webTokensViaCodePkce() {
        // Actual Keycloak Authorization Code+PKCE for the application's confidential TEST client.
        // HTTP form login is sufficient here; T022 additionally covers the browser/BFF callback.
        String client = required("TEST_OIDC_CLIENT_ID");
        if (!"giaokhoa-it-web".equals(client)) {
            throw new IllegalArgumentException("Only TEST BFF client can be used");
        }
        byte[] nonce = new byte[32];
        RANDOM.nextBytes(nonce);
        String verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(nonce);
        String challenge;
        try {
            challenge =
                    Base64.getUrlEncoder()
                            .withoutPadding()
                            .encodeToString(
                                    MessageDigest.getInstance("SHA-256")
                                            .digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("PKCE requires SHA-256", ex);
        }
        String state = UUID.randomUUID().toString();
        String url =
                base
                        + "/realms/giaokhoa-it/protocol/openid-connect/auth?client_id="
                        + encode(client)
                        + "&redirect_uri="
                        + encode(REDIRECT_URI)
                        + "&response_type=code&scope=openid&state="
                        + encode(state)
                        + "&nonce="
                        + UUID.randomUUID()
                        + "&code_challenge="
                        + encode(challenge)
                        + "&code_challenge_method=S256";

        try (HttpClient browser =
                HttpClient.newBuilder()
                        .cookieHandler(new CookieManager())
                        .connectTimeout(Duration.ofSeconds(10))
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .build()) {
            var loginPage =
                    browser.send(
                            HttpRequest.newBuilder(URI.create(url)).GET().build(),
                            HttpResponse.BodyHandlers.ofString());
            assertEquals(200, loginPage.statusCode(), "Expected native Keycloak login form");
            var form = LOGIN_FORM.matcher(loginPage.body());
            if (!form.find()) {
                throw new IllegalStateException("Native TEST Code login form not found");
            }
            String loginUrl = form.group(1).replace("&amp;", "&");
            if (!loginUrl.startsWith(base + "/realms/giaokhoa-it/login-actions/")) {
                throw new IllegalStateException("Unexpected TEST login form target");
            }
            // TEST Keycloak issues Secure cookies even on HTTP loopback. Return them only
            // to the allowlisted 127.0.0.1:18081 login action, not to any other origin.
            String loginCookies =
                    loginPage.headers().allValues("set-cookie").stream()
                            .map(cookie -> cookie.split(";", 2)[0])
                            .collect(java.util.stream.Collectors.joining("; "));
            var loginResponse =
                    browser.send(
                            HttpRequest.newBuilder(URI.create(loginUrl))
                                    .header("Cookie", loginCookies)
                                    .header("Content-Type", "application/x-www-form-urlencoded")
                                    .POST(
                                            HttpRequest.BodyPublishers.ofString(
                                                    "username="
                                                            + encode(clientName + "-user")
                                                            + "&password="
                                                            + encode(clientSecret)
                                                            + "&credentialId="))
                                    .build(),
                            HttpResponse.BodyHandlers.ofString());
            assertEquals(302, loginResponse.statusCode(), "Native Code login must redirect");
            URI redirected =
                    URI.create(loginResponse.headers().firstValue("location").orElseThrow());
            if (!REDIRECT_URI.equals(
                    redirected.getScheme()
                            + "://"
                            + redirected.getHost()
                            + ":"
                            + redirected.getPort()
                            + redirected.getPath())) {
                throw new IllegalStateException("Unexpected TEST OIDC redirect target");
            }
            Map<String, String> params =
                    java.util.Arrays.stream(redirected.getRawQuery().split("&"))
                            .map(value -> value.split("=", 2))
                            .collect(
                                    java.util.stream.Collectors.toMap(
                                            pair ->
                                                    URLDecoder.decode(
                                                            pair[0], StandardCharsets.UTF_8),
                                            pair ->
                                                    URLDecoder.decode(
                                                            pair[1], StandardCharsets.UTF_8)));
            assertEquals(state, params.get("state"));
            String code = java.util.Objects.requireNonNull(params.get("code"));
            var exchange = new LinkedMultiValueMap<String, String>();
            exchange.add("grant_type", "authorization_code");
            exchange.add("client_id", client);
            exchange.add("client_secret", required("TEST_OIDC_CLIENT_SECRET"));
            exchange.add("redirect_uri", REDIRECT_URI);
            exchange.add("code", code);
            exchange.add("code_verifier", verifier);
            Map<String, Object> tokens =
                    http.post()
                            .uri(base + "/realms/giaokhoa-it/protocol/openid-connect/token")
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .body(exchange)
                            .retrieve()
                            .body(MAP);
            assertNotNull(tokens);
            String idToken = (String) tokens.get("id_token");
            assertNotNull(idToken);
            String claims =
                    new String(
                            Base64.getUrlDecoder().decode(idToken.split("[.]")[1]),
                            StandardCharsets.UTF_8);
            assertEquals(userId, JSON.readTree(claims).get("sub").stringValue());
            return new WebTokens(
                    (String) tokens.get("access_token"),
                    idToken,
                    (String) tokens.get("refresh_token"));
        } catch (IOException exception) {
            throw new IllegalStateException("Native TEST Code+PKCE login failed", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Native TEST Code+PKCE login interrupted", exception);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    boolean containsGroupClaim(String accessToken) {
        String payload =
                new String(
                        Base64.getUrlDecoder().decode(accessToken.split("\\.")[1]),
                        StandardCharsets.UTF_8);
        return JSON.readTree(payload).has("groups");
    }

    boolean allowed(String userToken, String target) {
        return allowed(userToken, target, "enter");
    }

    boolean allowed(String userToken, String target, String scope) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "urn:ietf:params:oauth:grant-type:uma-ticket");
        form.add("audience", clientName);
        form.add("permission", ("a".equals(target) ? resourceA : resourceB) + "#" + scope);
        form.add("response_mode", "decision");
        var response =
                http.post()
                        .uri(base + "/realms/giaokhoa-it/protocol/openid-connect/token")
                        .headers(headers -> headers.setBearerAuth(userToken))
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .onStatus(status -> status == HttpStatus.FORBIDDEN, (request, reply) -> {})
                        .toEntity(MAP);
        if (response.getStatusCode() == HttpStatus.FORBIDDEN) {
            return false;
        }
        assertEquals(200, response.getStatusCode().value());
        return NativeGateClient.requireDecision(response.getBody());
    }

    record GraphInventory(long resources, long policies, long permissions) {}

    GraphInventory graphInventory() {
        String root = "/clients/" + clientId + "/authz/resource-server";
        return new GraphInventory(
                countNative(root + "/resource"),
                countNative(root + "/policy"),
                countNative(root + "/permission/scope"));
    }

    private long countNative(String path) {
        return getList(path).stream()
                .filter(item -> String.valueOf(item.get("name")).startsWith(clientName + "-"))
                .count();
    }

    String resourceId(String target) {
        return "a".equals(target) ? resourceA : resourceB;
    }

    void revoke(String target) {
        String group = "a".equals(target) ? groupA : groupB;
        http.delete()
                .uri(admin("/users/" + userId + "/groups/" + group))
                .headers(headers -> headers.setBearerAuth(adminToken))
                .retrieve()
                .toBodilessEntity();
    }

    private void provision() {
        clientId =
                create(
                        "/clients",
                        Map.of(
                                "clientId", clientName,
                                "secret", clientSecret,
                                "protocol", "openid-connect",
                                "enabled", true,
                                "publicClient", false,
                                "standardFlowEnabled", false,
                                "directAccessGrantsEnabled", true,
                                "authorizationServicesEnabled", true,
                                "serviceAccountsEnabled", true,
                                "fullScopeAllowed", false));
        String scope =
                create(
                        "/clients/" + clientId + "/authz/resource-server/scope",
                        Map.of("name", "enter"));
        String contentScope =
                create(
                        "/clients/" + clientId + "/authz/resource-server/scope",
                        Map.of("name", "content.read"));
        // A newly created authorization server can have wildcard defaults: delete them.
        removeDefaults();
        groupA = create("/groups", Map.of("name", clientName + "-a"));
        groupB = create("/groups", Map.of("name", clientName + "-b"));
        userId =
                create(
                        "/users",
                        Map.of(
                                "username",
                                clientName + "-user",
                                "enabled",
                                true,
                                "email",
                                clientName + "@example.invalid",
                                "emailVerified",
                                true,
                                "firstName",
                                "Synthetic",
                                "lastName",
                                "User",
                                "requiredActions",
                                List.of(),
                                "credentials",
                                List.of(
                                        Map.of(
                                                "type",
                                                "password",
                                                "value",
                                                clientSecret,
                                                "temporary",
                                                false))));
        addToGroup(groupA);
        addToGroup(groupB);
        resourceA = resource("a", scope, contentScope);
        resourceB = resource("b", scope, contentScope);
        permission("a", resourceA, scope, groupA);
        permission("b", resourceB, scope, groupB);
        permission("a-content", resourceA, contentScope, groupA);
        permission("b-content", resourceB, contentScope, groupB);
    }

    private void removeDefaults() {
        String root = "/clients/" + clientId + "/authz/resource-server";
        for (Map<String, Object> permission : getList(root + "/permission/resource")) {
            if (DEFAULT_PERMISSION.equals(permission.get("name"))) {
                delete(root + "/permission/resource/" + permission.get("id"));
            }
        }
        for (Map<String, Object> resource : getList(root + "/resource")) {
            if (DEFAULT_RESOURCE.equals(resource.get("name"))) {
                delete(root + "/resource/" + resource.get("_id"));
            }
        }
        for (Map<String, Object> policy : getList(root + "/policy")) {
            if (DEFAULT_POLICY.equals(policy.get("name"))) {
                delete(root + "/policy/" + policy.get("id"));
            }
        }
    }

    private String resource(String name, String scope, String contentScope) {
        return create(
                "/clients/" + clientId + "/authz/resource-server/resource",
                Map.of(
                        "name",
                        clientName + "-" + name,
                        "ownerManagedAccess",
                        false,
                        "scopes",
                        List.of(
                                Map.of("id", scope, "name", "enter"),
                                Map.of("id", contentScope, "name", "content.read"))));
    }

    private void permission(String suffix, String resource, String scope, String group) {
        String root = "/clients/" + clientId + "/authz/resource-server";
        String groupPolicy =
                create(
                        root + "/policy/group",
                        Map.of(
                                "name", clientName + "-members-" + suffix,
                                "type", "group",
                                "logic", "POSITIVE",
                                "decisionStrategy", "UNANIMOUS",
                                "groups", List.of(Map.of("id", group, "extendChildren", false))));
        create(
                root + "/permission/scope",
                Map.of(
                        "name",
                        clientName + "-enter-" + suffix,
                        "type",
                        "scope",
                        "decisionStrategy",
                        "UNANIMOUS",
                        "resources",
                        List.of(resource),
                        "scopes",
                        List.of(scope),
                        "policies",
                        List.of(groupPolicy)));
    }

    private void addToGroup(String group) {
        http.put()
                .uri(admin("/users/" + userId + "/groups/" + group))
                .headers(headers -> headers.setBearerAuth(adminToken))
                .retrieve()
                .toBodilessEntity();
    }

    private String masterToken() {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "password");
        form.add("client_id", "admin-cli");
        form.add("username", required("TEST_KEYCLOAK_MASTER_USERNAME"));
        form.add("password", required("TEST_KEYCLOAK_MASTER_PASSWORD"));
        Map<String, Object> response =
                http.post()
                        .uri(base + "/realms/master/protocol/openid-connect/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(MAP);
        assertNotNull(response);
        return (String) response.get("access_token");
    }

    private String create(String path, Map<String, ?> body) {
        var response =
                http.post()
                        .uri(admin(path))
                        .headers(headers -> headers.setBearerAuth(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(body)
                        .retrieve()
                        .toEntity(String.class);
        URI location = response.getHeaders().getLocation();
        if (location != null) {
            String value = location.getPath();
            return value.substring(value.lastIndexOf('/') + 1);
        }
        // Authorization Services POST returns an ID in JSON rather than a Location header.
        assertNotNull(response.getBody(), "Keycloak must return a created ID for " + path);
        var created = JSON.readTree(response.getBody());
        var id = created.has("id") ? created.get("id") : created.get("_id");
        assertNotNull(id, "Keycloak must return a created ID for " + path);
        return id.stringValue();
    }

    private List<Map<String, Object>> getList(String path) {
        List<Map<String, Object>> result =
                http.get()
                        .uri(admin(path))
                        .headers(headers -> headers.setBearerAuth(adminToken))
                        .retrieve()
                        .body(LIST);
        assertNotNull(result);
        return result;
    }

    private void delete(String path) {
        http.delete()
                .uri(admin(path))
                .headers(headers -> headers.setBearerAuth(adminToken))
                .retrieve()
                .toBodilessEntity();
    }

    private String admin(String path) {
        return base + "/admin/realms/giaokhoa-it" + path;
    }

    private static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing TEST fixture variable " + key);
        }
        return value;
    }

    @Override
    public void close() {
        if (userId != null) {
            delete("/users/" + userId);
        }
        if (groupA != null) {
            delete("/groups/" + groupA);
        }
        if (groupB != null) {
            delete("/groups/" + groupB);
        }
        if (clientId != null) {
            delete("/clients/" + clientId);
        }
    }
}
