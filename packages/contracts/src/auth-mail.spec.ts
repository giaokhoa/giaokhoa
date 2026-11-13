import { describe, expect, it } from 'vitest';
import { renderAuthMail } from './auth-mail.js';

describe('Khối renderAuthMail', () => {
  it('dựng mail đặt lại mật khẩu mang liên kết dùng một lần và hạn 1 giờ', () => {
    const url = 'http://localhost:3100/api/v1/auth/reset-password/abc123?callbackURL=%2Freset-password';
    const mail = renderAuthMail({ kind: 'password_reset', to: 'a@example.com', url });
    expect(mail.to).toBe('a@example.com');
    expect(mail.subject).toBe('Đặt lại mật khẩu tài khoản Giáo khoa');
    expect(mail.text).toContain(url);
    expect(mail.text).toContain('1 giờ');
    expect(mail.html).toContain(`href="${url}"`);
  });

  it('dựng mail OTP đăng nhập mang mã và hạn hiệu lực 5 phút', () => {
    const mail = renderAuthMail({ kind: 'email_otp', to: 'b@example.com', otp: '482916', otpType: 'sign-in' });
    expect(mail.subject).toBe('Mã đăng nhập Giáo khoa của bạn');
    expect(mail.text).toContain('482916');
    expect(mail.text).toContain('5 phút');
    expect(mail.html).toContain('482916');
  });

  it('dùng tiêu đề riêng cho OTP đặt lại mật khẩu để người nhận không nhầm với OTP đăng nhập', () => {
    const mail = renderAuthMail({ kind: 'email_otp', to: 'b@example.com', otp: '103857', otpType: 'forget-password' });
    expect(mail.subject).toBe('Mã đặt lại mật khẩu Giáo khoa');
    expect(mail.text).toContain('103857');
  });
});
