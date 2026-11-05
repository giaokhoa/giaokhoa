import { randomBytes, randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

type TestUser = { id: string; username: string; email: string; password: string };
type Mail = { ID: string; Subject: string; Created: string; To: { Address: string }[] };
type MailSearch = { messages: Mail[] };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu cấu hình TEST: ${name}`);
  return value;
}

/** Calls from the Node test runner only; no tokens or credentials reach Next/browser. */
export class TestEnvironment {
  readonly keycloak = new URL(required("TEST_KEYCLOAK_BASE_URL"));
  readonly realm = required("TEST_KEYCLOAK_REALM");
  readonly backendOrigin = required("TEST_BACKEND_ORIGIN");
  readonly clientId = required("TEST_OIDC_CLIENT_ID");
  readonly mailpit = new URL(required("TEST_MAILPIT_URL"));
  private readonly createdUsers = new Set<string>();
  private readonly receivedMail = new Set<string>();

  constructor() {
    if (!/^giaokhoa-it(?:-[a-z0-9-]+)?$/.test(this.realm)) {
      throw new Error("Chỉ cho phép realm giaokhoa-it* để kiểm thử");
    }
    if (!["http:", "https:"].includes(this.keycloak.protocol) ||
        this.keycloak.hostname === "auth.giaokhoa.localhost" ||
        this.keycloak.pathname !== "/" ||
        !["http:", "https:"].includes(this.mailpit.protocol) ||
        this.mailpit.hostname === "mailpit" ||
        (["127.0.0.1", "localhost"].includes(this.mailpit.hostname) && this.mailpit.port === "8025")) {
      throw new Error("Không được dùng DEV Keycloak/Mailpit cho TEST");
    }
  }

  private url(path: string): string {
    return new URL(path, this.keycloak).toString();
  }

  private async adminToken(): Promise<string> {
    const response = await fetch(this.url(`/realms/${this.realm}/protocol/openid-connect/token`), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: required("TEST_KEYCLOAK_ADMIN_CLIENT_ID"),
        client_secret: required("TEST_KEYCLOAK_ADMIN_CLIENT_SECRET"),
      }),
    });
    if (!response.ok) throw new Error(`Keycloak test admin token: HTTP ${response.status}`);
    return (await response.json() as { access_token: string }).access_token;
  }

  private async admin(method: string, path: string, body?: object): Promise<Response> {
    const response = await fetch(this.url(`/admin/realms/${this.realm}${path}`), {
      method,
      headers: {
        authorization: `Bearer ${await this.adminToken()}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`Keycloak test admin ${method}: HTTP ${response.status}`);
    return response;
  }

  async createUser(emailVerified = true): Promise<TestUser> {
    const unique = randomUUID();
    const username = `t005-${unique}`;
    const email = `${username}@test.giaokhoa.localhost`;
    const password = randomBytes(24).toString("base64url") + "Aa1!";
    const response = await this.admin("POST", "/users", {
      username, email, enabled: true, emailVerified,
      credentials: [{ type: "password", value: password, temporary: false }],
    });
    const location = response.headers.get("location");
    const id = location?.split("/").at(-1);
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
      throw new Error("Keycloak không trả ID của user test; kiểm tra fixture thủ công");
    }
    this.createdUsers.add(id);
    return { id, username, email, password };
  }

  async deleteUser(user: TestUser): Promise<void> {
    if (!this.createdUsers.has(user.id)) throw new Error("Không xóa tài khoản không do test tạo");
    await this.admin("DELETE", `/users/${encodeURIComponent(user.id)}`);
    this.createdUsers.delete(user.id);
  }

  async requestVerificationEmail(user: TestUser): Promise<void> {
    if (!this.createdUsers.has(user.id)) throw new Error("Chỉ gửi mail cho tài khoản test");
    await this.admin("PUT", `/users/${encodeURIComponent(user.id)}/send-verify-email`);
  }

  async waitForEmail(email: string, since: number): Promise<Mail> {
    if (!email.endsWith("@test.giaokhoa.localhost")) throw new Error("Email phải thuộc TEST");
    const url = new URL("/api/v1/search", this.mailpit);
    url.searchParams.set("query", `to:${email}`);
    for (let i = 0; i < 30; i++) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Mailpit test: HTTP ${response.status}`);
      const result = await response.json() as MailSearch;
      const message = result.messages.find((mail) =>
        Date.parse(mail.Created) >= since - 1_000 &&
        mail.To.some((recipient) => recipient.Address === email));
      if (message) {
        this.receivedMail.add(message.ID);
        return message;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Mailpit không nhận được email xác minh của user test");
  }

  async deleteEmail(message: Mail): Promise<void> {
    if (!this.receivedMail.has(message.ID)) throw new Error("Không xóa email không do test nhận");
    const response = await fetch(new URL("/api/v1/messages", this.mailpit), {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: [message.ID] }),
    });
    if (!response.ok) throw new Error(`Xóa mail test: HTTP ${response.status}`);
    this.receivedMail.delete(message.ID);
  }

  async loginWithCode(page: Page, user: TestUser): Promise<void> {
    await page.goto(new URL("/oauth2/authorization/keycloak", this.backendOrigin).toString());
    await expect(page).toHaveURL(new RegExp(`/realms/${this.realm}/protocol/openid-connect/auth`));
    const authorization = new URL(page.url());
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("client_id")).toBe(this.clientId);
    expect(authorization.searchParams.get("state")).toBeTruthy();
    expect(authorization.searchParams.get("nonce")).toBeTruthy();
    expect(authorization.searchParams.get("code_challenge")).toBeTruthy();

    await page.locator("#username").fill(user.username);
    await page.locator("#password").fill(user.password);
    await page.locator("#kc-login").click();
    await page.waitForURL((url) => url.origin === new URL(this.backendOrigin).origin
      && !url.pathname.startsWith("/login/oauth2/code/"));
    const url = new URL(page.url());
    expect(url.searchParams.has("code")).toBe(false);
    expect(url.searchParams.has("access_token")).toBe(false);
    const cookies = await page.context().cookies(this.backendOrigin);
    expect(cookies.some((cookie) => ["SESSION", "JSESSIONID"].includes(cookie.name)
      && cookie.httpOnly)).toBe(true);
  }
}
