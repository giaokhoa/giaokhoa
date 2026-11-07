-- Recovery request là record tối thiểu phục vụ verification của platform operator cho
-- tài khoản không tự khôi phục được qua email. Vòng đời REQUESTED → VERIFIED →
-- RESOLVED/REJECTED được khóa ngay tại DB qua cặp verified_by/resolved_at theo trạng
-- thái, và lịch sử xác minh không được hard-delete hay đổi các cột định danh.
CREATE TABLE recovery_request (
    id UUID PRIMARY KEY,
    requester_user_id UUID NOT NULL REFERENCES user_account(id),
    workspace_id UUID REFERENCES workspace(id),
    target_user_id UUID NOT NULL REFERENCES user_account(id),
    state VARCHAR(16) NOT NULL CHECK (state IN ('REQUESTED', 'VERIFIED', 'RESOLVED', 'REJECTED')),
    verified_by UUID REFERENCES user_account(id),
    resolved_at TIMESTAMPTZ,
    verification_note VARCHAR(1000) CHECK (verification_note IS NULL OR btrim(verification_note) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_recovery_request_verification CHECK (
        (state = 'REQUESTED' AND verified_by IS NULL AND resolved_at IS NULL)
        OR (state = 'VERIFIED' AND verified_by IS NOT NULL AND resolved_at IS NULL)
        OR (state IN ('RESOLVED', 'REJECTED') AND verified_by IS NOT NULL AND resolved_at IS NOT NULL)
    )
);
CREATE INDEX ix_recovery_request_state ON recovery_request (state, created_at);
CREATE INDEX ix_recovery_request_target ON recovery_request (target_user_id, state);

CREATE FUNCTION guard_recovery_request_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Recovery request history cannot be hard-deleted' USING ERRCODE = '23514';
    END IF;
    IF OLD.id IS DISTINCT FROM NEW.id
        OR OLD.requester_user_id IS DISTINCT FROM NEW.requester_user_id
        OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
        OR OLD.target_user_id IS DISTINCT FROM NEW.target_user_id
        OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Recovery request identity cannot change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ck_recovery_request_preserve_history BEFORE UPDATE OR DELETE ON recovery_request
    FOR EACH ROW EXECUTE FUNCTION guard_recovery_request_history();
