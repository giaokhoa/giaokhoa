-- Dành cho quản trị viên sau khi sao lưu dữ liệu. Không chạy tự động lên cơ sở dữ liệu thật.
-- Bù quan hệ cha đã thiếu ở ngữ cảnh người dùng và ngân hàng câu hỏi của phiên bản cũ.
BEGIN;
DO $$
DECLARE root_id uuid;
BEGIN
  SELECT id INTO root_id FROM authz_contexts
  WHERE kind = 'system' AND resource_key = 'giaokhoa';
  IF root_id IS NULL THEN
    RAISE EXCEPTION 'Thiếu ngữ cảnh hệ thống giaokhoa';
  END IF;
  UPDATE authz_contexts SET parent_id = root_id
  WHERE kind IN ('user', 'bank') AND parent_id IS NULL;
END $$;
COMMIT;
