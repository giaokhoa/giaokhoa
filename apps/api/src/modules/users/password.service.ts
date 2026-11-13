import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

export interface PasswordPolicy { minLength: number; minDigits: number; minLower: number; minUpper: number; minNonAlnum: number }

/** Băm mật khẩu (argon2id) + chính sách có thể cấu hình (chính sách auth của Moodle — là cấu hình, không bao giờ fix cứng luật trong code). */
/** Bảng các lớp ký tự bắt buộc của chính sách: mẫu đếm ký tự + số lượng tối thiểu lấy từ chính sách hiện hành + thông điệp khi thiếu. */
const POLICY_CHARACTER_CHECKS: readonly {
  pattern: RegExp;
  min: (policy: PasswordPolicy) => number;
  message: (min: number) => string;
}[] = [
  { pattern: /\d/g, min: (p) => p.minDigits, message: (n) => `Password must contain at least ${n} digit(s)` },
  { pattern: /[a-z]/g, min: (p) => p.minLower, message: (n) => `Password must contain at least ${n} lowercase letter(s)` },
  { pattern: /[A-Z]/g, min: (p) => p.minUpper, message: (n) => `Password must contain at least ${n} uppercase letter(s)` },
  { pattern: /[^a-zA-Z0-9]/g, min: (p) => p.minNonAlnum, message: (n) => `Password must contain at least ${n} non-alphanumeric character(s)` },
];

@Injectable()
/**
 * Chính sách và băm mật khẩu. Đối chiếu Moodle: lib/moodlelib.php (check_password_policy); hàm băm dùng argon2id. Chính sách mặc định: tối thiểu 8 ký tự, có chữ thường, chữ hoa, số và ký tự đặc biệt; các thông điệp con được gộp vào message nội bộ của lỗi user.password_policy (chi tiết hiển thị lấy từ catalog i18n).
 */
export class PasswordService {
  constructor(private readonly config: ConfigService) {}
  /**
   * Chính sách mật khẩu hiện hành (độ dài tối thiểu và các lớp ký tự bắt buộc).
   */
  policy(): PasswordPolicy {
    return {
      minLength: this.config.get<number>('PASSWORD_MIN_LENGTH') ?? 8,
      minDigits: this.config.get<number>('PASSWORD_MIN_DIGITS') ?? 1,
      minLower: this.config.get<number>('PASSWORD_MIN_LOWER') ?? 1,
      minUpper: this.config.get<number>('PASSWORD_MIN_UPPER') ?? 1,
      minNonAlnum: this.config.get<number>('PASSWORD_MIN_NONALNUM') ?? 0,
    };
  }
  /**
   * Trả về danh sách các vi phạm chính sách (rỗng = chấp nhận được).
   * Kiểm tra mật khẩu theo chính sách; trả danh sách lý do không đạt (rỗng = đạt).
   */
  validatePolicy(password: string): string[] {
    const p = this.policy();
    const errors: string[] = [];
    if (password.length < p.minLength) errors.push(`Password must be at least ${p.minLength} characters`);
    for (const check of POLICY_CHARACTER_CHECKS) {
      const required = check.min(p);
      if ((password.match(check.pattern) ?? []).length < required) errors.push(check.message(required));
    }
    return errors;
  }
  /**
   * Băm mật khẩu bằng argon2id trước khi lưu.
   */
  async hash(password: string): Promise<string> { return argon2.hash(password, { type: argon2.argon2id }); }
  /**
   * So khớp mật khẩu thô với hash đã lưu. Hash sai định dạng được coi là không khớp thay vì ném lỗi ra ngoài.
   */
  async verify(hash: string, password: string): Promise<boolean> {
    try { return await argon2.verify(hash, password); } catch { return false; }
  }
}
