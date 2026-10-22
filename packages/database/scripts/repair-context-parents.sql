-- Sửa dữ liệu ngữ cảnh `user`/`bank` cũ có `parent_id = NULL`.
-- Chỉ chạy bằng kết nối quản trị sau khi sao lưu và thử trên bản sao cơ sở dữ liệu.
-- Không tự động chạy khi migrate; `0000_baseline.sql` KHÔNG dành cho DB đã có dữ liệu.
-- Bản ghi tạo mới hoặc được sử dụng lại cũng được sửa ở repositories/files.ts
-- và repositories/questions.ts; công cụ này sửa nốt những bản ghi chưa được truy cập.
-- Chỉ điền cha nếu đang NULL, có thể chạy lặp lại. Nếu thiếu gốc hệ thống thì hủy.
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
