ALTER TABLE "system_outcome_packages"
  ADD COLUMN "status" text NOT NULL DEFAULT 'published',
  ADD COLUMN "centre_slug" text,
  ADD COLUMN "reviewed_by" uuid,
  ADD COLUMN "reviewed_at" timestamptz,
  ADD COLUMN "rejection_reason" text,
  ADD CONSTRAINT "system_outcome_packages_status_check" CHECK ("status" IN ('pending', 'published', 'rejected')),
  ADD CONSTRAINT "system_outcome_packages_review_check" CHECK (
    ("status" = 'pending' AND "reviewed_at" IS NULL AND "rejection_reason" IS NULL)
    OR ("status" = 'published' AND "rejection_reason" IS NULL)
    OR ("status" = 'rejected' AND "reviewed_at" IS NOT NULL AND "rejection_reason" IS NOT NULL AND length(btrim("rejection_reason")) > 0)
  );
--> statement-breakpoint
ALTER TABLE "system_outcome_package_curricula"
  ADD COLUMN "subject_name" text,
  ADD COLUMN "subject_position" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE INDEX "system_outcome_packages_status_created_idx" ON "system_outcome_packages" ("status", "created_at" DESC);
