-- Tham chiếu câu hệ thống giữ định danh nguồn, không tạo câu editable hoặc FK xuyên kho.
ALTER TABLE exam_slots ADD COLUMN source_domain text NOT NULL DEFAULT 'centre'
  CHECK (source_domain IN ('centre', 'bank-system'));
ALTER TABLE exam_slots ADD COLUMN source_snapshot jsonb;
ALTER TABLE exam_slots DROP CONSTRAINT exam_slots_question_id_question_id_fkey;
ALTER TABLE exam_slots ADD COLUMN local_question_id uuid GENERATED ALWAYS AS
  (CASE WHEN source_domain = 'centre' THEN question_id END) STORED;
ALTER TABLE exam_slots ADD CONSTRAINT exam_slots_local_question_fk FOREIGN KEY (local_question_id) REFERENCES question(id) ON DELETE CASCADE;
CREATE INDEX exam_slots_local_question_idx ON exam_slots(local_question_id);
ALTER TABLE exam_slots ADD CONSTRAINT exam_slots_system_snapshot_check CHECK
  (source_domain = 'centre' OR (source_snapshot IS NOT NULL AND pinned_version_id IS NOT NULL AND pinned_version_number IS NOT NULL));

-- Bản chụp thi thuộc lần giao ở trung tâm, gồm cả byte ảnh đã được sao vào miền trung tâm.
ALTER TABLE exam_pins ADD COLUMN question_snapshots jsonb;
ALTER TABLE exam_pins ADD COLUMN request_id uuid;
-- Chốt section vào intent trước khi tạo CM để retry không đổi đích sau crash.
ALTER TABLE exam_pins ADD COLUMN requested_section_id uuid;
ALTER TABLE exam_pins ADD COLUMN preparation_state text NOT NULL DEFAULT 'ready'
  CHECK (preparation_state IN ('preparing', 'ready'));
CREATE UNIQUE INDEX exam_pins_request_idx ON exam_pins(course_id, created_by, request_id) WHERE request_id IS NOT NULL;

-- Lượt làm mang bản chụp riêng, không còn phụ thuộc vòng đời câu nguồn hoặc kho hệ thống.
ALTER TABLE question_attempts ADD COLUMN content_snapshot jsonb;
ALTER TABLE question_attempts DROP CONSTRAINT question_attempts_question_id_question_id_fkey;
ALTER TABLE question_attempts DROP CONSTRAINT question_attempts_question_version_id_question_versions_id_fkey;
ALTER TABLE question_attempts ADD COLUMN local_question_id uuid GENERATED ALWAYS AS
  (CASE WHEN content_snapshot IS NULL THEN question_id END) STORED;
ALTER TABLE question_attempts ADD COLUMN local_question_version_id uuid GENERATED ALWAYS AS
  (CASE WHEN content_snapshot IS NULL THEN question_version_id END) STORED;
ALTER TABLE question_attempts ADD CONSTRAINT question_attempts_local_question_fk FOREIGN KEY (local_question_id) REFERENCES question(id) ON DELETE CASCADE;
ALTER TABLE question_attempts ADD CONSTRAINT question_attempts_local_version_fk FOREIGN KEY (local_question_version_id) REFERENCES question_versions(id) ON DELETE RESTRICT;
CREATE INDEX question_attempts_local_question_idx ON question_attempts(local_question_id);
CREATE INDEX question_attempts_local_version_idx ON question_attempts(local_question_version_id);

-- Đề tạo từ course builder ghi khóa retry tại chính đề; tiến trình chết trước
-- bước chèn pin vẫn có thể tiếp tục với đúng đề/version ban đầu.
ALTER TABLE exams ADD COLUMN pin_request_id uuid;
ALTER TABLE exams ADD COLUMN pin_request_course_id uuid;
ALTER TABLE exams ADD CONSTRAINT exams_pin_request_pair_check CHECK
  ((pin_request_id IS NULL) = (pin_request_course_id IS NULL));
CREATE UNIQUE INDEX exams_pin_request_unique
  ON exams(created_by, pin_request_course_id, pin_request_id)
  WHERE pin_request_id IS NOT NULL;

-- Lưu bước copy thay thế để retry sau crash còn tìm được media staging.
-- Ghi pin version mới và xóa cờ pending trong CÙNG transaction.
ALTER TABLE exam_pins ADD COLUMN pending_snapshot_id uuid;
