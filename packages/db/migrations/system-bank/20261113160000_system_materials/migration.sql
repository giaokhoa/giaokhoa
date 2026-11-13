CREATE TABLE "system_materials" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "centre_slug" text NOT NULL,
  "source_content_id" uuid NOT NULL,
  UNIQUE ("centre_slug", "source_content_id")
);
--> statement-breakpoint
CREATE TABLE "system_material_versions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "material_id" uuid NOT NULL REFERENCES "system_materials"("id") ON DELETE RESTRICT,
  "version" integer NOT NULL CHECK ("version" > 0),
  "package" jsonb NOT NULL,
  "checksum" text NOT NULL CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("material_id", "version")
);
--> statement-breakpoint
CREATE TABLE "system_material_submissions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "centre_slug" text NOT NULL,
  "source_content_id" uuid NOT NULL,
  "source_revision" text NOT NULL,
  "package" jsonb NOT NULL,
  "checksum" text NOT NULL,
  "submitted_by" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
  "reviewed_by" uuid,
  "reviewed_at" timestamptz,
  "rejection_reason" text,
  "published_material_id" uuid,
  "published_version" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("centre_slug", "source_content_id", "source_revision"),
  FOREIGN KEY ("published_material_id", "published_version")
    REFERENCES "system_material_versions"("material_id", "version") ON DELETE RESTRICT,
  CHECK (
    ("status" = 'pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL
      AND "rejection_reason" IS NULL AND "published_material_id" IS NULL AND "published_version" IS NULL)
    OR ("status" = 'rejected' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL
      AND length(trim("rejection_reason")) > 0 AND "published_material_id" IS NULL AND "published_version" IS NULL)
    OR ("status" = 'approved' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL
      AND "rejection_reason" IS NULL AND "published_material_id" IS NOT NULL AND "published_version" > 0)
  )
);
--> statement-breakpoint
CREATE INDEX "system_material_submissions_pending_idx" ON "system_material_submissions" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX "system_material_submissions_publication_idx" ON "system_material_submissions" ("published_material_id", "published_version");
--> statement-breakpoint
CREATE FUNCTION reject_system_material_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'system_material.version_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "system_material_versions_immutable"
  BEFORE UPDATE OR DELETE ON "system_material_versions"
  FOR EACH ROW EXECUTE FUNCTION reject_system_material_version_mutation();
