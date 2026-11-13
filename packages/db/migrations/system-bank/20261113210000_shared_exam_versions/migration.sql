CREATE TABLE "system_exam_versions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "centre_slug" text NOT NULL,
  "source_exam_id" uuid NOT NULL,
  "source_version_id" uuid NOT NULL,
  "source_version_number" integer NOT NULL CHECK ("source_version_number" > 0),
  "package" jsonb NOT NULL,
  "checksum" text NOT NULL,
  "submitted_by" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
  "reviewed_by" uuid,
  "reviewed_at" timestamptz,
  "rejection_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "system_exam_versions_source_unique" UNIQUE ("centre_slug", "source_exam_id", "source_version_id"),
  CONSTRAINT "system_exam_versions_review_check" CHECK (
    ("status" = 'pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL AND "rejection_reason" IS NULL)
    OR ("status" = 'approved' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "rejection_reason" IS NULL)
    OR ("status" = 'rejected' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND length(trim("rejection_reason")) > 0)
  )
);
--> statement-breakpoint
CREATE INDEX "system_exam_versions_discovery_idx" ON "system_exam_versions" ("status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "system_exam_versions_centre_idx" ON "system_exam_versions" ("centre_slug", "created_at" DESC);