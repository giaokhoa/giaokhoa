package com.giaokhoa.support;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.web.client.RestClient;

/** Run explicitly against TEST services: ./mvnw -Dtest=IntegrationEnvironmentIT test. */
@SpringBootTest
class IntegrationEnvironmentIT extends IntegrationEnvironment {
    @Autowired
    DataSource dataSource;

    @Autowired
    Environment environment;

    @Test
    void databaseAndRealIssuerAreAvailable() throws Exception {
        try (var connection = dataSource.getConnection()) {
            assertTrue(connection.isValid(5));
            assertEquals("giaokhoa_test", connection.getCatalog());
        }

        String issuer = environment.getRequiredProperty(
                "spring.security.oauth2.client.provider.keycloak.issuer-uri");
        Map<?, ?> discovery = RestClient.create()
                .get()
                .uri(URI.create(issuer + "/.well-known/openid-configuration"))
                .retrieve()
                .body(Map.class);
        assertEquals(issuer, discovery.get("issuer"));
        assertTrue(String.valueOf(discovery.get("authorization_endpoint")).contains("/protocol/openid-connect/auth"));
    }
}
