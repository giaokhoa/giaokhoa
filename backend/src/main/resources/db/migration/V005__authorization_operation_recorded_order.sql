-- Thứ tự hàng đợi của các operation phải là thứ tự chúng được ghi vào. created_at
-- mặc định là CURRENT_TIMESTAMP, tức thời điểm bắt đầu transaction, nên các operation
-- được một transaction ghi vào dùng chung created_at và việc sắp xếp theo nó thoái hóa
-- thành khóa chính ngẫu nhiên: một operation trẻ hơn có thể bị claim trước một operation cũ hơn
-- chạm cùng partition. Một identity theo từng dòng ghi lại thứ tự chèn thực tế.
ALTER TABLE authorization_operation
    ADD COLUMN recorded_seq BIGINT GENERATED ALWAYS AS IDENTITY;
