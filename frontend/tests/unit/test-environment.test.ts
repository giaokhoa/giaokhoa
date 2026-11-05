import { afterEach, expect, test, vi } from "vitest";
import { TestEnvironment } from "../e2e/support/test-environment";

afterEach(() => vi.unstubAllEnvs());

test("test fixture không cho dùng realm hoặc Mailpit của DEV", () => {
  vi.stubEnv("TEST_KEYCLOAK_BASE_URL", "http://auth.test.giaokhoa.localhost:18081");
  vi.stubEnv("TEST_KEYCLOAK_REALM", "giaokhoa-it");
  vi.stubEnv("TEST_BACKEND_ORIGIN", "http://localhost:8080");
  vi.stubEnv("TEST_OIDC_CLIENT_ID", "giaokhoa-it-web");
  vi.stubEnv("TEST_MAILPIT_URL", "http://127.0.0.1:18025");
  expect(new TestEnvironment().realm).toBe("giaokhoa-it");

  vi.stubEnv("TEST_KEYCLOAK_REALM", "giaokhoa");
  expect(() => new TestEnvironment()).toThrow(/realm/);
  vi.stubEnv("TEST_KEYCLOAK_REALM", "giaokhoa-it");

  vi.stubEnv("TEST_KEYCLOAK_BASE_URL", "http://auth.giaokhoa.localhost:8081");
  expect(() => new TestEnvironment()).toThrow(/DEV/);
  vi.stubEnv("TEST_KEYCLOAK_BASE_URL", "http://auth.test.giaokhoa.localhost:18081");

  vi.stubEnv("TEST_MAILPIT_URL", "http://127.0.0.1:8025");
  expect(() => new TestEnvironment()).toThrow(/DEV/);
});
