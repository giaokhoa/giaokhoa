package com.giaokhoa.shared.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.Immutable;
import org.jspecify.annotations.Nullable;

@Entity
@Immutable
@Table(name = "audit_event")
public class AuditEvent {
    public enum Action {
        PRIVILEGE_CHANGE,
        SUBSCRIPTION_CHANGE,
        RELATIONSHIP_CHANGE,
        RECOVERY,
        AUTHORIZATION_SYNC
    }

    public enum TargetType {
        ACCOUNT,
        WORKSPACE,
        MEMBERSHIP,
        SUBSCRIPTION,
        RELATIONSHIP,
        GRANT,
        AUTHORIZATION_OPERATION
    }

    public enum Outcome {
        PENDING,
        SUCCEEDED,
        FAILED
    }

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "actor_user_id")
    private @Nullable UUID actorUserId;

    @Column(name = "workspace_id")
    private @Nullable UUID workspaceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "action", nullable = false, length = 32)
    private Action action;

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", nullable = false, length = 32)
    private TargetType targetType;

    @Column(name = "target_id", nullable = false)
    private UUID targetId;

    @Column(name = "operation_id")
    private @Nullable UUID operationId;

    @Enumerated(EnumType.STRING)
    @Column(name = "outcome", nullable = false, length = 16)
    private Outcome outcome;

    @CreationTimestamp
    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    protected AuditEvent() {}

    public AuditEvent(
            UUID id,
            @Nullable UUID actorUserId,
            @Nullable UUID workspaceId,
            Action action,
            TargetType targetType,
            UUID targetId,
            @Nullable UUID operationId,
            Outcome outcome) {
        this.id = id;
        this.actorUserId = actorUserId;
        this.workspaceId = workspaceId;
        this.action = action;
        this.targetType = targetType;
        this.targetId = targetId;
        this.operationId = operationId;
        this.outcome = outcome;
    }

    public UUID getId() {
        return id;
    }

    public @Nullable UUID getActorUserId() {
        return actorUserId;
    }

    public @Nullable UUID getWorkspaceId() {
        return workspaceId;
    }

    public Action getAction() {
        return action;
    }

    public TargetType getTargetType() {
        return targetType;
    }

    public UUID getTargetId() {
        return targetId;
    }

    public @Nullable UUID getOperationId() {
        return operationId;
    }

    public Outcome getOutcome() {
        return outcome;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }
}
