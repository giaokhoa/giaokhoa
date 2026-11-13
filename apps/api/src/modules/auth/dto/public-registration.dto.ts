import { z } from 'zod';

/**
 * Luật username của đăng ký công cộng — bản sao có chủ đích của các hằng nội bộ trong `better-auth/credential-bridge.service.ts` (`USERNAME_MIN_LENGTH`/`USERNAME_MAX_LENGTH`/`USERNAME_PATTERN`, mặc định của plugin username Better Auth: dài tối thiểu 3, tối đa 30, chỉ gồm chữ cái, chữ số, `_` và `.`). Các hằng đó là `const` nội bộ của cầu nối, không export để dùng chung, nên schema này giữ lại giá trị bằng chữ kèm dẫn chiếu để hai nơi không lệch lặng khi một bên đổi.
 */
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

/**
 * Độ dài mật khẩu tối thiểu — phải khớp mặc định của `PasswordService.policy()` (`PASSWORD_MIN_LENGTH ?? 8` trong `users/password.service.ts`): chính sách mật khẩu lấy từ cấu hình nên schema route chỉ ghi được giá trị mặc định; đổi mặc định ở `PasswordService` thì đổi cả hằng này.
 */
const PASSWORD_MIN_LENGTH = 8;

/**
 * Schema đăng ký tài khoản độc lập ở khu công cộng (chuyển ra từ `public-registration.controller.ts` cho đúng mẫu dto của repo: schema + type export đặt ở `dto/`, controller chỉ dùng). Không dùng sign-up toàn cục của Better Auth vì địa chỉ trung tâm và kho vận hành không được phép tự tạo tài khoản.
 */
export const publicRegistrationSchema = z.object({
  username: z.string().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH).regex(USERNAME_PATTERN),
  email: z.email(),
  password: z.string().min(PASSWORD_MIN_LENGTH),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum(['student', 'teacher']),
});

/** Dữ liệu đăng ký công cộng đã kiểm chứng. */
export type PublicRegistrationDto = z.infer<typeof publicRegistrationSchema>;
