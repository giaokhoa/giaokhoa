package com.giaokhoa.authorization.target;

import com.giaokhoa.authorization.policy.NativePolicyTemplates;
import com.giaokhoa.authorization.policy.NativePolicyTemplates.TargetType;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BiFunction;
import org.jspecify.annotations.Nullable;

/**
 * Định vị target cho quyết định PDP chỉ bằng metadata tối thiểu suy ra từ route và actor đã xác
 * thực. Locator không đọc dữ liệu nghiệp vụ: UUID trong route không tự nó chứng minh đối tượng tồn
 * tại hay thuộc workspace — việc đó thuộc về PDP và fence ở hạ lưu.
 */
public final class TargetLocator {
    private static final int ROOT_KEY_PARTS = 1;
    private static final int DIRECT_KEY_PARTS = 2;
    private static final int WORKSPACE_CHILD_KEY_PARTS = 4;
    private static final int RESOURCE_VERSION_KEY_PARTS = 6;

    public record TargetMetadata(
            TargetType type,
            String targetKey,
            @Nullable UUID workspaceId,
            @Nullable UUID objectId,
            @Nullable UUID versionId) {}

    private TargetLocator() {}

    public static TargetMetadata locate(
            @Nullable TargetType type,
            @Nullable UUID routeWorkspaceId,
            @Nullable UUID actorUserId,
            @Nullable UUID id,
            @Nullable UUID versionId) {
        if (type == null) {
            throw new IllegalArgumentException("Target type is required");
        }
        return switch (type) {
            case PLATFORM ->
                    new TargetMetadata(type, NativePolicyTemplates.platformKey(), null, null, null);
            case PROFILE -> locateProfile(actorUserId, id);
            case WORKSPACE -> locateWorkspace(routeWorkspaceId, id);
            case GRANT -> {
                UUID grantId = requireId(id);
                yield new TargetMetadata(
                        type, NativePolicyTemplates.grantKey(grantId), null, grantId, null);
            }
            case RESOURCE_VERSION -> locateResourceVersion(routeWorkspaceId, id, versionId);
            case CLASS ->
                    workspaceChild(type, routeWorkspaceId, id, NativePolicyTemplates::classKey);
            case COURSE ->
                    workspaceChild(type, routeWorkspaceId, id, NativePolicyTemplates::courseKey);
            case COURSE_SUBJECT ->
                    workspaceChild(
                            type, routeWorkspaceId, id, NativePolicyTemplates::courseSubjectKey);
            case RESOURCE ->
                    workspaceChild(type, routeWorkspaceId, id, NativePolicyTemplates::resourceKey);
            case ACTIVITY ->
                    workspaceChild(type, routeWorkspaceId, id, NativePolicyTemplates::activityKey);
            case RESULT ->
                    workspaceChild(type, routeWorkspaceId, id, NativePolicyTemplates::resultKey);
        };
    }

    public static Optional<TargetMetadata> parse(@Nullable String targetKey) {
        if (targetKey == null) {
            return Optional.empty();
        }
        Optional<TargetType> resolved = NativePolicyTemplates.targetTypeOf(targetKey);
        if (resolved.isEmpty()) {
            return Optional.empty();
        }
        TargetType type = resolved.get();
        String[] parts = targetKey.split(":");
        try {
            return switch (type) {
                case PLATFORM ->
                        parts.length == ROOT_KEY_PARTS
                                ? Optional.of(new TargetMetadata(type, targetKey, null, null, null))
                                : Optional.empty();
                case PROFILE ->
                        parts.length == DIRECT_KEY_PARTS
                                ? Optional.of(
                                        new TargetMetadata(
                                                type, targetKey, null, uuid(parts[1]), null))
                                : Optional.empty();
                case WORKSPACE -> {
                    if (parts.length != DIRECT_KEY_PARTS) {
                        yield Optional.empty();
                    }
                    UUID workspaceId = uuid(parts[1]);
                    yield Optional.of(
                            new TargetMetadata(type, targetKey, workspaceId, workspaceId, null));
                }
                case GRANT ->
                        parts.length == DIRECT_KEY_PARTS
                                ? Optional.of(
                                        new TargetMetadata(
                                                type, targetKey, null, uuid(parts[1]), null))
                                : Optional.empty();
                case RESOURCE_VERSION -> parseResourceVersion(type, targetKey, parts);
                default -> parseWorkspaceChild(type, targetKey, parts);
            };
        } catch (IllegalArgumentException invalid) {
            return Optional.empty();
        }
    }

    private static TargetMetadata locateProfile(@Nullable UUID actorUserId, @Nullable UUID id) {
        if (actorUserId == null) {
            throw new IllegalArgumentException("Actor account id is required for profile target");
        }
        if (!actorUserId.equals(id)) {
            throw new IllegalArgumentException("Profile target id must match the actor account id");
        }
        return new TargetMetadata(
                TargetType.PROFILE,
                NativePolicyTemplates.profileKey(actorUserId),
                null,
                actorUserId,
                null);
    }

    private static TargetMetadata locateWorkspace(
            @Nullable UUID routeWorkspaceId, @Nullable UUID id) {
        UUID workspaceId = requireRouteWorkspace(routeWorkspaceId);
        if (!workspaceId.equals(id)) {
            throw new IllegalArgumentException("Workspace target id must match route workspace id");
        }
        return new TargetMetadata(
                TargetType.WORKSPACE,
                NativePolicyTemplates.workspaceKey(workspaceId),
                workspaceId,
                workspaceId,
                null);
    }

    private static TargetMetadata locateResourceVersion(
            @Nullable UUID routeWorkspaceId, @Nullable UUID id, @Nullable UUID versionId) {
        UUID workspaceId = requireRouteWorkspace(routeWorkspaceId);
        UUID resourceId = requireId(id);
        if (versionId == null) {
            throw new IllegalArgumentException("Resource version target requires a version id");
        }
        return new TargetMetadata(
                TargetType.RESOURCE_VERSION,
                NativePolicyTemplates.resourceVersionKey(workspaceId, resourceId, versionId),
                workspaceId,
                resourceId,
                versionId);
    }

    private static TargetMetadata workspaceChild(
            TargetType type,
            @Nullable UUID routeWorkspaceId,
            @Nullable UUID id,
            BiFunction<UUID, UUID, String> keyBuilder) {
        UUID workspaceId = requireRouteWorkspace(routeWorkspaceId);
        UUID objectId = requireId(id);
        return new TargetMetadata(
                type, keyBuilder.apply(workspaceId, objectId), workspaceId, objectId, null);
    }

    private static Optional<TargetMetadata> parseWorkspaceChild(
            TargetType type, String targetKey, String... parts) {
        // targetTypeOf đã khớp toàn bộ key theo template cố định nên segment của key đã được
        // kiểm chứng; ở đây chỉ cần tách đúng vị trí workspace và đối tượng.
        if (parts.length != WORKSPACE_CHILD_KEY_PARTS || !"workspace".equals(parts[0])) {
            return Optional.empty();
        }
        return Optional.of(
                new TargetMetadata(type, targetKey, uuid(parts[1]), uuid(parts[3]), null));
    }

    private static Optional<TargetMetadata> parseResourceVersion(
            TargetType type, String targetKey, String... parts) {
        if (parts.length != RESOURCE_VERSION_KEY_PARTS
                || !"workspace".equals(parts[0])
                || !"resource".equals(parts[2])
                || !"version".equals(parts[4])) {
            return Optional.empty();
        }
        return Optional.of(
                new TargetMetadata(
                        type, targetKey, uuid(parts[1]), uuid(parts[3]), uuid(parts[5])));
    }

    private static UUID requireRouteWorkspace(@Nullable UUID routeWorkspaceId) {
        if (routeWorkspaceId == null) {
            throw new IllegalArgumentException("Target requires a workspace route id");
        }
        return routeWorkspaceId;
    }

    private static UUID requireId(@Nullable UUID id) {
        if (id == null) {
            throw new IllegalArgumentException("Target requires an id");
        }
        return id;
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
