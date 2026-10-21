# Quy ước cho `apps/api`

- Theo API chính thức của NestJS 12: dùng `@Module`, controller, provider và dependency injection sẵn có; controller chỉ xử lý transport.
- Nghiệp vụ thuộc `@giaokhoa/application`; truy vấn dữ liệu thuộc adapter `@giaokhoa/database`. Composition root dùng `@nestjs/drizzle`.
- Validate HTTP bằng schema từ `@giaokhoa/shared/http/*` qua `StandardSchemaValidationPipe`; không lặp parse tại controller.
- Cấu hình qua `ConfigModule` và schema Zod; dùng `ClientErrorFilter` để ánh xạ application error sang HTTP.
