# T005 — Kiểm thử integration với TEST services thật

## Phạm vi

- JUnit `IntegrationEnvironmentIT` khởi động Spring context với profile `integration`, kiểm tra `DataSource`/Flyway trỏ PostgreSQL `giaokhoa_test` và OIDC discovery của Keycloak `giaokhoa-it`; chạy rõ tên test khi TEST stack có sẵn. `mvn verify` chạy các JUnit guard không cần dịch vụ.
- Playwright đăng nhập bằng **Keycloak UI**, nhận **Authorization Code + PKCE S256**, kiểm tra `state`, `nonce`, đổi code lấy token bằng confidential client. Callback HTTP cục bộ chỉ tồn tại trong lúc test chạy; không dùng password grant hay mock token.
- Kiểm tra Keycloak gửi email xác minh thật qua SMTP tới Mailpit TEST. Chỉ xóa tài khoản có ID do test tạo và email nhận được trong test; không xóa volume hoặc dữ liệu DEV.
- Đây là kiểm thử hạ tầng và giao thức OIDC. **Chưa khẳng định Spring session, callback ứng dụng, RLS hay native PDP**; các phần ấy chưa được triển khai trong backend skeleton và được nghiệm thu ở các task liên quan.

## Chạy trực tiếp trong DevContainer

```bash
docker compose -p giaokhoa-test -f infra/compose.test.yaml up -d
```

Guard integration chỉ cho phép đúng `127.0.0.1:15432/giaokhoa_test` (PostgreSQL), `127.0.0.1:18081/realms/giaokhoa-it` (Keycloak), `127.0.0.1:18025` (Mailpit); SMTP TEST dùng `127.0.0.1:11025`. Bất kỳ cổng DEV như `8081`, `5432`, `8025` đều bị từ chối ngay cả khi đặt tên realm/database giống TEST. Muốn chạy TEST trên host khác phải bổ sung endpoint đã được xác minh riêng, không chỉ đổi biến môi trường. Realm `giaokhoa-it` tự import từ `infra/keycloak/test-realm.json` khi database Keycloak TEST mới được khởi tạo; không dùng chung DEV.

Khi realm mới được tạo, cấp cho service account TEST của client `giaokhoa-it-fixtures` các role `realm-management` sau: `manage-users` (fixture tạo/gỡ user) và `view-clients`, `view-authorization`, `manage-authorization`, `query-groups` — bộ role writer graph production cần, khớp phần tương ứng mà `infra/keycloak/bootstrap.sh` cấp cho provisioner production; thiếu chúng, mọi lời gọi Admin REST authorization của `PolicyGraphWriter` trong context integration bị Keycloak trả 403 và worker chỉ ghi nhận `PROJECTION_RECONCILE_FAILED`:

```bash
docker compose -p giaokhoa-test -f infra/compose.test.yaml exec -T test-keycloak /opt/keycloak/bin/kcadm.sh \
  config credentials --server http://localhost:18081 --realm master --user test-admin --password test-only-password
for role in manage-users view-clients view-authorization manage-authorization query-groups; do
  docker compose -p giaokhoa-test -f infra/compose.test.yaml exec -T test-keycloak /opt/keycloak/bin/kcadm.sh \
    add-roles -r giaokhoa-it --uusername service-account-giaokhoa-it-fixtures \
    --cclientid realm-management --rolename "$role"
done
```

Tạo `.env.test` (được Git ignore) dựa trên `.env.test.example`, dùng credentials **chỉ dành cho TEST**. Các placeholder phải được thay đúng client secret của realm TEST. Sau đó:

```bash
set -a; . .env.test; set +a
./backend/mvnw -B -ntp -f backend/pom.xml verify
./backend/mvnw -B -ntp -f backend/pom.xml -Dtest=IntegrationEnvironmentIT test
(cd frontend && npm run test:e2e)
```

CI chạy chính hai bài integration qua job `integration` của `.github/workflows/ci.yml` trên runner Ubuntu có Docker Compose; không tạo script/workflow infra smoke riêng. Docker-in-Docker chạy cùng TEST services trong DevContainer. `TEST_KEYCLOAK_BASE_URL` và issuer Keycloak đều dùng `http://127.0.0.1:18081` để Node/Java/Chromium truy cập thống nhất.

## Bằng chứng thực chạy — 05/11/2026

- Java 25.0.5, Maven 3.10.0, Node 24.22.2, Docker 29.9.3, Compose v5.7.0: PASS.
- Docker TEST: hai PostgreSQL healthy, Keycloak TEST discovery HTTP 200, Mailpit API HTTP 200.
- Maven `verify` và JUnit `IntegrationEnvironmentIT` (khởi động Spring `integration` thật, Hikari, Flyway): PASS (1/1 ở mỗi lệnh). Negative tests từ chối DEV gateway/database: PASS.
- TypeScript, ESLint, Vitest, Next.js build: PASS; Playwright homepage, Authorization Code/PKCE và Mailpit email: PASS (3/3).
- DEV stack/volumes, `main`, dữ liệu ngoài TEST không bị xóa hoặc reset.
