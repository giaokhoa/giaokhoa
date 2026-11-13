/**
 * Tầng gọi API nghiệp vụ của web (issue #7, Giai đoạn 2 — cutover phiên cookie): từ cutover, web KHÔNG còn giữ credential nào ở localStorage. Mọi request đi cùng nguồn và trình duyệt tự mang cookie phiên Better Auth (xem `lib/auth-client.ts`); phía API, guard phiên dịch cookie thành danh tính cho mọi endpoint như trước đây Bearer JWT từng làm. Hệ quả trực tiếp: không còn vòng refresh token phía client — phiên hết hạn thì API trả 401 và tầng phiên
 * (AuthProvider) resolve về ẩn danh, khung đưa người dùng về đăng
 * nhập.
 */

import type { ProblemDetails } from '@giaokhoa/contracts';
import { problemDetailsSchema } from '@giaokhoa/contracts';



/**
 * Chuyển hướng toàn trang tới một URL ngoài hệ thống (trang authorize của nhà cung cấp OAuth). Gói thành hàm riêng có tên để các luồng đăng nhập ngoài dùng chung một biên điều hướng — và để test thay được biên này, vì jsdom khoá cứng `window.location` (không mock trực tiếp được thuộc tính href).
 */
export function redirectToExternalUrl(url: string): void {
  window.location.href = url;
}

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }
}

/** Thân JSON rỗng cho các POST không mang dữ liệu — dùng chung thay cho chuỗi `'{}'` viết tay ở từng lời gọi. */
export const EMPTY_JSON_BODY = '{}';

/**
 * Lỗi kiểu riêng cho bước thách thức hai lớp: khi sign-in bằng mật khẩu trả `twoFactorRedirect`, phía server CHƯA tạo phiên nào — trang login phải chuyển sang bước nhập mã TOTP/mã dự phòng rồi hoàn tất qua client twoFactor. Tách thành class riêng để tầng giao diện phân biệt bằng `instanceof` thay vì dò hình dạng đáp ứng.
 */
export class TwoFactorRedirectError extends Error {
  constructor() {
    super('Two-factor authentication is required to finish signing in');
    this.name = 'TwoFactorRedirectError';
  }
}

/**
 * Dựng `ApiError` từ một đáp ứng HTTP lỗi: thân đáp ứng parse được bằng schema Problem Details thì dùng nguyên, không parse được thì dựng Problem Details tối thiểu mang ĐÚNG status thật và mã `http.unknown` — status không bao giờ bị mất.
 */
export async function parseProblem(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = problemDetailsSchema.safeParse(body);
  return new ApiError(
    parsed.success
      ? parsed.data
      : { type: 'about:blank', title: res.statusText, status: res.status, code: 'http.unknown' },
  );
}

/**
 * Chuẩn hoá lỗi từ client Better Auth (hình `{ status, code, message }` của better-fetch) về ApiError/Problem Details để các bề mặt hiển thị lỗi dùng chung một đường như lỗi của API nghiệp vụ. `detail` mang message gốc của server (ví dụ "Invalid username or password") — đó là thông điệp đã được phía auth kiểm soát cho người dùng cuối.
 */
export function apiErrorFromAuthClient(error: { status?: number; code?: string; message?: string }): ApiError {
  const status = error.status ?? 400;
  const message = error.message ?? 'Yêu cầu thất bại';
  return new ApiError({
    type: 'about:blank',
    title: message,
    status,
    detail: message,
    code: error.code ?? 'auth.request_failed',
  });
}

/**
 * Thông điệp lỗi từ API (problem detail) hoặc thông điệp dự phòng theo i18n.
 * Dùng chung cho mọi bề mặt hiển thị lỗi bắt được từ đột biến/tải dữ liệu
 * (trước đây chỉ có ở `features/admin-curriculum/utils/shared.ts`).
 */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.problem.detail ?? err.problem.title ?? fallback) : fallback;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  // FormData phải để trình duyệt tự đặt Content-Type multipart kèm boundary — ép JSON sẽ làm hỏng mọi tải lên.
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  // Cookie phiên đi kèm tường minh: cùng nguồn trình duyệt vốn đã gửi, khai rõ để các môi trường nhúng (test, iframe cùng nguồn) giữ đúng một hành vi.
  return fetch(path, { ...init, headers, credentials: 'same-origin' });
}

/**
 * Tải một Response dạng blob về máy bằng thẻ neo tạm (điệu tải file dùng chung của web).
 *
 * Trước đây mỗi nơi tự viết lại cùng khuôn: kiểm tra `ok` → `blob()` → `URL.createObjectURL` → thẻ `<a>` ẩn `.click()` → thu hồi URL.
 * Helper này giữ nguyên khuôn đó, chỉ khác tên file: tên file lấy đúng tham số truyền vào (không đọc header của server) để hành vi tải
 * của các endpoint dùng tên cố định (`calendar.ics`, `vnedu-<id>.xlsx`, mẫu roster) không đổi.
 *
 * @param res - Response đã fetch (giữ nguyên Response để đọc blob).
 * @param filename - Tên file khi trình duyệt lưu.
 */
export async function downloadBlob(res: Response, filename: string): Promise<void> {
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Tải một Response dạng blob về máy, ưu tiên tên file do server gửi qua header `Content-Disposition`.
 *
 * Cùng khuôn với `downloadBlob`, chỉ khác cách chọn tên: tên file ưu tiên lấy nguyên từ header của server (nguồn sự thật về tên bản xuất);
 * chỉ khi header vắng/sai dạng mới dùng tên dự phòng truyền vào. Dùng cho các lượt xuất mà server đặt tên file theo nội dung (đặc tả ma trận, mẫu nhập ma trận).
 *
 * @param res - Response đã fetch (giữ nguyên Response để đọc header + blob).
 * @param fallbackFilename - Tên file dự phòng khi header không có tên hợp lệ.
 */
export async function downloadBlobNamedByServer(res: Response, fallbackFilename: string): Promise<void> {
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackFilename;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw await parseProblem(res);
  return (await res.json()) as T;
}

/**
 * Tải một tài nguyên đọc: trả dữ liệu khi gọi được, null khi bị từ chối/lỗi.
 *
 * Bản duy nhất dùng chung của điệu "probe" (trước đây mỗi module tự định nghĩa lại giống hệt nhau ở `lib/permissions.tsx`,
 * `hooks/use-courses-grade-data.ts`, `features/matrices/api/matrix.ts` và dạng nội tuyến trong `lib/course-content.ts`).
 * Dùng cho các lượt đọc độc lập mà lỗi của một lượt không được sập cả query (mỗi phần null riêng).
 *
 * @param path - Đường dẫn API cần đọc.
 * @returns Dữ liệu, hoặc null khi gọi lỗi.
 */
export async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch {
    return null;
  }
}
