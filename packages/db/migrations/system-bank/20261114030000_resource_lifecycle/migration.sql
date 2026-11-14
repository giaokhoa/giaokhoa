ALTER TABLE system_bank_events
  ALTER COLUMN source_question_id DROP NOT NULL,
  ADD COLUMN resource_kind text,
  ADD COLUMN resource_key text,
  ADD CONSTRAINT system_bank_events_resource_check CHECK (
    (source_question_id IS NOT NULL AND resource_kind IS NULL AND resource_key IS NULL)
    OR (source_question_id IS NULL AND resource_kind IN ('exam', 'material', 'programme') AND length(resource_key) > 0)
  );
--> statement-breakpoint
CREATE INDEX system_bank_events_resource_idx ON system_bank_events (resource_kind, resource_key, created_at);
--> statement-breakpoint
ALTER TABLE system_exam_versions DROP CONSTRAINT system_exam_versions_status_check;
--> statement-breakpoint
ALTER TABLE system_exam_versions ADD COLUMN withdrawn_at timestamptz;
--> statement-breakpoint
ALTER TABLE system_exam_versions ADD COLUMN withdrawn_reason text;
--> statement-breakpoint
ALTER TABLE system_exam_versions ADD CONSTRAINT system_exam_versions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn'));
--> statement-breakpoint
ALTER TABLE system_exam_versions DROP CONSTRAINT system_exam_versions_review_check;
--> statement-breakpoint
ALTER TABLE system_exam_versions ADD CONSTRAINT system_exam_versions_review_check CHECK (
  (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
  OR (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
  OR (status = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(rejection_reason)) > 0)
  OR (status = 'withdrawn' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
    AND rejection_reason IS NULL AND withdrawn_at IS NOT NULL AND length(trim(withdrawn_reason)) > 0)
);
--> statement-breakpoint
ALTER TABLE system_materials
  ADD COLUMN status text NOT NULL DEFAULT 'published',
  ADD COLUMN withdrawn_at timestamptz,
  ADD COLUMN withdrawn_reason text,
  ADD CONSTRAINT system_materials_status_check CHECK (status IN ('published', 'withdrawn'));
--> statement-breakpoint
ALTER TABLE system_outcome_packages DROP CONSTRAINT system_outcome_packages_status_check;
--> statement-breakpoint
ALTER TABLE system_outcome_packages ADD COLUMN withdrawn_at timestamptz;
--> statement-breakpoint
ALTER TABLE system_outcome_packages ADD COLUMN withdrawn_reason text;
--> statement-breakpoint
ALTER TABLE system_outcome_packages ADD CONSTRAINT system_outcome_packages_status_check
  CHECK (status IN ('pending', 'published', 'rejected', 'withdrawn'));
--> statement-breakpoint
ALTER TABLE system_outcome_packages DROP CONSTRAINT system_outcome_packages_review_check;
--> statement-breakpoint
ALTER TABLE system_outcome_packages ADD CONSTRAINT system_outcome_packages_review_check CHECK (
  (status = 'pending' AND reviewed_at IS NULL AND rejection_reason IS NULL)
  OR (status = 'published' AND rejection_reason IS NULL)
  OR (status = 'rejected' AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) > 0)
  OR (status = 'withdrawn' AND reviewed_at IS NOT NULL AND rejection_reason IS NULL AND
    withdrawn_at IS NOT NULL AND length(btrim(withdrawn_reason)) > 0)
);
