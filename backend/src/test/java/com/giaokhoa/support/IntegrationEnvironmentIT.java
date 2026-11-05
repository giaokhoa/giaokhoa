package com.giaokhoa.support;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.sql.DriverManager;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

/** Verifies real TEST services without requiring application features from later tasks. */
class IntegrationEnvironmentIT extends IntegrationEnvironment {
    @Test
    void isolatedPostgresAndKeycloakIssuerAreAvailable() throws Exception {
        String database = required("TEST_DATABASE_URL");
        String issuer = required("TEST_KEYCLOAK_BASE_URL").replaceAll("/+$", "")
                + "/realms/" + required("TEST_KEYCLOAK_REALM");
        validateTargets(database, issuer);

        try (var connection = DriverManager.getConnection(database,
                required("TEST_DATABASE_USERNAME"), required("TEST_DATABASE_PASSWORD"))) {
            assertTrue(connection.isValid(5));
            assertEquals("giaokhoa_test", connection.getCatalog());
        }

        Map<?, ?> discovery = RestClient.create()
                .get()
                .uri(URI.create(issuer + "/.well-known/openid-configuration"))
                .retrieve()
                .body(Map.class);
        assertNotNull(discovery);
        assertEquals(issuer, discovery.get("issuer"));
        assertTrue(String.valueOf(discovery.get("authorization_endpoint"))
                .contains("/protocol/openid-connect/auth"));
    }
}
