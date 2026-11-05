# T005 — Kiểm thử integration với TEST services thật

## Phạm vi

- JUnit `IntegrationEnvironmentIT` kiểm tra JDBC PostgreSQL `giaokhoa_test` và OIDC discovery của Keycloak `giaokhoa-it`; chạy rõ tên test khi TEST stack có sẵn. `mvn verify` chạy các JUnit guard không cần dịch vụ.
- Playwright đăng nhập bằng **Keycloak UI**, nhận **Authorization Code + PKCE S256**, kiểm tra `state`, `nonce`, đổi code lấy token bằng confidential client. Callback HTTP cục bộ chỉ tồn tại trong lúc test chạy; không dùng password grant hay mock token.
- Kiểm tra Keycloak gửi email xác minh thật qua SMTP tới Mailpit TEST. Chỉ xóa tài khoản có ID do test tạo và email nhận được trong test; không xóa volume hoặc dữ liệu DEV.
- Đây là kiểm thử hạ tầng và giao thức OIDC. **Chưa khẳng định Spring session, callback ứng dụng, RLS hay native PDP**; các phần ấy chưa được triển khai trong backend skeleton và được nghiệm thu ở các task liên quan.

## Chạy trực tiếp trong DevContainer

```bash
docker compose -p giaokhoa-test -f infra/compose.test.yaml up -d
```

TEST stack dùng các cổng `127.0.0.1:15432` (PostgreSQL), `127.0.0.1:18081` (Keycloak), `127.0.0.1:18025` (Mailpit), `127.0.0.1:11025` (SMTP). Realm `giaokhoa-it` tự import từ `infra/keycloak/test-realm.json` khi database Keycloak TEST mới được khởi tạo; không dùng chung DEV.

Khi realm mới được tạo, cấp **duy nhất** `realm-management/manage-users` cho service account TEST của client `giaokhoa-it-fixtures`:

```bash
docker compose -p giaokhoa-test -f infra/compose.test.yaml exec -T test-keycloak /opt/keycloak/bin/kcadm.sh \
  config credentials --server http://localhost:18081 --realm master --user test-admin --password test-only-password
docker compose -p giaokhoa-test -f infra/compose.test.yaml exec -T test-keycloak /opt/keycloak/bin/kcadm.sh \
  add-roles -r giaokhoa-it --uusername service-account-giaokhoa-it-fixtures \
  --cclientid realm-management --rolename manage-users
```

Tạo `.env.test` (được Git ignore) dựa trên `.env.test.example`, dùng credentials **chỉ dành cho TEST**. Các placeholder phải được thay đúng client secret của realm TEST. Sau đó:

```bash
set -a; . .env.test; set +a
./backend/mvnw -B -ntp -f backend/pom.xml verify
./backend/mvnw -B -ntp -f backend/pom.xml -Dtest=IntegrationEnvironmentIT test
(cd frontend && npm run test:e2e)
```

Không cần script CI riêng; Docker-in-Docker chạy TEST services trực tiếp. `TEST_KEYCLOAK_BASE_URL` và issuer Keycloak đều dùng `http://127.0.0.1:18081` để Node/Java/Chromium trong DevContainer truy cập thống nhất.

## Bằng chứng thực chạy — 05/11/2026

- Java 25.0.5, Maven 3.10.0, Node 24.22.2, Docker 29.9.3, Compose v5.7.0: PASS.
- Docker TEST: hai PostgreSQL healthy, Keycloak TEST discovery HTTP 200, Mailpit API HTTP 200.
- Maven `verify` và JUnit `IntegrationEnvironmentIT`: PASS (1/1 ở mỗi lệnh).
- TypeScript, ESLint, Vitest, Next.js build: PASS; Playwright homepage, Authorization Code/PKCE và Mailpit email: PASS (3/3).
- DEV stack/volumes, `main`, dữ liệu ngoài TEST không bị xóa hoặc reset.
