CREATE TABLE user_account (
    id UUID PRIMARY KEY,
    keycloak_sub VARCHAR(512) NOT NULL UNIQUE CHECK (btrim(keycloak_sub) <> ''),
    username VARCHAR(255) NOT NULL UNIQUE CHECK (btrim(username) <> ''),
    email VARCHAR(320) CHECK (email IS NULL OR btrim(email) <> ''),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    origin VARCHAR(32) NOT NULL CHECK (origin IN ('SELF_REGISTERED', 'CENTER_ISSUED')),
    identity_state VARCHAR(32) NOT NULL CHECK (btrim(identity_state) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_user_verified_email CHECK (email IS NOT NULL OR NOT email_verified)
);

CREATE TABLE workspace (
    id UUID PRIMARY KEY,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('PERSONAL', 'CENTER', 'SYSTEM')),
    owner_user_id UUID REFERENCES user_account(id),
    center_id UUID,
    state VARCHAR(32) NOT NULL CHECK (btrim(state) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_workspace_kind_owner CHECK (
        (kind = 'PERSONAL' AND owner_user_id IS NOT NULL AND center_id IS NULL)
        OR (kind = 'CENTER' AND owner_user_id IS NULL AND center_id IS NOT NULL)
        OR (kind = 'SYSTEM' AND owner_user_id IS NULL AND center_id IS NULL)
    )
);
CREATE UNIQUE INDEX uq_workspace_personal_owner ON workspace(owner_user_id)
    WHERE kind = 'PERSONAL';

CREATE TABLE center (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL UNIQUE REFERENCES workspace(id),
    keycloak_organization_id VARCHAR(512) NOT NULL UNIQUE CHECK (btrim(keycloak_organization_id) <> ''),
    name VARCHAR(255) NOT NULL CHECK (btrim(name) <> ''),
    owner_user_id UUID NOT NULL REFERENCES user_account(id),
    state VARCHAR(32) NOT NULL CHECK (btrim(state) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_center_id_workspace UNIQUE (id, workspace_id)
);

-- Both references are deferred so a CENTER workspace and its center can be inserted together.
ALTER TABLE workspace ADD CONSTRAINT fk_workspace_center
    FOREIGN KEY (center_id, id) REFERENCES center(id, workspace_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE center_membership (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id),
    user_id UUID NOT NULL REFERENCES user_account(id),
    state VARCHAR(16) NOT NULL CHECK (state IN ('PENDING', 'ACTIVE', 'REVOKED')),
    joined_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_membership_revocation CHECK (
        (state IN ('PENDING', 'ACTIVE') AND revoked_at IS NULL)
        OR (state = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= joined_at)
    ),
    CONSTRAINT uq_membership_id_workspace UNIQUE (id, workspace_id)
);
CREATE UNIQUE INDEX uq_membership_current ON center_membership(workspace_id, user_id)
    WHERE state IN ('PENDING', 'ACTIVE');

CREATE TABLE membership_role (
    membership_id UUID NOT NULL REFERENCES center_membership(id),
    role VARCHAR(16) NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (membership_id, role)
);

CREATE TABLE subscription_period (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspace(id),
    valid_from TIMESTAMPTZ(0) NOT NULL,
    expires_at TIMESTAMPTZ(0) NOT NULL,
    confirmation_ref VARCHAR(255) NOT NULL UNIQUE CHECK (btrim(confirmation_ref) <> ''),
    confirmed_by UUID NOT NULL REFERENCES user_account(id),
    confirmed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_subscription_period_range CHECK (expires_at > valid_from)
);
CREATE INDEX ix_subscription_workspace_range ON subscription_period(workspace_id, valid_from, expires_at);

CREATE FUNCTION enforce_directory_workspace_kind() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    actual_kind VARCHAR(16);
BEGIN
    SELECT kind INTO actual_kind FROM workspace WHERE id = NEW.workspace_id;
    IF TG_TABLE_NAME = 'center_membership' AND actual_kind <> 'CENTER' THEN
        RAISE EXCEPTION 'Center membership requires a CENTER workspace' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'subscription_period' AND actual_kind NOT IN ('PERSONAL', 'CENTER') THEN
        RAISE EXCEPTION 'Subscription requires a PERSONAL or CENTER workspace' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_membership_workspace_kind BEFORE INSERT OR UPDATE OF workspace_id
    ON center_membership FOR EACH ROW EXECUTE FUNCTION enforce_directory_workspace_kind();
CREATE TRIGGER ck_subscription_workspace_kind BEFORE INSERT OR UPDATE OF workspace_id
    ON subscription_period FOR EACH ROW EXECUTE FUNCTION enforce_directory_workspace_kind();

CREATE FUNCTION enforce_directory_immutable_links() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'workspace' AND
        (OLD.kind IS DISTINCT FROM NEW.kind
         OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id) THEN
        RAISE EXCEPTION 'Workspace kind and personal owner cannot change' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'center' AND
        (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
         OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id) THEN
        RAISE EXCEPTION 'Center workspace and owner cannot change' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'center_membership' AND
        (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
         OR OLD.user_id IS DISTINCT FROM NEW.user_id) THEN
        RAISE EXCEPTION 'Membership workspace and user cannot change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_workspace_immutable_kind BEFORE UPDATE OF kind, owner_user_id ON workspace
    FOR EACH ROW EXECUTE FUNCTION enforce_directory_immutable_links();
CREATE TRIGGER ck_center_immutable_owner BEFORE UPDATE OF workspace_id, owner_user_id ON center
    FOR EACH ROW EXECUTE FUNCTION enforce_directory_immutable_links();
CREATE TRIGGER ck_membership_immutable_identity BEFORE UPDATE OF workspace_id, user_id
    ON center_membership FOR EACH ROW EXECUTE FUNCTION enforce_directory_immutable_links();

-- Deferred owner check: initial center, membership and OWNER role can share one transaction.
CREATE FUNCTION verify_center_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    target_workspace UUID;
    expected_owner UUID;
    workspace_kind VARCHAR(16);
BEGIN
    IF TG_TABLE_NAME = 'center' THEN
        target_workspace := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
    ELSIF TG_TABLE_NAME = 'center_membership' THEN
        target_workspace := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
    ELSIF TG_TABLE_NAME = 'workspace' THEN
        target_workspace := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE
        SELECT workspace_id INTO target_workspace FROM center_membership
        WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.membership_id ELSE NEW.membership_id END;
    END IF;

    SELECT c.owner_user_id, w.kind INTO expected_owner, workspace_kind
    FROM center c JOIN workspace w ON w.id = c.workspace_id
    WHERE c.workspace_id = target_workspace;
    IF expected_owner IS NOT NULL THEN
        IF workspace_kind <> 'CENTER' OR NOT EXISTS (
            SELECT 1 FROM center_membership m
            JOIN membership_role r ON r.membership_id = m.id AND r.role = 'OWNER'
            WHERE m.workspace_id = target_workspace AND m.user_id = expected_owner
                AND m.state IN ('PENDING', 'ACTIVE')
        ) OR EXISTS (
            SELECT 1 FROM center_membership m
            JOIN membership_role r ON r.membership_id = m.id AND r.role = 'OWNER'
            WHERE m.workspace_id = target_workspace
                AND (m.user_id <> expected_owner OR m.state = 'REVOKED')
        ) THEN
            RAISE EXCEPTION 'CENTER requires exactly its designated owner membership and OWNER role'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER ck_center_owner AFTER INSERT OR UPDATE OR DELETE ON center
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_center_owner();
CREATE CONSTRAINT TRIGGER ck_membership_owner AFTER INSERT OR UPDATE OR DELETE ON center_membership
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_center_owner();
CREATE CONSTRAINT TRIGGER ck_role_owner AFTER INSERT OR UPDATE OR DELETE ON membership_role
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_center_owner();
CREATE CONSTRAINT TRIGGER ck_workspace_center_owner AFTER INSERT OR UPDATE ON workspace
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_center_owner();

-- Every directory account owns exactly one PERSONAL workspace at transaction commit.
CREATE FUNCTION verify_user_personal_workspace() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    owner_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'user_account' THEN
        owner_id := NEW.id;
    ELSE
        owner_id := OLD.owner_user_id;
    END IF;
    IF owner_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM user_account WHERE id = owner_id)
        AND NOT EXISTS (
            SELECT 1 FROM workspace WHERE kind = 'PERSONAL' AND owner_user_id = owner_id
        ) THEN
        RAISE EXCEPTION 'User account requires a personal workspace' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER ck_user_has_personal_workspace AFTER INSERT ON user_account
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_user_personal_workspace();
CREATE CONSTRAINT TRIGGER ck_personal_workspace_survives AFTER DELETE ON workspace
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_user_personal_workspace();

-- Giữ lịch sử membership và xác nhận gói khi thu hồi, cấp lại hoặc gia hạn.
CREATE FUNCTION guard_directory_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '% history cannot be hard-deleted', TG_TABLE_NAME USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME = 'center_membership' THEN
        IF OLD.id IS DISTINCT FROM NEW.id
            OR OLD.joined_at IS DISTINCT FROM NEW.joined_at
            OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
            RAISE EXCEPTION 'Membership identity and join history cannot change' USING ERRCODE = '23514';
        END IF;
        IF OLD.state = 'REVOKED' AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'Revoked membership cannot be modified' USING ERRCODE = '23514';
        END IF;
        IF OLD.state = 'ACTIVE' AND NEW.state = 'PENDING' THEN
            RAISE EXCEPTION 'Active membership cannot return to PENDING' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF (OLD.id, OLD.workspace_id, OLD.confirmation_ref, OLD.confirmed_by,
                OLD.confirmed_at, OLD.created_at)
            IS DISTINCT FROM
            (NEW.id, NEW.workspace_id, NEW.confirmation_ref, NEW.confirmed_by,
                NEW.confirmed_at, NEW.created_at) THEN
            RAISE EXCEPTION 'Subscription confirmation history cannot change' USING ERRCODE = '23514';
        END IF;
        IF (OLD.valid_from, OLD.expires_at) IS DISTINCT FROM (NEW.valid_from, NEW.expires_at)
            AND (OLD.valid_from <= CURRENT_TIMESTAMP
                OR NEW.valid_from <= CURRENT_TIMESTAMP
                OR NEW.version <= OLD.version) THEN
            RAISE EXCEPTION 'Only future subscription periods may change with a new version'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_membership_preserve_history BEFORE UPDATE OR DELETE ON center_membership
    FOR EACH ROW EXECUTE FUNCTION guard_directory_history();
CREATE TRIGGER ck_subscription_preserve_history BEFORE UPDATE OR DELETE ON subscription_period
    FOR EACH ROW EXECUTE FUNCTION guard_directory_history();
