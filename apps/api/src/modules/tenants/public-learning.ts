/**
 * Địa chỉ chính thức của khu học tập công cộng (issue #8).
 *
 * Công tắc triển khai chỉ bật SAU khi đã cấp phát và cài bí mật của kho
 * riêng. Khi bật, một hostname đúng nhưng sổ/secret chưa sẵn sàng sẽ
 * thất bại đóng, KHÔNG bao giờ tự rơi về kho nghiệp vụ dùng chung.
 */
export const PUBLIC_LEARNING_SLUG = 'cong-cong';

/**
 * Host công cộng phải là host GỐC đã khai báo trong BETTER_AUTH_URL,
 * không lấy X-Forwarded-Host do client tuỳ ý gửi. Khớp hostname và
 * bỏ khác biệt cổng của reverse proxy trong dev, nhưng không chấp
 * nhận tên miền tuỳ ý hay tên miền con của trung tâm.
 */
export function isPublicLearningHost(host: string | string[] | undefined): boolean {
  if (process.env.PUBLIC_LEARNING_ENABLED !== 'true') return false;
  const expected = process.env.BETTER_AUTH_URL;
  const candidate = Array.isArray(host) ? host[0] : host;
  if (!expected || !candidate || /[,/@?#\\\s]/.test(candidate)) return false;
  try {
    const hostname = new URL(expected).hostname.toLowerCase();
    const parsed = new URL(`http://${candidate}`);
    // URL parser hỗ trợ userinfo, fragment và query nhưng Host của
    // HTTP không được chứa các thành phần này — phải loại trước khi so.
    return Boolean(hostname) && !parsed.username && !parsed.password && parsed.hostname.toLowerCase() === hostname;
  } catch {
    return false;
  }
}
