package com.giaokhoa.authorization.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "authorization_operation")
public class AuthorizationOperation {
    public enum State { PENDING, APPLYING, SUCCEEDED, RETRYABLE_FAILURE, FAILED }

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;
    @Column(name = "initiator_user_id", nullable = false)
    private UUID initiatorUserId;
    @Column(name = "workspace_id")
    private UUID workspaceId;
    @Column(name = "idempotency_key", nullable = false, length = 255)
    private String idempotencyKey;
    @Column(name = "payload_hash", nullable = false, length = 64)
    private String payloadHash;
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "affected_partitions", nullable = false, columnDefinition = "uuid[]")
    private UUID[] affectedPartitions;
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "affected_revisions", nullable = false, columnDefinition = "bigint[]")
    private Long[] affectedRevisions;
    @Column(name = "desired_revision", nullable = false)
    private long desiredRevision;
    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false, length = 24)
    private State state;
    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;
    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;
    @Column(name = "last_error_code", length = 64)
    private String lastErrorCode;
    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected AuthorizationOperation() {}

    public AuthorizationOperation(UUID id, UUID initiatorUserId, UUID workspaceId,
                                  String idempotencyKey, String payloadHash,
                                  UUID[] affectedPartitions, Long[] affectedRevisions, long desiredRevision) {
        this.id = id;
        this.initiatorUserId = initiatorUserId;
        this.workspaceId = workspaceId;
        this.idempotencyKey = idempotencyKey;
        this.payloadHash = payloadHash;
        this.affectedPartitions = affectedPartitions;
        this.affectedRevisions = affectedRevisions;
        this.desiredRevision = desiredRevision;
        this.state = State.PENDING;
    }

    public UUID getId() { return id; }
    public UUID getInitiatorUserId() { return initiatorUserId; }
    public UUID getWorkspaceId() { return workspaceId; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public String getPayloadHash() { return payloadHash; }
    public UUID[] getAffectedPartitions() { return affectedPartitions; }
    public Long[] getAffectedRevisions() { return affectedRevisions; }
    public long getDesiredRevision() { return desiredRevision; }
    public State getState() { return state; }
    public int getAttemptCount() { return attemptCount; }
    public Instant getNextAttemptAt() { return nextAttemptAt; }
    public String getLastErrorCode() { return lastErrorCode; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public long getVersion() { return version; }
}
