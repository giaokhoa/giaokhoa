# T014 — Review lần 4: READY contrast, worker partial provision, RED verifier

## Tình trạng và cách đọc GREEN/RED

T014 là **test-first**. Kết quả GREEN của PostgreSQL và native Keycloak **không**
đồng nghĩa production PEP/worker đã hoàn chỉnh. Gate E2E cuối cùng là T022.
Tài liệu này bổ sung vào `t014-review.md` trước đó và dùng cùng worktree.

| Phát hiện | Biện pháp và bằng chứng |
| --- | --- |
| P1: không có đối chứng READY | Mỗi trường hợp ACCOUNT / WORKSPACE / GRANT PENDING / GRANT FAILED gọi **cùng** `POST /api/workspaces/{wid}/capabilities`, cùng cookie/session, cùng target trước và sau commit. Trước thay đổi, bắt buộc HTTP 200 **và** đúng một kết quả JSON `allowed=true`; sau fence bắt buộc 503. `assertAll` giữ cả hai assertion RED, không bỏ phần sau khi READY trả 404. |
| P1: GRANT A không được ảnh hưởng B | Khi A GRANT PENDING/FAILED, một GRANT B riêng có projection READY và native PDP allow; test gọi B sau A-fence và bắt buộc HTTP 200 / `allowed=true`. ACCOUNT và WORKSPACE giữ READY. |
| P1: worker không được nhân bản graph khi retry | Thêm `productionWorkerMustReconcilePartiallyProvisionedAppGraphAfterRetry` tagged RED. Fixture tạo **resource thật** với `content.read` trong TEST API audience `giaokhoa-it-api` trước, không có scope permission/policy; ghi projection/operation vào PostgreSQL với trạng thái `RETRYABLE_FAILURE`/PENDING như sau crash. Worker T017 phải resume bằng chính production graph writer, không tạo thêm resource, tạo **đúng một** permission, publish applied hash/revision và SUCCEEDED. Hiện RED `T014_WORKER_NOT_INSTALLED`, **không phải lỗi Keycloak**. |
| P2: RED verifier quá dễ chấp nhận | `infra/verify-t014-red.sh` xác nhận **chính xác 6 case**, không lỗi setup, và kiểm tra từng failure signature: READY 404 & fenced 404 & independent B 404; worker chưa có bean; concurrent HTTP kết thúc sớm **404**. HTTP 400/403/302/200, 503 mọi trường hợp, lỗi worker Keycloak hoặc thiếu case sẽ làm CI thất bại. |
| P2: khác API audience | Các native group/PDP GREEN hiện hữu ở client riêng `t014-*` vẫn chỉ chứng minh native policy. Fixture partial-recovery RED mới dùng **chính** resource server audience TEST của ứng dụng `giaokhoa-it-api`, và dọn graph/client do test tạo. Không tự tạo PEP hay PDP giả. Khi T016/T017 triển khai, các resource READY ở HTTP boundary phải được nối vào cùng production graph writer; chỉ synthetic PDP không đủ để nghiệm thu T022. |

## Chạy trên TEST

Yêu cầu TEST PostgreSQL + Keycloak và biến `TEST_*` như `backend/README.md`. Không dùng DEV, không sửa schema/chạy migration repair vào TEST public hiện hữu.

```sh
./backend/mvnw -B -ntp -f backend/pom.xml clean verify
./backend/mvnw -B -ntp -f backend/pom.xml -Pintegration verify
bash infra/verify-t014-red.sh
bash infra/keycloak/verify-native.sh
```

Do schema TEST public trên máy kết nối có Flyway V002 checksum khác, thêm cùng ba
tham số sau cho `-Pintegration verify` và `verify-t014-red.sh` khi chạy local:

```sh
'-Dspring.flyway.schemas=t014_issue16'
'-Dspring.flyway.default-schema=t014_issue16'
'-Dspring.datasource.hikari.connection-init-sql=SET search_path TO t014_issue16,public'
```

ConcurrentRevocationIT tự tạo/migrate schema `t014_concurrent_<UUID>` và drop sau test.
Spring Session JDBC test cũng dọn cookie session. Worker RED chỉ sử dụng
`http://127.0.0.1:18081/realms/giaokhoa-it` và API audience TEST được
allowlist; nếu API client đã có, fixture chỉ tạo và dọn resource/scope của test
ở trạng thái RED hiện tại. Khi worker T017 được triển khai và ghi thêm policy/
permission lên client có sẵn, phải bổ sung cleanup đúng các object do worker tạo.
Không sử dụng production Keycloak hoặc sửa code chạy T017 trước khi issue đó được triển khai.

## Kết quả có thể kiểm tra

- Unit / quality: **28/28 GREEN**, Spotless, PMD, SpotBugs `BUILD SUCCESS` — `/tmp/t014-r5-final-unit.log`.
- Integration (mặc định): **88/88 GREEN** — `/tmp/t014-r5-final-green.log`.
- RED contracts: **6/6 assertion RED, 0 error**, verifier exit 0 — `/tmp/t014-r5-final-red.log`.
- Verifier negative checks: đổi concurrent 404 thành 403, READY 404 thành 503, worker missing thành Keycloak error đều bị từ chối; log xuất từ chính XML report trên máy.
- Native T010/T013 acceptance: **PASS** (`NATIVE_T010_T013_ACCEPTANCE_PASSED`) — `/tmp/t014-r5-native-final-pass.log`.

**Giới hạn còn tồn tại:** Test worker là fault *state* sau partial native provisioning,
chưa thực sự kill/restart process T017; test này RED cho đến khi T017/T016 tồn tại và
reconcile. HTTP READY/503/B vẫn RED do thiếu T021/T018. Test Code+PKCE/JDBC
Spring session GREEN vẫn không thay thế Spring callback/UI login E2E. Chuyển RED
sang CI GREEN khi implementation hoàn tất, không sửa expectation để hợp thức hóa 404.
