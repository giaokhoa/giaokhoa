ALTER TABLE "exam_revision_questions" ADD COLUMN "stimulus_snapshot" jsonb;
--> statement-breakpoint
-- Nơi phục vụ tệp kiểm cả quyền sở hữu lẫn capability trên ngữ cảnh người dùng.
INSERT INTO "authz_capabilities" ("key", "context_kind", "description") VALUES
  ('file:read_own', 'system', 'file:read_own')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "authz_role_permissions" ("role_id", "capability_id", "effect")
SELECT r."id", c."id", 'ALLOW'
FROM "authz_roles" r JOIN "authz_capabilities" c ON c."key" = 'file:read_own'
WHERE r."key" = 'system:user'
ON CONFLICT ("role_id", "capability_id") DO NOTHING;
