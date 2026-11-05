package com.giaokhoa.support;

import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Base for opt-in integration tests against the isolated local Compose TEST stack. Never run them
 * against DEV databases or realms.
 */
// Spring kế thừa cấu hình TEST qua lớp base; không cho khởi tạo fixture trực tiếp.
@SuppressWarnings("PMD.AbstractClassWithoutAbstractMethod")
@ActiveProfiles("integration")
public abstract class IntegrationEnvironment {
    // shortcut: This fixture targets local Compose TEST only; external TEST needs a separately
    // verified allowlist.
    private static final String TEST_DB = "jdbc:postgresql://127.0.0.1:15432/giaokhoa_test";
    private static final String TEST_ISSUER = "http://127.0.0.1:18081/realms/giaokhoa-it";

    @DynamicPropertySource
    static void testServices(DynamicPropertyRegistry registry) {
        String database = required("TEST_DATABASE_URL");
        String issuer =
                required("TEST_KEYCLOAK_BASE_URL").replaceAll("/+$", "")
                        + "/realms/"
                        + required("TEST_KEYCLOAK_REALM");
        validateTargets(database, issuer);

        registry.add("spring.datasource.url", () -> database);
        registry.add("spring.datasource.username", () -> required("TEST_DATABASE_USERNAME"));
        registry.add("spring.datasource.password", () -> required("TEST_DATABASE_PASSWORD"));
        registry.add("spring.flyway.user", () -> required("TEST_DATABASE_MIGRATOR_USERNAME"));
        registry.add("spring.flyway.password", () -> required("TEST_DATABASE_MIGRATOR_PASSWORD"));
        registry.add("spring.security.oauth2.client.provider.keycloak.issuer-uri", () -> issuer);
        registry.add(
                "spring.security.oauth2.client.registration.keycloak.client-id",
                () -> required("TEST_OIDC_CLIENT_ID"));
        registry.add(
                "spring.security.oauth2.client.registration.keycloak.client-secret",
                () -> required("TEST_OIDC_CLIENT_SECRET"));
    }

    static void validateTargets(String database, String issuer) {
        if (!TEST_DB.equals(database) || !TEST_ISSUER.equals(issuer)) {
            throw new IllegalArgumentException(
                    "Integration tests require the dedicated local TEST database and issuer");
        }
    }

    static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing integration environment variable: " + key);
        }
        return value;
    }
}
