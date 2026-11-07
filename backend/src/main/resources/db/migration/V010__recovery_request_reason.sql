-- Lý do người gửi cần hỗ trợ khôi phục: form đã thu thập và hợp đồng đã ghi từ đầu,
-- nhưng backend chưa lưu nên operator không thấy được lý do khi xử lý. Thêm cột cho phép
-- NULL để các yêu cầu đã ghi trước đó vẫn hợp lệ; lời gọi HTTP mới bắt buộc lý do không
-- trống (xác thực ở controller), service chỉ chuẩn hoá khoảng trắng và giới hạn độ dài.
ALTER TABLE recovery_request
    ADD COLUMN reason VARCHAR(1000)
    CHECK (reason IS NULL OR btrim(reason) <> '');
