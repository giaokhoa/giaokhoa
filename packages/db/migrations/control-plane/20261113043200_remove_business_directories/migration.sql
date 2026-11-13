-- Xoá hai bảng danh bạ (S27): danh bạ thành viên không gian và danh bạ mã tham gia lớp
-- không còn thuộc kho control plane — xem mục "Ranh giới schema control plane" trong packages/db/README.md.
DROP TABLE IF EXISTS "space_membership_directory";
--> statement-breakpoint
DROP TABLE IF EXISTS "space_join_code_directory";
