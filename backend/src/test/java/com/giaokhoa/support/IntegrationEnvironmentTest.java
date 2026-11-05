package com.giaokhoa.support;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class IntegrationEnvironmentTest {
    @Test
    void onlyLocalComposeTestDatabaseAndIssuerAreAllowed() {
        String testDb = "jdbc:postgresql://127.0.0.1:15432/giaokhoa_test";
        String testIssuer = "http://127.0.0.1:18081/realms/giaokhoa-it";

        assertDoesNotThrow(() -> IntegrationEnvironment.validateTargets(testDb, testIssuer));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        IntegrationEnvironment.validateTargets(
                                testDb, "http://127.0.0.1:8081/realms/giaokhoa-it"));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        IntegrationEnvironment.validateTargets(
                                "jdbc:postgresql://127.0.0.1:5432/giaokhoa_test", testIssuer));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        IntegrationEnvironment.validateTargets(
                                "jdbc:postgresql://127.0.0.1:15432/giaokhoa", testIssuer));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        IntegrationEnvironment.validateTargets(
                                "jdbc:postgresql://app-db:5432/giaokhoa_test", testIssuer));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        IntegrationEnvironment.validateTargets(
                                testDb, "http://auth.giaokhoa.localhost:8081/realms/giaokhoa-it"));
        assertThrows(
                IllegalArgumentException.class,
                () -> IntegrationEnvironment.validateTargets("jdbc:h2:mem:test", testIssuer));
    }
}
