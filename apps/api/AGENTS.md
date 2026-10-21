# Quy ước bắt buộc cho `apps/api`

Mọi thay đổi tại đây phải tuân theo cách tổ chức và giao diện lập trình chính thức của NestJS đúng phiên bản đang cài. Không tự tạo cơ chế thay thế khi NestJS đã hỗ trợ.

## Các tầng xử lý

- **Mô-đun (module):** Mỗi tính năng tổ chức bằng `@Module()`, khai báo đúng `imports`, `controllers`, `providers`, `exports` khi cần. `AppModule` chỉ kết hợp các mô-đun và thành phần dùng chung.
- **Bộ điều khiển (controller):** Dùng `@Controller()` và các bộ chú giải HTTP của NestJS để nhận yêu cầu, tham số, trạng thái và phần đầu phản hồi, sau đó chuyển cho dịch vụ nghiệp vụ. Không đặt quy trình nghiệp vụ nhiều bước hoặc truy vấn cơ sở dữ liệu trong bộ điều khiển.
- **Thành phần được cung cấp (provider) và tiêm phụ thuộc (dependency injection):** Khai báo trong mô-đun, nhận phụ thuộc từ vùng chứa của NestJS. Dùng `@Injectable()` khi phù hợp; khởi tạo dịch vụ không phụ thuộc NestJS qua `useFactory`. Không tự tạo dịch vụ hoặc kho dữ liệu trong bộ điều khiển.
- **Tầng lưu trữ:** Kết nối các thành phần ở nơi khởi tạo ứng dụng (composition root) qua `@nestjs/drizzle`. Các bộ chuyển đổi kho dữ liệu thuộc `@giaokhoa/database`; bộ điều khiển và dịch vụ nghiệp vụ không truy vấn trực tiếp bảng Drizzle.
- **Xác thực yêu cầu:** Lấy lược đồ Zod chuẩn từ `@giaokhoa/shared/http/*`. Dùng `StandardSchemaValidationPipe` của NestJS 12 với `@Body({ schema })`, `@Param(..., { schema })` hoặc `@Query({ schema })`; không gọi `parse` hoặc `safeParse` lặp lại trong bộ điều khiển. Dịch vụ nghiệp vụ vẫn phải kiểm tra các điều kiện nghiệp vụ.
- **Cấu hình:** Dùng `ConfigModule`, `ConfigService` và xác thực cấu hình bằng lược đồ Zod theo cơ chế chuẩn. Không thêm thư viện xác thực hoặc đường ống tự viết chỉ để thay tính năng đã có.
- **Xác thực người dùng và phân quyền:** Better Auth chỉ phụ trách xác thực và phiên; dùng bộ bảo vệ (guard) hoặc bộ chú giải của NestJS để gọi `AuthorizationService` ở `@giaokhoa/application`. Không sử dụng `better-auth/plugins/admin`, `@Roles` dựa trên `session.user.role` hoặc API quản trị của Better Auth cho phân quyền. Quản trị vai trò/capability và quyền ghi đè qua `AuthorizationService`, theo ma trận vai trò và phạm vi ghi đè đúng nguồn Moodle. Kiểm tra quyền sở hữu và quyết định nghiệp vụ nằm ở `@giaokhoa/application`.
- **Xử lý lỗi:** `ClientErrorFilter` chuyển `ClientError` sang lỗi HTTP. Không viết lại cách xử lý lỗi chung ở từng bộ điều khiển.
- **Can thiệp phản hồi (interceptor):** Sử dụng cơ chế NestJS cho việc tải tệp hoặc xử lý chung khi cần. Chỉ dùng `@Res()` trực tiếp cho dữ liệu nhị phân, luồng dữ liệu hoặc trường hợp cần kiểm soát phản hồi gốc. Giữ hợp đồng HTTP và lược đồ phản hồi thống nhất với `@giaokhoa/shared`.

## Phân tầng kiểm thử

- Kiểm thử kho dữ liệu thuần, ràng buộc PostgreSQL và bản di trú (migration) đặt tại `packages/database/test` và chỉ dùng bộ chuyển đổi, lược đồ cùng dữ liệu lưu trữ cần thiết.
- Kiểm thử luồng đi qua dịch vụ nghiệp vụ và kho dữ liệu thật đặt tại `apps/api/test/integration`, không chuyển ngược vào gói cơ sở dữ liệu.
- Kiểm thử đầu cuối qua HTTP đặt tại `apps/api/test/e2e`; kiểm thử dịch vụ độc lập với cơ sở dữ liệu đặt tại `packages/application/test`.
- Mô tả nhóm và ca kiểm thử phải viết bằng tiếng Việt theo quy tắc tại `AGENTS.md` gốc. Sửa hành vi nào phải sửa chú thích và mô tả kiểm thử liên quan ngay trong cùng thay đổi.

Tài liệu chính thức: [Mô-đun](https://docs.nestjs.com/modules), [Bộ điều khiển](https://docs.nestjs.com/controllers), [Thành phần được cung cấp](https://docs.nestjs.com/providers), [Đường ống](https://docs.nestjs.com/pipes), [Bảo vệ](https://docs.nestjs.com/guards), [Bộ lọc lỗi](https://docs.nestjs.com/exception-filters), [Can thiệp phản hồi](https://docs.nestjs.com/interceptors), [Cấu hình](https://docs.nestjs.com/techniques/configuration), [Drizzle](https://docs.nestjs.com/data/drizzle).
