package com.giaokhoa.tenancy.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.io.Serial;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.jspecify.annotations.Nullable;

@Entity
@Table(name = "membership_role")
public class MembershipRole {
    public enum Role {
        OWNER,
        MANAGER,
        TEACHER,
        STUDENT,
        PARENT
    }

    @Embeddable
    public static class Key implements Serializable {
        @Serial private static final long serialVersionUID = 1L;

        @Column(name = "membership_id", nullable = false)
        private UUID membershipId;

        @Enumerated(EnumType.STRING)
        @Column(name = "role", nullable = false, length = 16)
        private Role role;

        protected Key() {}

        public Key(UUID membershipId, Role role) {
            this.membershipId = membershipId;
            this.role = role;
        }

        public UUID getMembershipId() {
            return membershipId;
        }

        public Role getRole() {
            return role;
        }

        @Override
        public boolean equals(@Nullable Object other) {
            if (this == other) return true;
            if (!(other instanceof Key key)) return false;
            return Objects.equals(membershipId, key.membershipId) && role == key.role;
        }

        @Override
        public int hashCode() {
            return Objects.hash(membershipId, role);
        }
    }

    @EmbeddedId private Key id;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected MembershipRole() {}

    public MembershipRole(UUID membershipId, Role role) {
        this.id = new Key(membershipId, role);
    }

    public Key getId() {
        return id;
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
