package com.giaokhoa.authorization.decision;

import java.util.List;
import java.util.Objects;

/** The resource/scope pairs a protected action requires; every pair must be allowed. */
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

    /** One Keycloak resource and one of its scopes. Resource IDs are opaque Keycloak IDs. */
    public record Permission(String resourceId, String scope) {

        public Permission {
            if (resourceId == null || resourceId.isBlank() || scope == null || scope.isBlank()) {
                throw new IllegalArgumentException("Resource ID and scope are required");
            }
        }
    }
}
