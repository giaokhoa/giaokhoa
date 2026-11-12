# Control plane chỉ giữ metadata vận hành

Kho control plane dùng chung chỉ giữ thông tin trung tâm, định tuyến, trạng thái,
gói dịch vụ và metadata cần cho vận hành; hồ sơ cùng quan hệ người dùng thuộc
kho trung tâm, không có thư mục liên kết tài khoản hoặc danh bạ học viên xuyên
trung tâm. Ranh giới này giữ tài khoản độc lập theo đơn vị sở hữu và tránh hình
thành một lớp dữ liệu người dùng dùng chung ngoài ngân hàng tài nguyên.
Các luồng đang dựa vào `space_membership_directory` phải được rà để loại bỏ
phụ thuộc vào cấu trúc liên kết người dùng này; không giữ nhánh tương thích
với dữ liệu cũ theo [ADR-0006](0006-clean-target-without-legacy-data-migration.md).
