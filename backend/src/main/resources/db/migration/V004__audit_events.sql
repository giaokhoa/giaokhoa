-- Audit chỉ lưu định danh và kết quả, không lưu payload, credentials hay nội dung riêng.
CREATE TABLE audit_event (
    id UUID PRIMARY KEY,
    actor_user_id UUID REFERENCES user_account(id),
    workspace_id UUID REFERENCES workspace(id),
    action VARCHAR(32) NOT NULL CHECK (action IN (
        'PRIVILEGE_CHANGE', 'SUBSCRIPTION_CHANGE', 'RELATIONSHIP_CHANGE',
        'RECOVERY', 'AUTHORIZATION_SYNC'
    )),
    target_type VARCHAR(32) NOT NULL CHECK (target_type IN (
        'ACCOUNT', 'WORKSPACE', 'MEMBERSHIP', 'SUBSCRIPTION',
        'RELATIONSHIP', 'GRANT', 'AUTHORIZATION_OPERATION'
    )),
    target_id UUID NOT NULL,
    operation_id UUID REFERENCES authorization_operation(id),
    outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('PENDING', 'SUCCEEDED', 'FAILED')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_audit_workspace_occurred ON audit_event(workspace_id, occurred_at DESC);
CREATE INDEX ix_audit_operation ON audit_event(operation_id) WHERE operation_id IS NOT NULL;

-- Audit là lịch sử bất biến; ghi bản ghi mới để biểu diễn trạng thái mới.
CREATE FUNCTION reject_audit_event_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Audit history cannot be modified or deleted' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER ck_audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event
    FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
CREATE TRIGGER ck_audit_event_no_truncate BEFORE TRUNCATE ON audit_event
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();
