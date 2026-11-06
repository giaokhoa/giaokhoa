# Kiểm tra chất lượng backend

Dùng JDK 25 và Maven Wrapper. Chạy các lệnh từ thư mục gốc repository.

```sh
./backend/mvnw -B -ntp -f backend/pom.xml spotless:apply
./backend/mvnw -B -ntp -f backend/pom.xml clean verify
```

`verify` thất bại nếu compiler có warning, test thất bại, format sai, PMD hoặc SpotBugs phát hiện vi phạm. Không cần cài thêm binary lint; các phiên bản được cố định trong `pom.xml`.

| Bước | Phạm vi và mục đích |
| --- | --- |
| javac `-Xlint:all` và `failOnWarning` | Compile cả main/test; chặn raw type, unchecked, deprecated API và các warning compiler khác. |
| Spotless / Google Java Format AOSP | Format 4 spaces, thứ tự import và dọn import thừa cho main/test. |
| PMD | Phân tích source main/test: code không dùng, thực hành Java, mẫu lỗi và security. |
| SpotBugs | Phân tích bytecode main/test, effort Max, ngưỡng Medium trở lên. |
| Surefire | Chạy unit test trong build thông thường. |
| Failsafe, profile `integration` | Chạy integration test cho stack PostgreSQL/OIDC TEST theo convention Maven, bao gồm `*IT`; native Keycloak chạy riêng qua script bên dưới. |

## Integration test

Chỉ dùng stack TEST tại `infra/compose.test.yaml`. Không dùng DB hoặc realm DEV. Chuẩn bị biến môi trường theo `.env.test.example`; xem bước khởi tạo TEST trong `.github/workflows/ci.yml`.

```sh
docker compose -p giaokhoa-test -f infra/compose.test.yaml up -d
# Nạp biến môi trường TEST theo .env.test.example trước lệnh dưới.
./backend/mvnw -B -ntp -f backend/pom.xml -Pintegration verify
```

Build mặc định không cần PostgreSQL/Keycloak và không chạy integration test. CI chạy riêng profile `integration` sau khi khởi tạo stack TEST, tự tìm test mới thay vì giữ danh sách tên lớp.

## VS Code và agent

Mở thư mục gốc của worktree. `backend/.settings/org.eclipse.jdt.core.prefs` cấu hình JDT để coi unused local/import, raw type, unchecked và deprecated API là lỗi. Nếu IDE chưa cập nhật, chạy **Java: Update Project Configuration**.

JDT và javac có bộ kiểm tra khác nhau; formatter hoặc build thành công không có nghĩa mọi kiểm tra IDE đều giống nhau. Maven `verify` là lệnh bắt buộc dùng chung cho agent và CI. Sửa nguyên nhân; chỉ dùng suppression hẹp kèm lý do khi xác nhận ngoại lệ của framework hoặc test cố ý truyền đầu vào sai. Không bỏ qua test để lint xanh.

Các rule PMD về số lượng assertion, message cho mọi assertion và hằng số hóa mọi literal không nằm trong convention này: một test có thể kiểm tra nhiều thuộc tính của cùng hành vi; SQL/fixture được giữ gần nơi dùng. Các rule kiểm tra lỗi vẫn áp dụng cả main/test. Ngoại lệ SpotBugs nằm trong `config/spotbugs-exclude.xml`, giới hạn theo lớp/member và loại lỗi, có lý do ngay tại mỗi mục.

CI chỉ tải báo cáo khi kiểm tra thất bại, lưu tối đa 7 ngày. Bước tải báo cáo phục vụ chẩn đoán và không làm thay đổi kết quả lint/test nếu GitHub hết quota artifact; các bước compiler, lint và test vẫn bắt buộc thành công.

## Native Keycloak

`KeycloakProvisioningClientNativeIT` cần realm `giaokhoa` và thông tin do bootstrap tạo, khác realm `giaokhoa-it` của stack TEST. Chạy `bash infra/keycloak/verify-native.sh`: script tạo Keycloak riêng tại cổng 18091, bootstrap, chạy test Java và tự dọn container. CI chạy script này trong job integration sau các kiểm tra của stack TEST; test này được loại khỏi Failsafe của profile `integration` để chạy đúng môi trường, không bị bỏ qua trong CI.

Sau `-Pintegration verify`, chạy `node infra/keycloak/verify-oidc-logout.mjs` khi đã nạp `TEST_DATABASE_URL`, `TEST_KEYCLOAK_BASE_URL` và `TEST_KEYCLOAK_REALM` theo TEST Compose. Script dùng JAR đã build, tạo client/user/schema TEST ngẫu nhiên, đăng nhập Code+PKCE, restart backend và nhận `logout_token` thật do Keycloak ký; kiểm tra độc lập chữ ký/issuer/audience/events bằng JWKS RSA tạm của TEST, sau đó quay về khóa Keycloak thật để kiểm tra xóa session JDBC/correlation. Script tự dọn tài nguyên test, không đụng DEV hoặc chạy Flyway repair. CI chạy test này trong job integration.
