ALTER TABLE "resources"
  ADD COLUMN "system_material_id" uuid,
  ADD COLUMN "system_material_version" integer,
  ADD COLUMN "system_material_checksum" text,
  ADD CONSTRAINT "resources_system_material_reference_check" CHECK (
    ("system_material_id" IS NULL AND "system_material_version" IS NULL AND "system_material_checksum" IS NULL)
    OR ("system_material_id" IS NOT NULL AND "system_material_version" IS NOT NULL AND "system_material_version" > 0
      AND "system_material_checksum" IS NOT NULL AND "system_material_checksum" ~ '^[0-9a-f]{64}$'
      AND "file_id" IS NULL AND "url" IS NULL AND "transcript" IS NULL)
  );
--> statement-breakpoint
ALTER TABLE "content_bank_content" ADD COLUMN "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE RESTRICT;
--> statement-breakpoint
DO $$
DECLARE
  previous_platform text := current_setting('app.platform', true);
  unresolved_count integer;
  unresolved_examples text;
BEGIN
  PERFORM set_config('app.platform', 'on', true);
  UPDATE "content_bank_content" AS item SET "tenant_id" = COALESCE(
    (SELECT tenant.id FROM "context" AS anchor JOIN "context" AS tenant_context
      ON tenant_context.context_level = 20 AND
        (anchor.path = tenant_context.path OR anchor.path LIKE tenant_context.path || '/%')
      JOIN "tenants" AS tenant ON tenant.id = tenant_context.instance_id
      WHERE anchor.id = item.context_id LIMIT 1),
    (SELECT course.tenant_id FROM "context" AS anchor JOIN "context" AS course_context
      ON course_context.context_level = 50 AND
        (anchor.path = course_context.path OR anchor.path LIKE course_context.path || '/%')
      JOIN "course" ON course.id = course_context.instance_id
      WHERE anchor.id = item.context_id LIMIT 1),
    (SELECT tenant_id FROM "cohort" WHERE id = item.space_id),
    (SELECT min(m.tenant_id::text)::uuid FROM "tenant_memberships" AS m
      WHERE m.user_id = item.creator_id
      HAVING count(DISTINCT m.tenant_id) = 1)
  );
  SELECT count(*) INTO unresolved_count FROM "content_bank_content" WHERE "tenant_id" IS NULL;
  IF unresolved_count > 0 THEN
    SELECT string_agg(id::text, ', ') INTO unresolved_examples FROM
      (SELECT id FROM "content_bank_content" WHERE "tenant_id" IS NULL ORDER BY id LIMIT 5) AS samples;
    RAISE EXCEPTION 'contentbank.legacy_owner_unresolved: % items (examples: %); resolve ownership before migration',
      unresolved_count, unresolved_examples;
  END IF;
  PERFORM set_config('app.platform', COALESCE(previous_platform, ''), true);
END;
$$;
--> statement-breakpoint
ALTER TABLE "content_bank_content" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "content_bank_content" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
--> statement-breakpoint
CREATE INDEX "content_bank_content_tenant_idx" ON "content_bank_content" ("tenant_id");
--> statement-breakpoint
ALTER TABLE "content_bank_content" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "content_bank_content" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "content_bank_content"
  USING (current_setting('app.platform', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.platform', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "resources" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "resources"
  USING (EXISTS (SELECT 1 FROM "course" WHERE "course"."id" = "resources"."course"))
  WITH CHECK (EXISTS (SELECT 1 FROM "course" WHERE "course"."id" = "resources"."course"));
