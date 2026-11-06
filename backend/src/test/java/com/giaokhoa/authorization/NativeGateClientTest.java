package com.giaokhoa.authorization;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Collections;
import java.util.Map;
import org.junit.jupiter.api.Test;

class NativeGateClientTest {
    @Test
    void onlyExplicitBooleanPdpDecisionsAreValid() {
        assertTrue(NativeGateClient.requireDecision(Map.of("result", true)));
        assertFalse(NativeGateClient.requireDecision(Map.of("result", false)));

        assertThrows(IllegalStateException.class, () -> NativeGateClient.requireDecision(null));
        assertThrows(IllegalStateException.class, () -> NativeGateClient.requireDecision(Map.of()));
        assertThrows(
                IllegalStateException.class,
                () -> NativeGateClient.requireDecision(Collections.singletonMap("result", null)));
        assertThrows(
                IllegalStateException.class,
                () -> NativeGateClient.requireDecision(Map.of("result", "false")));
        assertThrows(
                IllegalStateException.class,
                () -> NativeGateClient.requireDecision(Map.of("result", 0)));
    }
}
