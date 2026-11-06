package com.giaokhoa.authorization.decision;

import java.util.List;
import java.util.Objects;

/** Các cặp resource/scope mà một protected action yêu cầu; mọi cặp đều phải được cho phép. */
public record RequiredPermissions(List<Permission> permissions) {

    public RequiredPermissions {
        permissions = List.copyOf(Objects.requireNonNull(permissions, "permissions"));
        if (permissions.isEmpty()) {
            throw new IllegalArgumentException("At least one required permission is needed");
        }
    }

    public static RequiredPermissions of(Permission... permissions) {
        return new RequiredPermissions(List.of(permissions));
    }

    public static Permission require(String resourceId, String scope) {
        return new Permission(resourceId, scope);
    }

    /**
     * Một resource của Keycloak và một scope của nó. Resource ID là ID mờ (opaque) của Keycloak.
     */
    public record Permission(String resourceId, String scope) {

        public Permission {
            if (resourceId == null || resourceId.isBlank() || scope == null || scope.isBlank()) {
                throw new IllegalArgumentException("Resource ID and scope are required");
            }
        }
    }
}
