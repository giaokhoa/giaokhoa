import { isIPv4 } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';

/**
 * Số chặng proxy mà Express/Nest tin cậy: đúng MỘT gateway Caddy.
 *
 * Caddy (`Caddyfile`) giữ nguyên Host, đọc địa chỉ khách theo `trusted_proxies_strict` từ phải sang trái, rồi gửi API duy nhất một IP đã chuẩn hóa qua `X-Forwarded-For: {client_ip}`. Vì vậy `trust proxy = 1` lấy chính IP đó thay vì tin chuỗi XFF gốc, vốn có thể chứa các phần tử giả mạo do client tự khai.
 *
 * Khi gọi API trực tiếp tại local (không qua gateway), Express lấy địa chỉ socket. Không bật `trust proxy = true`: nó tin mọi phần tử XFF và có thể nhận IP giả ở đầu chuỗi.
 */
export const TRUSTED_PROXY_HOPS = 1;

/**
 * Bật cấu hình proxy tin cậy cho ứng dụng Express/Nest theo
 * {@link TRUSTED_PROXY_HOPS}. Phải gọi ngay sau khi tạo app (cả
 * `main.ts` lẫn helper dựng app cho test) để `req.ip` ở mọi
 * controller là IP khách thật; throttler của Nest cũng tự khoá rate
 * limit theo IP đó vì nó đọc cùng `req.ip`.
 */
export function enableTrustedProxy(app: Pick<NestExpressApplication, 'set'>): void {
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
}

/**
 * Chuẩn hoá một địa chỉ IP trước khi ghi xuống phiên/nhật ký: cắt tiền tố `::ffff:` (dạng IPv4 ánh xạ vào IPv6 mà Node trả về cho kết nối IPv4 trên socket dual-stack) CHỈ khi phần còn lại là IPv4 hợp lệ. IPv6 thuần và mọi giá trị khác giữ nguyên; đầu vào undefined/rỗng trả về nguyên trạng để nơi gọi tự quyết định giá trị thay thế.
 */
export function normalizeIpAddress(ip: string | undefined): string | undefined {
  if (!ip) return ip;
  const prefix = '::ffff:';
  if (ip.startsWith(prefix)) {
    const rest = ip.slice(prefix.length);
    if (isIPv4(rest)) return rest;
  }
  return ip;
}

/**
 * ĐIỂM LẤY IP KHÁCH DUY NHẤT cho các controller: đọc `req.ip` — giá
 * trị Express đã tính từ cấu hình proxy tin cậy (xem
 * {@link enableTrustedProxy}) — rồi chuẩn hoá qua
 * {@link normalizeIpAddress}. Controller không được tự đọc header
 * `X-Forwarded-For` hay `req.socket.remoteAddress`, vì đọc tay rất
 * dễ lấy nhầm phần tử giả mạo ở đầu danh sách.
 */
export function clientIpOf(req: Pick<Request, 'ip'>): string | undefined {
  return normalizeIpAddress(req.ip);
}
