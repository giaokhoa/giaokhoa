package com.giaokhoa.support;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class IntegrationEnvironmentTest {
    @Test
    void onlyDedicatedPostgresDatabaseAndRealmAreAllowed() {
        assertDoesNotThrow(() -> IntegrationEnvironment.validateTargets(
                "jdbc:postgresql://127.0.0.1:15432/giaokhoa_test",
                "http://auth.test.giaokhoa.localhost:18081/realms/giaokhoa-it"));
        assertThrows(IllegalArgumentException.class, () -> IntegrationEnvironment.validateTargets(
                "jdbc:postgresql://localhost:5432/giaokhoa",
                "http://auth.test.giaokhoa.localhost:18081/realms/giaokhoa-it"));
        assertThrows(IllegalArgumentException.class, () -> IntegrationEnvironment.validateTargets(
                "jdbc:postgresql://localhost:15432/giaokhoa_test",
                "http://auth.giaokhoa.localhost:8081/realms/giaokhoa"));
        assertThrows(IllegalArgumentException.class, () -> IntegrationEnvironment.validateTargets(
                "jdbc:h2:mem:test", "http://localhost/realms/giaokhoa-it"));
        assertThrows(IllegalArgumentException.class, () -> IntegrationEnvironment.validateTargets(
                "jdbc:postgresql://app-db:5432/giaokhoa_test",
                "http://auth.test.giaokhoa.localhost:18081/realms/giaokhoa-it"));
        assertThrows(IllegalArgumentException.class, () -> IntegrationEnvironment.validateTargets(
                "jdbc:postgresql://test-app-db:5432/giaokhoa_test",
                "http://auth.giaokhoa.localhost:8081/realms/giaokhoa-it"));
    }
}
