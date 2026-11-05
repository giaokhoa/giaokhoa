# T010 — Kiểm chứng baseline Keycloak

## Đã kiểm tra trong worktree issue-12-t010

- Blocker #6 (T004) và #8 (T006): CLOSED tại thời điểm bắt đầu.
- `bash -n infra/keycloak/bootstrap.sh`: đạt.
- `jq` xác nhận baseline có đúng ba client, tất cả tắt Direct Access Grants, bật Organization và verifyEmail: đạt.
- `mvn -q -f backend/pom.xml verify`: đạt; test provisioning kiểm tra Organization tạo một lần, retry giữ Keycloak ID, tìm group lồng nhau và chặn đường dẫn group không thuộc template.
- Worktree và branch được tạo riêng dưới `.worktrees/issue-12-t010`; không thay đổi dữ liệu hoặc container DEV.

## Cần kiểm chứng qua Keycloak thật trước khi đóng issue

- Chạy `infra/keycloak/bootstrap.sh` hai lần trên realm TEST chuyên dụng của Keycloak 26.8.1; đối chiếu ID group/client không đổi, không có default wildcard permission.
- Kiểm tra realm profile email tùy chọn, required actions mặc định, redirect/logout chính xác, secret riêng, quyền thực tế của service account provisioner và tạo Organization/group.
- Chưa thực hiện các bước trên: lệnh sử dụng admin credential của TEST đang chờ phê duyệt truy cập từ thiết bị. Không coi Maven/mock HTTP là bằng chứng native PDP hay bootstrap đã hoạt động thực tế.
