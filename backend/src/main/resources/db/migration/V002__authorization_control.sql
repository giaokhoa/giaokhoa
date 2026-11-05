CREATE TABLE authz_partition (
    id UUID PRIMARY KEY,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('WORKSPACE', 'GRANT', 'ACCOUNT')),
    owner_key VARCHAR(255) NOT NULL CHECK (btrim(owner_key) <> ''),
    desired_revision BIGINT NOT NULL DEFAULT 0 CHECK (desired_revision >= 0),
    applied_revision BIGINT NOT NULL DEFAULT 0 CHECK (applied_revision >= 0),
    state VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('READY', 'PENDING', 'FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_authz_partition_owner UNIQUE (kind, owner_key),
    CONSTRAINT ck_authz_partition_revision CHECK (applied_revision <= desired_revision),
    CONSTRAINT ck_authz_partition_ready CHECK (state <> 'READY' OR desired_revision = applied_revision)
);

CREATE TABLE authz_projection (
    id UUID PRIMARY KEY,
    partition_id UUID NOT NULL REFERENCES authz_partition(id),
    target_key VARCHAR(1024) NOT NULL UNIQUE CHECK (btrim(target_key) <> ''),
    keycloak_resource_id VARCHAR(512) CHECK (keycloak_resource_id IS NULL OR btrim(keycloak_resource_id) <> ''),
    policy_names TEXT[] NOT NULL DEFAULT '{}',
    dependency_partition_ids UUID[] NOT NULL DEFAULT '{}',
    desired_hash VARCHAR(64) NOT NULL CHECK (desired_hash ~ '^[0-9a-f]{64}$'),
    applied_hash VARCHAR(64) CHECK (applied_hash IS NULL OR applied_hash ~ '^[0-9a-f]{64}$'),
    state VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('READY', 'PENDING', 'FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_authz_projection_ready CHECK (
        state <> 'READY' OR (applied_hash = desired_hash AND keycloak_resource_id IS NOT NULL)
    )
);
CREATE INDEX ix_authz_projection_partition ON authz_projection(partition_id);
CREATE INDEX ix_authz_projection_dependencies ON authz_projection USING GIN(dependency_partition_ids);

CREATE TABLE authorization_operation (
    id UUID PRIMARY KEY,
    initiator_user_id UUID NOT NULL REFERENCES user_account(id),
    workspace_id UUID REFERENCES workspace(id),
    idempotency_key VARCHAR(255) NOT NULL CHECK (btrim(idempotency_key) <> ''),
    payload_hash VARCHAR(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    affected_partitions UUID[] NOT NULL,
    affected_revisions BIGINT[] NOT NULL,
    desired_revision BIGINT NOT NULL CHECK (desired_revision >= 0),
    state VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (state IN ('PENDING', 'APPLYING', 'SUCCEEDED', 'RETRYABLE_FAILURE', 'FAILED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ,
    last_error_code VARCHAR(64) CHECK (last_error_code IS NULL OR btrim(last_error_code) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_authz_operation_idempotency UNIQUE (initiator_user_id, idempotency_key),
    -- The scalar revision belongs to the first affected partition; each partition advances independently.
    CONSTRAINT ck_authz_operation_revision_vector CHECK ((
        array_ndims(affected_partitions) = 1 AND array_lower(affected_partitions, 1) = 1
        AND array_ndims(affected_revisions) = 1 AND array_lower(affected_revisions, 1) = 1
        AND cardinality(affected_revisions) = cardinality(affected_partitions)
        AND desired_revision = affected_revisions[1]
    ) IS TRUE),
    CONSTRAINT ck_authz_operation_succeeded CHECK (
        state <> 'SUCCEEDED' OR (next_attempt_at IS NULL AND last_error_code IS NULL)
    )
);
CREATE INDEX ix_authz_operation_queue ON authorization_operation(next_attempt_at, created_at)
    WHERE state IN ('PENDING', 'RETRYABLE_FAILURE');
CREATE INDEX ix_authz_operation_workspace ON authorization_operation(workspace_id, created_at DESC);

-- Arrays are control-plane references, not independent authorization sources.
CREATE FUNCTION validate_authz_partition_ids() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    ids UUID[];
BEGIN
    IF TG_TABLE_NAME = 'authz_projection' THEN
        ids := NEW.dependency_partition_ids;
    ELSE
        ids := NEW.affected_partitions;
    END IF;
    IF TG_TABLE_NAME = 'authorization_operation' THEN
        IF cardinality(ids) = 0
            OR cardinality(NEW.affected_revisions) <> cardinality(ids)
            OR EXISTS (SELECT 1 FROM unnest(NEW.affected_revisions) AS rev(value)
                       WHERE rev.value IS NULL OR rev.value < 0) THEN
            RAISE EXCEPTION 'Invalid operation revision vector' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ids) AS ref(id) WHERE ref.id IS NULL)
        OR cardinality(ids) <> (SELECT count(DISTINCT ref.id) FROM unnest(ids) AS ref(id))
        OR EXISTS (
            SELECT 1 FROM unnest(ids) AS referenced(id)
            WHERE NOT EXISTS (SELECT 1 FROM authz_partition p WHERE p.id = referenced.id)
        ) THEN
        RAISE EXCEPTION 'Invalid authorization partition references' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'authz_projection' THEN
        IF NEW.partition_id = ANY(ids) THEN
            RAISE EXCEPTION 'Projection cannot depend on its own partition' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_authz_projection_refs BEFORE INSERT OR UPDATE OF partition_id, dependency_partition_ids
    ON authz_projection FOR EACH ROW EXECUTE FUNCTION validate_authz_partition_ids();
CREATE TRIGGER ck_authz_operation_refs BEFORE INSERT OR UPDATE OF affected_partitions, affected_revisions
    ON authorization_operation FOR EACH ROW EXECUTE FUNCTION validate_authz_partition_ids();

-- Keep referenced partitions durable; array references cannot use a normal FK.
CREATE FUNCTION preserve_authz_partition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Authorization partitions cannot be deleted' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER ck_authz_partition_durable BEFORE DELETE ON authz_partition
    FOR EACH ROW EXECUTE FUNCTION preserve_authz_partition();

CREATE FUNCTION verify_authz_partition_ready() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    current_row authz_partition%ROWTYPE;
BEGIN
    SELECT * INTO current_row FROM authz_partition WHERE id = NEW.id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    IF current_row.state = 'READY' AND (
        current_row.desired_revision <> current_row.applied_revision
        OR EXISTS (
            SELECT 1 FROM authz_projection p
            WHERE p.partition_id = current_row.id AND p.state <> 'READY'
        )
    ) THEN
        RAISE EXCEPTION 'Partition cannot be READY with unapplied projections/revision'
            USING ERRCODE = '23514';
    END IF;

    -- Any source change must fence all dependent projections, even when
    -- the source reaches a newer READY revision within the same transaction.
    IF TG_OP = 'UPDATE' AND
        (OLD.desired_revision IS DISTINCT FROM NEW.desired_revision
         OR current_row.state <> 'READY') AND EXISTS (
            SELECT 1 FROM authz_projection p
            WHERE current_row.id = ANY(p.dependency_partition_ids) AND p.state = 'READY'
        ) THEN
        RAISE EXCEPTION 'Dependent projections must be fenced before source changes'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER ck_authz_partition_ready_deferred
    AFTER INSERT OR UPDATE ON authz_partition DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verify_authz_partition_ready();

-- Reject desired graph edits unless the owning scope is already fenced.
CREATE FUNCTION guard_authz_projection_desired() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    owner_id UUID;
    desired_changed BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        owner_id := OLD.partition_id;
        desired_changed := TRUE;
    ELSIF TG_OP = 'INSERT' THEN
        owner_id := NEW.partition_id;
        desired_changed := TRUE;
    ELSE
        IF OLD.partition_id <> NEW.partition_id THEN
            RAISE EXCEPTION 'Projection partition cannot change' USING ERRCODE = '23514';
        END IF;
        owner_id := NEW.partition_id;
        desired_changed := (OLD.target_key, OLD.keycloak_resource_id, OLD.policy_names,
                            OLD.dependency_partition_ids, OLD.desired_hash)
            IS DISTINCT FROM
            (NEW.target_key, NEW.keycloak_resource_id, NEW.policy_names,
             NEW.dependency_partition_ids, NEW.desired_hash);
    END IF;
    IF desired_changed AND EXISTS (
        SELECT 1 FROM authz_partition p WHERE p.id = owner_id AND p.state = 'READY'
    ) THEN
        RAISE EXCEPTION 'Desired projection changes require a partition fence'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_authz_projection_desired BEFORE INSERT OR UPDATE OR DELETE ON authz_projection
    FOR EACH ROW EXECUTE FUNCTION guard_authz_projection_desired();

CREATE FUNCTION verify_authz_projection_ready() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    current_row authz_projection%ROWTYPE;
BEGIN
    SELECT * INTO current_row FROM authz_projection WHERE id = NEW.id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    IF current_row.state = 'READY' AND EXISTS (
        SELECT 1 FROM unnest(current_row.dependency_partition_ids) AS dep(id)
        LEFT JOIN authz_partition p ON p.id = dep.id
        WHERE p.id IS NULL OR p.state <> 'READY'
            OR p.desired_revision <> p.applied_revision
    ) THEN
        RAISE EXCEPTION 'Projection dependencies must be READY' USING ERRCODE = '23514';
    END IF;

    IF current_row.state <> 'READY' AND EXISTS (
        SELECT 1 FROM authz_partition p
        WHERE p.id = current_row.partition_id AND p.state = 'READY'
    ) THEN
        RAISE EXCEPTION 'READY partition cannot contain a pending projection'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER ck_authz_projection_ready_deferred
    AFTER INSERT OR UPDATE ON authz_projection DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verify_authz_projection_ready();

-- Every existing and newly created identity/workspace starts fenced until Keycloak is reconciled.
INSERT INTO authz_partition(id, kind, owner_key)
    SELECT gen_random_uuid(), 'ACCOUNT', 'account:' || id FROM user_account;
INSERT INTO authz_partition(id, kind, owner_key)
    SELECT gen_random_uuid(), 'WORKSPACE', 'workspace:' || id FROM workspace;

CREATE FUNCTION create_authz_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO authz_partition(id, kind, owner_key)
    VALUES (gen_random_uuid(),
        CASE WHEN TG_TABLE_NAME = 'user_account' THEN 'ACCOUNT' ELSE 'WORKSPACE' END,
        CASE WHEN TG_TABLE_NAME = 'user_account' THEN 'account:' ELSE 'workspace:' END || NEW.id);
    RETURN NEW;
END;
$$;
CREATE TRIGGER tr_authz_account_scope AFTER INSERT ON user_account
    FOR EACH ROW EXECUTE FUNCTION create_authz_scope();
CREATE TRIGGER tr_authz_workspace_scope AFTER INSERT ON workspace
    FOR EACH ROW EXECUTE FUNCTION create_authz_scope();

-- Scope identity and revision counters are monotonic; an old READY fence cannot be restored.
CREATE FUNCTION guard_authz_partition_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.id, OLD.kind, OLD.owner_key) IS DISTINCT FROM (NEW.id, NEW.kind, NEW.owner_key)
        OR NEW.desired_revision < OLD.desired_revision
        OR NEW.applied_revision < OLD.applied_revision THEN
        RAISE EXCEPTION 'Partition identity/revision cannot be rewritten' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_authz_partition_monotonic BEFORE UPDATE ON authz_partition
    FOR EACH ROW EXECUTE FUNCTION guard_authz_partition_identity();

-- The operation row is the durable queue item AND the idempotency record.
CREATE FUNCTION guard_authz_operation_payload() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.id, OLD.initiator_user_id, OLD.workspace_id, OLD.idempotency_key,
        OLD.payload_hash, OLD.affected_partitions, OLD.affected_revisions, OLD.desired_revision)
        IS DISTINCT FROM
        (NEW.id, NEW.initiator_user_id, NEW.workspace_id, NEW.idempotency_key,
        NEW.payload_hash, NEW.affected_partitions, NEW.affected_revisions, NEW.desired_revision) THEN
        RAISE EXCEPTION 'Operation idempotency payload cannot change' USING ERRCODE = '23514';
    END IF;
    IF OLD.state IN ('SUCCEEDED', 'FAILED') AND OLD.state <> NEW.state THEN
        RAISE EXCEPTION 'Terminal authorization operation cannot restart' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_authz_operation_immutable_payload BEFORE UPDATE ON authorization_operation
    FOR EACH ROW EXECUTE FUNCTION guard_authz_operation_payload();

CREATE FUNCTION verify_authz_operation_succeeded() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    current_row authorization_operation%ROWTYPE;
BEGIN
    SELECT * INTO current_row FROM authorization_operation WHERE id = NEW.id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF current_row.state = 'SUCCEEDED' AND EXISTS (
        SELECT 1 FROM unnest(current_row.affected_partitions, current_row.affected_revisions)
            AS ref(id, revision)
        LEFT JOIN authz_partition p ON p.id = ref.id
        WHERE p.id IS NULL OR p.state <> 'READY'
            OR p.desired_revision <> ref.revision
            OR p.applied_revision <> ref.revision
    ) THEN
        RAISE EXCEPTION 'Operation cannot succeed before affected partitions are READY'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER ck_authz_operation_success_deferred
    AFTER INSERT OR UPDATE ON authorization_operation DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verify_authz_operation_succeeded();
