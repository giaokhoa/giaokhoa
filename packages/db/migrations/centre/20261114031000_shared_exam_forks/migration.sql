ALTER TABLE exams
  ADD COLUMN system_exam_fork_version_id uuid,
  ADD CONSTRAINT exams_system_fork_kind_check CHECK (system_exam_fork_version_id IS NULL OR kind = 'snapshot');
