package com.giaokhoa.verification.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.jspecify.annotations.Nullable;

@Entity
@Table(name = "system_practice_attempt_sample")
public class SystemPracticeAttemptSample {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "personal_workspace_id", nullable = false)
    private UUID personalWorkspaceId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "system_resource_id", nullable = false)
    private UUID systemResourceId;

    @Column(name = "version_id", nullable = false)
    private UUID versionId;

    @Column(name = "attempted_at", nullable = false)
    private Instant attemptedAt;

    @Column(name = "content_stub", nullable = false)
    private String contentStub;

    @Column(name = "outcome_stub")
    private @Nullable String outcomeStub;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected SystemPracticeAttemptSample() {}

    public SystemPracticeAttemptSample(
            UUID id,
            UUID personalWorkspaceId,
            UUID userId,
            UUID systemResourceId,
            UUID versionId,
            Instant attemptedAt,
            String contentStub,
            @Nullable String outcomeStub) {
        this.id = id;
        this.personalWorkspaceId = personalWorkspaceId;
        this.userId = userId;
        this.systemResourceId = systemResourceId;
        this.versionId = versionId;
        this.attemptedAt = attemptedAt;
        this.contentStub = contentStub;
        this.outcomeStub = outcomeStub;
    }

    public UUID getId() {
        return id;
    }

    public UUID getPersonalWorkspaceId() {
        return personalWorkspaceId;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getSystemResourceId() {
        return systemResourceId;
    }

    public UUID getVersionId() {
        return versionId;
    }

    public Instant getAttemptedAt() {
        return attemptedAt;
    }

    public String getContentStub() {
        return contentStub;
    }

    public @Nullable String getOutcomeStub() {
        return outcomeStub;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public long getVersion() {
        return version;
    }
}
