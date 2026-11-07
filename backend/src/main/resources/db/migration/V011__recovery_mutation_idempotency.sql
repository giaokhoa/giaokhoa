-- Chỉ lưu biên nhận mutation; đây không phải work queue và không chứa credential.
CREATE TABLE recovery_mutation (
    actor_user_id UUID NOT NULL REFERENCES user_account(id),
    idempotency_key VARCHAR(255) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    request_id UUID NOT NULL REFERENCES recovery_request(id) DEFERRABLE INITIALLY DEFERRED,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('SUBMIT', 'RESOLVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (actor_user_id, idempotency_key)
);
