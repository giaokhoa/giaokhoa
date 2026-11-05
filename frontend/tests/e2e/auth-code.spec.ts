import { expect, test } from "@playwright/test";
import { TestEnvironment } from "./support/test-environment";

test("Keycloak thật cấp Authorization Code + PKCE và đổi code lấy token", async ({ page }) => {
  const env = new TestEnvironment();
  const user = await env.createUser();
  try {
    await env.exchangeAuthorizationCode(page, user);
  } finally {
    await env.deleteUser(user);
  }
});

test("Mailpit nhận email xác minh từ realm TEST", async () => {
  const env = new TestEnvironment();
  const user = await env.createUser(false);
  let message: Awaited<ReturnType<TestEnvironment["waitForEmail"]>> | undefined;
  try {
    const requestedAt = Date.now();
    await env.requestVerificationEmail(user);
    message = await env.waitForEmail(user.email, requestedAt);
    expect(message.Subject).toBeTruthy();
  } finally {
    try {
      if (message) await env.deleteEmail(message);
    } finally {
      await env.deleteUser(user);
    }
  }
});
