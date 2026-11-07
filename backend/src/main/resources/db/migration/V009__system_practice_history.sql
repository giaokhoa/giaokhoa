-- Lịch sử practice mẫu chỉ thuộc personal workspace của người làm: RLS khóa mọi hàng
-- theo context workspace của transaction, và trigger dưới đây khóa phần DB có thể khóa
-- được của ràng buộc nghiệp vụ — workspace đích phải là personal workspace của chính
-- user, resource phải thuộc workspace hệ thống và version phải đúng của resource đó
-- ở trạng thái đã khoá (đã phát hành). Eligibility của actor do PDP quyết định ở tầng
-- trên; ở đây không tạo enrollment, gói hay role nào để "đủ điều kiện" practice.
CREATE TABLE system_practice_attempt_sample (
    id UUID PRIMARY KEY,
    personal_workspace_id UUID NOT NULL REFERENCES workspace(id),
    user_id UUID NOT NULL REFERENCES user_account(id),
    system_resource_id UUID NOT NULL REFERENCES resource(id),
    version_id UUID NOT NULL REFERENCES resource_version(id),
    attempted_at TIMESTAMPTZ NOT NULL,
    content_stub TEXT NOT NULL CHECK (btrim(content_stub) <> ''),
    outcome_stub TEXT CHECK (outcome_stub IS NULL OR btrim(outcome_stub) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX ix_practice_history_workspace_time
    ON system_practice_attempt_sample(personal_workspace_id, attempted_at DESC);

ALTER TABLE system_practice_attempt_sample ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_practice_workspace_isolation ON system_practice_attempt_sample
    USING (personal_workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
    WITH CHECK (
        personal_workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

CREATE FUNCTION validate_practice_attempt() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    workspace_kind VARCHAR(16);
    workspace_owner UUID;
    resource_owner UUID;
    version_resource UUID;
    version_state VARCHAR(16);
BEGIN
    SELECT kind, owner_user_id INTO workspace_kind, workspace_owner
    FROM workspace WHERE id = NEW.personal_workspace_id;
    IF workspace_kind <> 'PERSONAL' OR workspace_owner <> NEW.user_id THEN
        RAISE EXCEPTION 'Practice history requires the actor own personal workspace'
            USING ERRCODE = '23514';
    END IF;
    SELECT owner_workspace_id INTO resource_owner
    FROM resource WHERE id = NEW.system_resource_id;
    IF NOT EXISTS (
        SELECT 1 FROM workspace WHERE id = resource_owner AND kind = 'SYSTEM'
    ) THEN
        RAISE EXCEPTION 'Practice requires a system resource' USING ERRCODE = '23514';
    END IF;
    SELECT resource_id, review_state INTO version_resource, version_state
    FROM resource_version WHERE id = NEW.version_id;
    IF version_resource <> NEW.system_resource_id OR version_state <> 'LOCKED' THEN
        RAISE EXCEPTION 'Practice requires a published version of the system resource'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_practice_attempt_source BEFORE INSERT ON system_practice_attempt_sample
    FOR EACH ROW EXECUTE FUNCTION validate_practice_attempt();

-- Lịch sử practice là bất biến: chỉ outcome được bổ sung sau khi làm, các cột định danh
-- và nội dung đã ghi không đổi, hàng không bị hard-delete.
CREATE FUNCTION guard_practice_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Practice history cannot be hard-deleted' USING ERRCODE = '23514';
    END IF;
    IF (OLD.id, OLD.personal_workspace_id, OLD.user_id, OLD.system_resource_id,
            OLD.version_id, OLD.attempted_at, OLD.content_stub, OLD.created_at)
        IS DISTINCT FROM
        (NEW.id, NEW.personal_workspace_id, NEW.user_id, NEW.system_resource_id,
            NEW.version_id, NEW.attempted_at, NEW.content_stub, NEW.created_at) THEN
        RAISE EXCEPTION 'Practice history identity cannot change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_practice_history_immutable BEFORE UPDATE OR DELETE
    ON system_practice_attempt_sample
    FOR EACH ROW EXECUTE FUNCTION guard_practice_history();
