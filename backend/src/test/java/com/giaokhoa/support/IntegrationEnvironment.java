package com.giaokhoa.support;

import java.net.URI;
import java.util.regex.Pattern;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Base for opt-in integration tests against isolated external TEST services.
 * Never run them against DEV databases or realms.
 */
@ActiveProfiles("integration")
public abstract class IntegrationEnvironment {
    private static final Pattern TEST_REALM = Pattern.compile("/realms/giaokhoa-it(?:-[a-z0-9-]+)?");

    @DynamicPropertySource
    static void testServices(DynamicPropertyRegistry registry) {
        String database = required("TEST_DATABASE_URL");
        String issuer = required("TEST_KEYCLOAK_BASE_URL").replaceAll("/+$", "")
                + "/realms/" + required("TEST_KEYCLOAK_REALM");
        validateTargets(database, issuer);

        registry.add("spring.datasource.url", () -> database);
        registry.add("spring.datasource.username", () -> required("TEST_DATABASE_USERNAME"));
        registry.add("spring.datasource.password", () -> required("TEST_DATABASE_PASSWORD"));
        registry.add("spring.flyway.user", () -> required("TEST_DATABASE_MIGRATOR_USERNAME"));
        registry.add("spring.flyway.password", () -> required("TEST_DATABASE_MIGRATOR_PASSWORD"));
        registry.add("spring.security.oauth2.client.provider.keycloak.issuer-uri", () -> issuer);
        registry.add("spring.security.oauth2.client.registration.keycloak.client-id",
                () -> required("TEST_OIDC_CLIENT_ID"));
        registry.add("spring.security.oauth2.client.registration.keycloak.client-secret",
                () -> required("TEST_OIDC_CLIENT_SECRET"));
    }

    static void validateTargets(String database, String issuer) {
        if (!database.startsWith("jdbc:postgresql://")) {
            throw new IllegalArgumentException("Integration tests require PostgreSQL");
        }
        URI jdbc = URI.create(database.substring("jdbc:".length()));
        URI provider = URI.create(issuer);
        if (jdbc.getHost() == null || jdbc.getPath() == null
                || "app-db".equals(jdbc.getHost())
                || !jdbc.getPath().matches("/[a-zA-Z0-9_]*_test")
                || provider.getHost() == null
                || "auth.giaokhoa.localhost".equals(provider.getHost())
                || !TEST_REALM.matcher(provider.getPath()).matches()
                || !("http".equals(provider.getScheme()) || "https".equals(provider.getScheme()))) {
            throw new IllegalArgumentException("Integration targets must be a *_test database and giaokhoa-it realm");
        }
    }

    private static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing integration environment variable: " + key);
        }
        return value;
    }
}
