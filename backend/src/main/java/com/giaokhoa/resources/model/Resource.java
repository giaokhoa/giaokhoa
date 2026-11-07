package com.giaokhoa.resources.model;

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
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "resource")
public class Resource {
    public enum Kind {
        QUESTION,
        EXAM,
        MATRIX
    }

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "owner_workspace_id", nullable = false)
    private UUID ownerWorkspaceId;

    @Column(name = "created_by_user_id", nullable = false)
    private UUID createdByUserId;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, length = 16)
    private Kind kind;

    @Column(name = "subject_id", nullable = false)
    private UUID subjectId;

    @Column(name = "state", nullable = false, length = 32)
    private String state;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected Resource() {}

    public Resource(
            UUID id,
            UUID ownerWorkspaceId,
            UUID createdByUserId,
            Kind kind,
            UUID subjectId,
            String state) {
        this.id = id;
        this.ownerWorkspaceId = ownerWorkspaceId;
        this.createdByUserId = createdByUserId;
        this.kind = kind;
        this.subjectId = subjectId;
        this.state = state;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOwnerWorkspaceId() {
        return ownerWorkspaceId;
    }

    public UUID getCreatedByUserId() {
        return createdByUserId;
    }

    public Kind getKind() {
        return kind;
    }

    public UUID getSubjectId() {
        return subjectId;
    }

    public String getState() {
        return state;
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
