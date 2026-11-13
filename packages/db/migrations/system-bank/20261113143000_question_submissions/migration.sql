CREATE TABLE "system_question_submissions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "centre_slug" text NOT NULL,
  "source_question_id" uuid NOT NULL,
  "source_version_id" uuid NOT NULL,
  "source_version_number" integer NOT NULL,
  "qtype" text NOT NULL,
  "package" jsonb NOT NULL,
  "checksum" text NOT NULL,
  "submitted_by" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "reviewed_by" uuid,
  "reviewed_at" timestamptz,
  "rejection_reason" text,
  "published_question_id" uuid REFERENCES "system_questions"("id") ON DELETE RESTRICT,
  "published_version" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "system_question_submissions_source_version_unique" UNIQUE ("centre_slug", "source_question_id", "source_version_id"),
  CONSTRAINT "system_question_submissions_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected')),
  CONSTRAINT "system_question_submissions_qtype_check" CHECK ("qtype" IN ('multichoice', 'truefalse', 'shortanswer', 'essay')),
  CONSTRAINT "system_question_submissions_review_state_check" CHECK (
    ("status" = 'pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL AND "rejection_reason" IS NULL AND "published_question_id" IS NULL AND "published_version" IS NULL)
    OR ("status" = 'rejected' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND length(trim("rejection_reason")) > 0 AND "published_question_id" IS NULL AND "published_version" IS NULL)
    OR ("status" = 'approved' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "rejection_reason" IS NULL AND "published_question_id" IS NOT NULL AND "published_version" > 0)
  )
);
--> statement-breakpoint
CREATE INDEX "system_question_submissions_status_created_idx" ON "system_question_submissions" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX "system_question_submissions_source_idx" ON "system_question_submissions" ("centre_slug", "source_question_id", "created_at");