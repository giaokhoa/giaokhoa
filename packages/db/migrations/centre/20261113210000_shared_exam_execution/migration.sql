ALTER TABLE exams DROP CONSTRAINT exams_kind_check;
ALTER TABLE exams ADD CONSTRAINT exams_kind_check CHECK (kind IN ('snapshot', 'system_execution'));
ALTER TABLE exams ADD COLUMN shared_exam_version_id uuid;
ALTER TABLE exams ADD COLUMN shared_source_exam_id uuid;
ALTER TABLE exams ADD COLUMN shared_source_version_number integer;
ALTER TABLE exams ADD COLUMN shared_requested_section_id uuid;
ALTER TABLE exams ADD COLUMN shared_request_checksum text;
ALTER TABLE exams ADD CONSTRAINT exams_shared_execution_check CHECK (
  (kind = 'snapshot' AND shared_exam_version_id IS NULL AND shared_source_exam_id IS NULL AND shared_source_version_number IS NULL AND shared_requested_section_id IS NULL AND shared_request_checksum IS NULL)
  OR (kind = 'system_execution' AND shared_exam_version_id IS NOT NULL AND shared_source_exam_id IS NOT NULL AND shared_source_version_number > 0 AND pin_request_id IS NOT NULL AND shared_requested_section_id IS NOT NULL AND shared_request_checksum ~ '^[0-9a-f]{64}$')
);
CREATE INDEX exams_shared_exam_version_idx ON exams(shared_exam_version_id) WHERE shared_exam_version_id IS NOT NULL;
