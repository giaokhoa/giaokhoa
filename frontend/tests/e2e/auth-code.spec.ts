import { expect, test } from "@playwright/test";
import { TestEnvironment } from "./support/test-environment";

test("Authorization Code thật qua Keycloak và session ở Spring", async ({ page }) => {
  test.skip(process.env.TEST_AUTH_CODE !== "1", "Cần backend + realm TEST thật");
  const env = new TestEnvironment();
  const user = await env.createUser();
  try {
    await env.loginWithCode(page, user);
  } finally {
    await env.deleteUser(user);
  }
});

test("Mailpit nhận email xác minh từ realm TEST", async () => {
  test.skip(process.env.TEST_AUTH_CODE !== "1", "Cần Keycloak SMTP + Mailpit TEST thật");
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
