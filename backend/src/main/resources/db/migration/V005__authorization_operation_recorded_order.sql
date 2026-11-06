-- The queue order of operations must be the order they were recorded in. created_at
-- defaults to CURRENT_TIMESTAMP, which is the transaction start time, so operations
-- recorded by one transaction share the same created_at and ordering by it degenerates
-- to the random primary key: a younger operation could be claimed before an older one
-- touching the same partition. A per-row identity records the actual insertion order.
ALTER TABLE authorization_operation
    ADD COLUMN recorded_seq BIGINT GENERATED ALWAYS AS IDENTITY;
