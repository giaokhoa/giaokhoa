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

@Entity
@Table(name = "center")
public class Center {
    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "keycloak_organization_id", nullable = false, length = 512)
    private String keycloakOrganizationId;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "owner_user_id", nullable = false)
    private UUID ownerUserId;

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

    protected Center() {
    }

    public Center(UUID id, UUID workspaceId, String keycloakOrganizationId, String name, UUID ownerUserId, String state) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.keycloakOrganizationId = keycloakOrganizationId;
        this.name = name;
        this.ownerUserId = ownerUserId;
        this.state = state;
    }

    public UUID getId() {
        return id;
    }

    public UUID getWorkspaceId() {
        return workspaceId;
    }

    public String getKeycloakOrganizationId() {
        return keycloakOrganizationId;
    }

    public String getName() {
        return name;
    }

    public UUID getOwnerUserId() {
        return ownerUserId;
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
