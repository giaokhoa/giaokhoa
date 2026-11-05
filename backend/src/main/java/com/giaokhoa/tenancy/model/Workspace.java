package com.giaokhoa.tenancy.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;

@Entity
@Table(name = "workspace")
public class Workspace {
    public enum Kind { PERSONAL, CENTER, SYSTEM }

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, length = 16)
    private Kind kind;

    @Column(name = "owner_user_id")
    private UUID ownerUserId;

    @Column(name = "center_id")
    private UUID centerId;

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

    protected Workspace() {
    }

    public Workspace(UUID id, Kind kind, UUID ownerUserId, UUID centerId, String state) {
        this.id = id;
        this.kind = kind;
        this.ownerUserId = ownerUserId;
        this.centerId = centerId;
        this.state = state;
    }

    public UUID getId() {
        return id;
    }

    public Kind getKind() {
        return kind;
    }

    public UUID getOwnerUserId() {
        return ownerUserId;
    }

    public UUID getCenterId() {
        return centerId;
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
