CREATE TABLE resource (
    id UUID PRIMARY KEY,
    owner_workspace_id UUID NOT NULL REFERENCES workspace(id),
    created_by_user_id UUID NOT NULL REFERENCES user_account(id),
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('QUESTION', 'EXAM', 'MATRIX')),
    subject_id UUID NOT NULL,
    state VARCHAR(32) NOT NULL CHECK (btrim(state) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX ix_resource_owner_state ON resource(owner_workspace_id, state);

CREATE TABLE resource_version (
    id UUID PRIMARY KEY,
    resource_id UUID NOT NULL REFERENCES resource(id),
    version_no INTEGER NOT NULL CHECK (version_no >= 1),
    label VARCHAR(255) NOT NULL CHECK (btrim(label) <> ''),
    body_stub TEXT NOT NULL,
    answer_stub TEXT,
    review_state VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
        CHECK (review_state IN ('DRAFT', 'APPROVED', 'LOCKED')),
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_resource_version_no UNIQUE (resource_id, version_no),
    CONSTRAINT ck_resource_version_lock CHECK ((review_state = 'LOCKED') = (locked_at IS NOT NULL))
);

-- Owner của resource là căn cứ phạm vi quyền nên không đổi trong thao tác thường.
CREATE FUNCTION enforce_resource_immutable_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.owner_workspace_id IS DISTINCT FROM NEW.owner_workspace_id THEN
        RAISE EXCEPTION 'Resource owner workspace cannot change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_resource_immutable_owner BEFORE UPDATE OF owner_workspace_id ON resource
    FOR EACH ROW EXECUTE FUNCTION enforce_resource_immutable_owner();

-- Version chỉ tiến DRAFT -> APPROVED -> LOCKED; khi đã khoá thì nội dung là lịch sử bất biến
-- vì bản đã lưu/giao không được sửa tại chỗ, muốn đổi phải tạo version mới.
CREATE FUNCTION guard_resource_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.locked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Locked resource version cannot be modified' USING ERRCODE = '23514';
    END IF;
    IF (OLD.review_state = 'DRAFT' AND NEW.review_state = 'LOCKED')
        OR (OLD.review_state = 'APPROVED' AND NEW.review_state = 'DRAFT') THEN
        RAISE EXCEPTION 'Resource version review state must advance DRAFT -> APPROVED -> LOCKED'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_resource_version_guard BEFORE UPDATE ON resource_version
    FOR EACH ROW EXECUTE FUNCTION guard_resource_version();
