package com.giaokhoa.authorization.decision;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;

class RequiredPermissionsTest {

    @Test
    void requiresAtLeastOnePair() {
        assertThrows(IllegalArgumentException.class, () -> RequiredPermissions.of());
        assertThrows(IllegalArgumentException.class, () -> new RequiredPermissions(List.of()));
    }

    @Test
    void requiresResourceAndScopeOnEveryPair() {
        assertThrows(
                IllegalArgumentException.class, () -> RequiredPermissions.require(null, "enter"));
        assertThrows(
                IllegalArgumentException.class, () -> RequiredPermissions.require(" ", "enter"));
        assertThrows(
                IllegalArgumentException.class, () -> RequiredPermissions.require("res", null));
        assertThrows(IllegalArgumentException.class, () -> RequiredPermissions.require("res", " "));
    }

    @Test
    void keepsPairsInOrderAndImmutable() {
        RequiredPermissions required =
                RequiredPermissions.of(
                        RequiredPermissions.require("resource-a", "enter"),
                        RequiredPermissions.require("resource-b", "read"));

        assertEquals(
                List.of(
                        new RequiredPermissions.Permission("resource-a", "enter"),
                        new RequiredPermissions.Permission("resource-b", "read")),
                required.permissions());
        assertThrows(
                UnsupportedOperationException.class,
                () ->
                        required.permissions()
                                .add(new RequiredPermissions.Permission("resource-c", "read")));
    }
}
