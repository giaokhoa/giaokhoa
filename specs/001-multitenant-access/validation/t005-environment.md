# T005 — Môi trường kiểm thử integration và Authorization Code

## Phạm vi

- JUnit `IntegrationEnvironment` nạp profile `integration` và kiểm tra PostgreSQL thật + Keycloak OIDC discovery; mặc định Maven `verify` không chạy `*IT` khi TEST services chưa được cấp.
- Playwright `auth-code.spec.ts` chạy Keycloak UI qua Authorization Code (state/nonce/PKCE) và kiểm tra cookie HttpOnly do Spring cấp; không dùng mock JWT, password grant hoặc mock PDP.
- Fixture admin chỉ dùng `client_credentials` của **test-realm service account** có `manage-users` để tạo tài khoản ngẫu nhiên `t005-UUID`. Browser vẫn đăng nhập bằng UI Keycloak thật. Cleanup chỉ user ID vừa tạo.
- Test mail yêu cầu Keycloak thật gửi `send-verify-email` tới SMTP Mailpit TEST, tìm email theo địa chỉ ngẫu nhiên và thời điểm yêu cầu, chỉ xóa message ID vừa nhận; không xóa toàn mailbox, reset volume, `flyway clean` hay DEV.

## Điều kiện chạy thật

1. Ở **Docker host**, khởi động riêng `docker compose -p giaokhoa-test -f infra/compose.test.yaml up -d`. Nếu runner nằm trong DevContainer, `127.0.0.1` không trỏ vào TEST stack: cần forward port hoặc chạy runner trên TEST network.
2. Trong Keycloak **TEST**, cấp realm `giaokhoa-it`. Client `giaokhoa-it-web` là confidential, Standard Flow ON, Direct Access Grants/Implicit Flow OFF; redirect URI đúng `http://localhost:8080/login/oauth2/code/keycloak`. Issuer `http://auth.test.giaokhoa.localhost:18081/realms/giaokhoa-it` phải cùng địa chỉ browser và Spring truy cập được. Test realm có SMTP host `test-mailpit`, port `1025`; địa chỉ From thuộc TEST. Tạo service account `giaokhoa-it-fixtures` có `realm-management/manage-users` trong realm TEST, chỉ để quản lý fixture. Không dùng client/admin DEV.
3. Nạp file riêng tư dựa trên `.env.test.example`: `set -a; . /path/to/local-test-env; set +a`. Các secret `replace-with-...` cần thay bằng secret TEST. DB ở `giaokhoa_test`. T004 hiện có một user `giaokhoa_test`; migration T006 cần cấp runtime/migrator roles tách biệt trước khi chứng minh RLS.
4. Chạy Spring với profile `integration` và test classpath: `./backend/mvnw -f backend/pom.xml -Dspring-boot.run.profiles=integration -Dspring-boot.run.useTestClasspath=true spring-boot:run`. Backend đang ở giai đoạn skeleton; full login callback/CSRF/session và native PDP được hoàn thiện ở các task sau. Cần Spring callback ở `TEST_BACKEND_ORIGIN` và test DB schema sẵn sàng.

```bash
./backend/mvnw -f backend/pom.xml -Dtest=IntegrationEnvironmentIT test
npm --prefix frontend ci
cd frontend
TEST_AUTH_CODE=1 npm run test:e2e -- auth-code.spec.ts
```

Khi chưa có TEST services, E2E UI công khai vẫn chạy; test auth/mail sẽ skip nếu `TEST_AUTH_CODE=0`. Skip **không phải** pass nghiệm thu. Hai test này xác minh hạ tầng, **không thay thế** native PDP gate T022.

## Bằng chứng hiện tại

- Maven `verify`: PASS; JUnit environment guard PASS (1/1).
- Frontend: TypeScript, ESLint, Next build PASS; Vitest PASS (3/3); Playwright UI public PASS (1/1), auth code/mail SKIP (2/2).
- Chưa chạy integration thật: không có Docker CLI; Keycloak TEST `18081` và Mailpit TEST `18025` chưa reachable từ máy. Không được ghi login, SMTP, issuer hoặc database thật là PASS.
- Không đụng DEV stack/volume, không xóa dữ liệu hoặc sửa main.
