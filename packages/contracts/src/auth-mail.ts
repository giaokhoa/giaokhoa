
export interface PasswordResetMailPayload {
  kind: 'password_reset';
  to: string;
  url: string;
}

export interface EmailOtpMailPayload {
  kind: 'email_otp';
  to: string;
  otp: string;
  otpType: string;
}

export type AuthMailPayload = PasswordResetMailPayload | EmailOtpMailPayload;

export interface RenderedAuthMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const RESET_LINK_VALIDITY_TEXT = '1 giờ';
const OTP_VALIDITY_TEXT = '5 phút';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderAuthMail(payload: AuthMailPayload): RenderedAuthMail {
  if (payload.kind === 'password_reset') {
    const subject = 'Đặt lại mật khẩu tài khoản Giáo khoa';
    const text = [
      'Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho tài khoản Giáo khoa gắn với email này.',
      '',
      `Mở liên kết sau để đặt mật khẩu mới (có hiệu lực trong ${RESET_LINK_VALIDITY_TEXT}, chỉ dùng được một lần):`,
      payload.url,
      '',
      'Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.',
    ].join('\n');
    const html = [
      '<p>Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho tài khoản Giáo khoa gắn với email này.</p>',
      `<p><a href="${escapeHtml(payload.url)}">Đặt mật khẩu mới</a> (liên kết có hiệu lực trong ${RESET_LINK_VALIDITY_TEXT}, chỉ dùng được một lần).</p>`,
      '<p>Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.</p>',
    ].join('\n');
    return { to: payload.to, subject, text, html };
  }

  const forPasswordReset = payload.otpType === 'forget-password';
  const subject = forPasswordReset ? 'Mã đặt lại mật khẩu Giáo khoa' : 'Mã đăng nhập Giáo khoa của bạn';
  const purpose = forPasswordReset
    ? 'Mã để đặt lại mật khẩu tài khoản Giáo khoa của bạn là:'
    : 'Mã đăng nhập tài khoản Giáo khoa của bạn là:';
  const text = [
    purpose,
    '',
    payload.otp,
    '',
    `Mã có hiệu lực trong ${OTP_VALIDITY_TEXT}. Không chia sẻ mã này cho bất kỳ ai — đội ngũ Giáo khoa không bao giờ hỏi mã của bạn.`,
  ].join('\n');
  const html = [
    `<p>${purpose}</p>`,
    `<p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${escapeHtml(payload.otp)}</p>`,
    `<p>Mã có hiệu lực trong ${OTP_VALIDITY_TEXT}. Không chia sẻ mã này cho bất kỳ ai — đội ngũ Giáo khoa không bao giờ hỏi mã của bạn.</p>`,
  ].join('\n');
  return { to: payload.to, subject, text, html };
}
