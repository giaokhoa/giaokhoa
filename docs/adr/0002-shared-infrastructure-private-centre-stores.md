# Dùng chung hạ tầng và tách kho dữ liệu trung tâm

API, worker, PostgreSQL và Redis có thể dùng chung, nhưng mỗi trung tâm phải
có database, quyền kết nối và vùng lưu file riêng để thực hiện vòng đời dữ liệu
độc lập. Cách tổ chức này tận dụng đường cấp phát kho riêng hiện có và giảm
chi phí vận hành so với một hệ thống hạ tầng riêng cho từng trung tâm; sự cố
cấp cụm vẫn có thể ảnh hưởng nhiều trung tâm. Phạm vi tên và thao tác trên file,
job và dữ liệu nền phải giữ ranh giới trung tâm khi dùng hạ tầng chung.

Tiếp tục phục vụ giáo viên và học viên tự do trong khu học tập công cộng có dữ
liệu riêng, vận hành như một trung tâm; dữ liệu học tập của khu này được tách
khỏi ngân hàng hệ thống. Việc tách ranh giới lưu trữ không loại bỏ chức năng
học tập hiện có trên site chính.
