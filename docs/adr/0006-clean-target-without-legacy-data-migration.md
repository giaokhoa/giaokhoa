# Chuẩn hoá mô hình đích và bỏ tương thích dữ liệu cũ

Không có yêu cầu bảo toàn dữ liệu hiện tại khi chuyển sang mô hình đích.
Vì vậy không xây thêm luồng di trú dữ liệu hoặc giữ hành vi legacy cho trung
tâm dùng kho chung, liên kết tài khoản xuyên trung tâm và cơ chế ngân hàng
chung trùng lặp. Tận dụng cơ chế kho riêng, phân quyền và nghiệp vụ đang có,
chuẩn hoá schema cùng luồng khởi tạo để tạo ra một mô hình dữ liệu nhất quán;
giữ chức năng học tập của trung tâm và khu công cộng.
