-- Vết cài giữ checksum của bản gói đã kiểm tra; các dòng lịch sử cũ được đánh dấu chưa có checksum.
ALTER TABLE IF EXISTS "outcome_package_installs" ADD COLUMN IF NOT EXISTS "package_checksum" text NOT NULL DEFAULT '';
