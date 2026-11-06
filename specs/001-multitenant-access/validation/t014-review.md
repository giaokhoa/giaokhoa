# T014 — Đối chiếu review P1 (test-first)

## Bằng chứng chạy trên TEST stack

- JDK 25: clean verify **GREEN**; 27 unit tests, Spotless/PMD/SpotBugs đạt.
- Integration verify (TEST DB / Keycloak, Flyway schemas=t014_issue16):
  **89 tests, 86 GREEN, 3 RED có chủ đích**.
- ProjectionFenceGateIT.protectedHttpReadMustFailClosedOnPendingPartition
  (ACCOUNT/WORKSPACE): authenticated Spring Security request tới route đã khai báo
  GET /api/workspaces/{wid}/classes; mong đợi HTTP **503** khi dependency PENDING,
  hiện nhận **404** vì route và protected-request gate chưa triển khai.
  Đây là RED về chức năng vắng mặt, không phải lỗi fixture; Keycloak TEST đã tạo
  actor thật và PostgreSQL đã có revision PENDING.
- ConcurrentRevocationIT: **4/4 test DB GREEN**; thêm một RED ở đường HTTP mutation:
  concurrentProtectedHttpMutationMustNotBypassRevocationFence chạy POST
  /api/workspaces/{wid}/classes song song với revoke đang giữ FOR UPDATE.
  Expected request chờ revoke commit rồi trả 503, không tạo authorization_operation;
  hiện request kết thúc sớm vì chưa có handler/PEP. Test này dùng schema
  t014_concurrent_ + UUID riêng, Flyway migrate đủ bốn phiên bản; @AfterAll drop
  schema sau test. Tránh xóa từng authz_partition vì migration chủ động cấm DELETE.
- Native same-access-token group revoke: **GREEN**; không có group claim, deny A,
  retain B. Đây là kiểm chứng native PDP, **không** là E2E BFF.

## Ranh giới nghiệm thu còn RED / chưa thể chạy

| Contract | Bằng chứng hiện có | Phần chưa được chứng minh |
| --- | --- | --- |
| ACCOUNT/WORKSPACE PENDING | DB GREEN, Spring HTTP RED 503→404 | AuthorizationFence + protected route (T018 và API downstream) |
| GRANT PENDING/FAILED | DB operation fence GREEN | Manifest closure và protected read trên resource có GRANT thật (T017–T018 / API resource) |
| Cùng actor giữ quyền B khi revoke A | Cùng actor sở hữu personal A + center B; partition B READY; native token A/B GREEN | Cùng **Spring BFF session** với user token từ Authorization Code + PKCE, trước/sau revoke (T015–T018) |
| Concurrent revoke/write | PostgreSQL FOR SHARE/FOR UPDATE GREEN | Business handler dùng ProtectedActionExecutor và chứng minh commit order (T018 và downstream CRUD) |
| Crash/retry | Idempotency và revision qua transaction commit GREEN | Worker thật idempotent provision/reconcile Keycloak, crash injection (T017) |

Không tạo PEP giả, mock PDP, route kiểm thử giả trong production hoặc tuyên bố
89/89 GREEN. Trước khi nghiệm thu T022, bổ sung E2E thực sự bằng Authorization Code
+ PKCE, Spring Session cookie, Keycloak policy graph/GRANT closure và business mutation
có đối chiếu revision đến commit. Không dùng Direct Access Grants cho E2E BFF:
test native PDP hiện tại chỉ dùng client synthetic riêng biệt, không phải web client.

Log cục bộ lần review: /tmp/t014-review-unit3.log và
/tmp/t014-review-integration-final.log. TEST DB schema t014_issue16 được giữ riêng
do checksum Flyway schema TEST công khai khác origin/main; không repair/drop DEV.
