# T014 — Review lần 3: test-first contract và giới hạn nghiệm thu

## Kết luận

| Review | Cách xử lý |
| --- | --- |
| Thiếu OAuth2AuthorizedClient | Test dùng `NativeSpringSessionFixture`: token **Code+PKCE thật** của `giaokhoa-it-web` TEST, gắn vào Spring `OAuth2AuthorizedClientRepository`/SecurityContext của Spring Session JDBC. Request HTTP RED dùng cookie `SESSION`, không dùng `authentication()` giả. |
| Thiếu same-session | GREEN test load cùng cookie/JDBC token trước/sau native revoke A; A deny, B allow. Đây chưa phải Spring OIDC callback/PEP E2E. |
| GRANT PENDING/FAILED | Thêm 2 RED riêng: grant-owned projection của resource/version `content.read` với dependency WORKSPACE. ACCOUNT và WORKSPACE vẫn READY, GRANT PENDING hoặc FAILED; protected capabilities cần 503. |
| Worker crash/retry | GREEN test Keycloak thật: native revoke A sau DB desired commit nhưng trước READY/ack, tiếp tục 202, replay cùng revoke không nhân bản resource/policy/grant, xác nhận graph inventory và idempotency rồi mới READY/200. **Chưa** restart worker T017 thật. |
| Concurrent DB false-PASS | Cả hai DB test kiểm tra PID connection đang chờ và blocker đúng bằng `pg_blocking_pids(waiterPid)`. Không coi timeout thread là bằng chứng lock. |
| PDP boolean | Dùng `NativeGateClient.requireDecision()` từ T013 để yêu cầu boolean thật. |
| Thiếu main | Đã merge `origin/main` chứa T012/T013 vào feature T014, không merge vào `main`. |

## Các lệnh chạy

Dùng các biến `TEST_*` của `backend/README.md`; không chạy DEV.

```sh
./backend/mvnw -B -ntp -f backend/pom.xml clean verify
./backend/mvnw -B -ntp -f backend/pom.xml -Pintegration verify
bash infra/verify-t014-red.sh
bash infra/keycloak/verify-native.sh
```

Failsafe mặc định chỉ loại tag `t014-pending`. GitHub CI vẫn yêu cầu integration GREEN và thêm `infra/verify-t014-red.sh` để kiểm tra đúng **5 assertion RED**, không chấp nhận lỗi môi trường, fixture hỏng hay test bị quên. Khi T018/T021 triển khai, gỡ tag và cập nhật verifier trong cùng thay đổi để chuyển hợp đồng sang CI GREEN.

Trên TEST DB máy local, schema public bị checksum Flyway V002 khác `origin/main`. Khi chạy integration và script RED local, thêm ba tham số Maven (script chuyển tiếp các argument):

```sh
'-Dspring.flyway.schemas=t014_issue16'
'-Dspring.flyway.default-schema=t014_issue16'
'-Dspring.datasource.hikari.connection-init-sql=SET search_path TO t014_issue16,public'
```

`ConcurrentRevocationIT` tạo schema `t014_concurrent_<UUID>` riêng, migrate rồi drop sau test; không repair/clean DB public hay DEV. Session cookie được xóa khi test kết thúc.

## Kết quả và giới hạn

- JDK 25: **28/28 unit GREEN**, Spotless/PMD/SpotBugs GREEN — `/tmp/t014-r4-unit-crash.log`.
- Integration TEST: **88/88 GREEN**, gồm native Code+PKCE + JDBC session và crash-window replay — `/tmp/t014-r4-default3.log`.
- Contract RED: **5/5 thất bại do thiếu implementation, không có fixture/setup error** — `/tmp/t014-r4-red-grant2.log` (trước script verifier tự động).
- T013 native acceptance sau cập nhật main: đối chiếu `/tmp/t014-r4-native-final.log` sau khi chạy.

**Chưa được chứng minh:** HTTP protected PEP hoàn chỉnh, GRANT closure re-resolve của T018, Spring UI login callback T022, worker thật bị crash/restart và Keycloak reconcile T017. Native PDP + Spring Session test GREEN không đồng nghĩa E2E đã GREEN. T014 được nghiệm thu theo tiêu chí test-first; gate hoàn chỉnh vẫn thuộc T022.
