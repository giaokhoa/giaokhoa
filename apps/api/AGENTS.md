# Quy ước bắt buộc cho `apps/api`

Mọi thay đổi tại đây phải theo kiến trúc và API chính thức của NestJS đúng phiên bản đang cài. Trước khi đổi cách dùng framework, đọc lại tài liệu NestJS tương ứng; không tự tạo tầng hoặc cơ chế thay thế khi Nest đã có sẵn.

## Các tầng NestJS

- **Module:** Mỗi tính năng được tổ chức bằng `@Module()`, khai báo đúng `imports`, `controllers`, `providers` và `exports` khi cần. `AppModule` chỉ kết hợp các module và provider toàn ứng dụng.
- **Controller:** Dùng `@Controller()` và decorator HTTP của Nest để tiếp nhận request, khai báo status/headers, nhận tham số và ủy quyền nghiệp vụ cho provider. Không đặt use case nhiều bước, truy vấn database hoặc logic persistence trong controller.
- **Provider và DI:** Đăng ký dependency trong module và inject qua Nest container. Provider phụ thuộc Nest dùng `@Injectable()` khi phù hợp; application service độc lập Nest được tạo bằng `useFactory` chính thức. Không tự `new` service/repository trong controller.
- **Persistence:** Dùng `@nestjs/drizzle` tại composition root; repository adapter trong `@giaokhoa/database` thực hiện truy vấn. Controller và application service không import bảng Drizzle.
- **Pipe và Zod:** Giữ Zod schema chuẩn từ `@giaokhoa/shared/http/*`. Dùng `StandardSchemaValidationPipe` của NestJS 12 và gắn schema vào `@Body({ schema })`, `@Param(..., { schema })` hoặc `@Query({ schema })`. Không tự `parse`/`safeParse` request trong controller khi pipe xử lý được. Validation nghiệp vụ bên trong application service vẫn được phép.
- **Configuration:** Dùng `ConfigModule`/`ConfigService` và `validationSchema` với Zod theo Standard Schema như tài liệu NestJS 12; không thêm Joi, `class-validator` hoặc custom validation pipe khi không cần.
- **Guard và quyền truy cập:** Dùng guard/decorator của Nest hoặc adapter Better Auth tương thích để xác thực và phân quyền. Kiểm tra sở hữu và quy tắc domain thuộc application service.
- **Exception filter:** Ánh xạ `ClientError` thành lỗi HTTP bằng `ClientErrorFilter`. Không lặp lại phần xử lý lỗi chung tại từng controller.
- **Interceptor và response:** Dùng interceptor của Nest cho file upload hoặc xử lý chéo khi cần; chỉ dùng `@Res()` trực tiếp cho binary/streaming hoặc khi cần kiểm soát response gốc. Giữ HTTP descriptor và response schema chung làm hợp đồng transport.

Tài liệu tham chiếu chính thức: [Modules](https://docs.nestjs.com/modules), [Controllers](https://docs.nestjs.com/controllers), [Providers](https://docs.nestjs.com/providers), [Pipes](https://docs.nestjs.com/pipes), [Guards](https://docs.nestjs.com/guards), [Exception filters](https://docs.nestjs.com/exception-filters), [Interceptors](https://docs.nestjs.com/interceptors), [Configuration](https://docs.nestjs.com/techniques/configuration), [Drizzle](https://docs.nestjs.com/data/drizzle).
