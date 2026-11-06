# T014 — Bằng chứng review sau commit b5d542e (test-first)

## Phạm vi và phân loại GREEN/RED

Mốc Foundation là T022, trước T051 (ClassController của US3). Vì vậy test
application-boundary tại T014 dùng đúng contract trước T022, **không** gọi
`/api/workspaces/{wid}/classes`:

- `POST /api/workspaces/{wid}/capabilities`: kiểm tra ACCOUNT/WORKSPACE đã
  PENDING trong transaction **đã commit** -> yêu cầu HTTP 503.
- `POST /api/workspaces/{wid}/samples/actions` với `CREATE_RESOURCE`: kiểm tra
  business mutation không vượt qua lock/revision fence của revoke đang mở.

Hai endpoint ở trên được khai trong `contracts/http-api.md`, thuộc kiểm chứng
Foundation/T021, không phải ClassController T051. Test này **không dựng**
test-only PEP, PDP giả hay production route tạm. Principal OIDC được tạo qua
Spring Security MockMvc để thử HTTP boundary; đó **không phải** phiên login thật
Authorization Code + PKCE, phần này vẫn thuộc T022.

Các test HTTP nằm trong `ConcurrentRevocationIT` không dùng transaction test bao
ngoài. Từng actor/workspace/partition được tạo với `TransactionTemplate` rồi
**commit trước khi** gọi MockMvc. Class này có schema PostgreSQL TEST riêng
`t014_concurrent_<UUID>`, Flyway migrate từ đầu và `@AfterAll` drop schema.
Không xóa `authz_partition` bằng DELETE vì migration bảo vệ lịch sử revision.

Trong concurrent HTTP test, revoker giữ khóa `FOR UPDATE` và báo **backend PID**.
Test chỉ công nhận writer đã chạm khóa nếu `pg_blocking_pids()` báo cụ thể
writer chờ đúng revoker ở `authz_partition`. Có tín hiệu `writerStarted` trước
request và kiểm tra response/operation **sau khi** cho revoke commit. Không
coi `Future.get(300ms)` là bằng chứng lock: request chậm đơn thuần không đạt.

## Chạy test

Cần TEST PostgreSQL/Keycloak và biến `TEST_*` như `backend/README.md`.
Maven JDK 25, cả hai lệnh bên dưới dùng profile integration:

```sh
# Mặc định / CI: toàn bộ phần đã triển khai (chỉ loại tag t014-pending).
./backend/mvnw -B -ntp -f backend/pom.xml -Pintegration verify

# Opt-in RED của T014: chạy CHỈ 3 contract tests, thất bại là kết quả dự kiến
# cho đến khi T018/T021 và fixture/PAP tương ứng được triển khai.
./backend/mvnw -B -ntp -f backend/pom.xml -Pintegration \
  -Dgroups=t014-pending '-Dt014.excludedGroups=' verify
```

Maven Failsafe dùng `t014.excludedGroups=t014-pending` trong `backend/pom.xml`.
CI chỉ loại ba test tagged; không bỏ các integration test đã có. Khi T018/T021
được triển khai, chạy lại RED command; nếu cả ba GREEN, **bỏ tag và default
exclusion**, đưa chúng trở về CI bắt buộc. Không được báo integration CI mặc định
là đã nghiệm thu mọi hành vi được quarantine.

Trên máy hiện tại, schema TEST công khai có checksum V002 khác `origin/main`.
Vì vậy cả hai lần chạy dưới đây bổ sung ba tham số để chỉ dùng schema
`t014_issue16` đã migrate đúng, không repair/drop schema công khai và không
đụng DEV:

```sh
'-Dspring.flyway.schemas=t014_issue16'
'-Dspring.flyway.default-schema=t014_issue16'
'-Dspring.datasource.hikari.connection-init-sql=SET search_path TO t014_issue16,public'
```

## Kết quả đã đo

| Lần chạy | Kết quả | Log |
| --- | --- | --- |
| `clean verify` (JDK 25) | **27/27 unit GREEN**, Spotless/PMD/SpotBugs GREEN | `/tmp/t014-r3-unit-final.log` |
| `-Pintegration verify` mặc định | **86/86 integration GREEN**, `BUILD SUCCESS` | `/tmp/t014-r3-integration-green.log` |
| `-Pintegration -Dgroups=t014-pending '-Dt014.excludedGroups=' verify` | **3/3 RED được thực thi**, `BUILD FAILURE` đúng dự kiến | `/tmp/t014-r3-contract-red.log` |

Hai RED `protectedCapabilitiesMustRejectCommittedPendingDependency` (ACCOUNT
và WORKSPACE): mong đợi HTTP 503 nhưng hiện nhận 404 vì route/PEP chưa có.
RED `concurrentFixtureMutationMustWaitForDatabaseRevocationFence`: không quan
sát thấy PostgreSQL writer chờ revoker PID vì sample action route chưa có.
Đây là thiếu implementation, **không** là xác nhận hiện hữu production path
có lỗi lock hay leak dữ liệu.

## Chưa được chứng minh — không khẳng định nghiệm thu E2E

- **GRANT** PENDING/FAILED tại protected request cần manifest closure/source
  projection thật (T017–T018, T021–T022); DB operation constraint đã GREEN.
- **Same-session**: Spring Session cookie và Authorization Code + PKCE, dùng user
  access token qua chính `KeycloakDecisionClient`, trước/sau revoke A/B (T015–T022).
  Native PDP cùng access token A/B **đã GREEN**, nhưng test dùng TEST direct-grant
  client synthetic riêng, không phải BFF web client.
- **Concurrent business write** với production `ProtectedActionExecutor`: pending
  test đã ràng buộc HTTP route T021 và blocker PID, nhưng chưa thể GREEN trước T018.
- **Crash/retry** worker thật và Keycloak graph reconciliation/idempotence (T017).
  Test hiện tại chỉ GREEN cho revision/idempotency ở DB.

Không đóng gate T022 hay suy E2E được bảo vệ từ 86 GREEN. Giữ yêu cầu
review/test-first riêng khỏi production acceptance.
