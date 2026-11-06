-- Một READY chưa có applied hash phải quay về fence, cùng mọi dependent của nó.
DO $$
DECLARE
    affected UUID[];
BEGIN
    WITH RECURSIVE closure(id) AS (
        SELECT partition_id FROM authz_projection
        WHERE state = 'READY' AND applied_hash IS NULL
        UNION
        SELECT p.partition_id FROM authz_projection p
        JOIN closure c ON c.id = ANY(p.dependency_partition_ids)
    )
    SELECT array_agg(id) INTO affected FROM closure;

    UPDATE authz_partition SET state = 'PENDING' WHERE id = ANY(affected);
    UPDATE authz_projection SET state = 'PENDING' WHERE partition_id = ANY(affected);
END;
$$;

-- Xử lý deferred trigger của các dòng vừa fence trước khi đổi constraint.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE authz_projection DROP CONSTRAINT ck_authz_projection_ready;
ALTER TABLE authz_projection ADD CONSTRAINT ck_authz_projection_ready CHECK (
    state <> 'READY' OR (
        applied_hash IS NOT NULL AND applied_hash = desired_hash
        AND keycloak_resource_id IS NOT NULL
    )
);
