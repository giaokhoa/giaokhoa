import { vi } from 'vitest';
import type { UserProfile } from '@giaokhoa/contracts';

/**
 * Stub `fetch` dùng chung cho spec web (S24 của rà soát code style): thay cho
 * mỗi spec tự viết lại `vi.stubGlobal('fetch', ...)` + dựng `Response`
 * JSON thủ công. Handler của spec chỉ quyết định đáp ứng cho từng URL;
 * mọi chuyện ghi đè global, mã trạng thái mặc định và Content-Type đều ở
 * đây. Spec nào cần ghi lại lời gọi thì tự `push` vào mảng của mình trong
 * handler (handler nhận đúng `url`/`init` của fetch), hoặc truyền mảng
 * `calls` cho `stubFetchWithMethod`.
 *
 * Hai hình dạng handler cùng tồn tại vì hai nhóm spec dùng hai quy ước
 * khác nhau và không gộp được mà không sửa handler của một bên:
 * `stubFetch` cho handler dạng ngắn `(url, init)` (nhóm dashboard,
 * learning-plan, grades, platform — handler đọc `init?.method`/`init?.body`
 * và trả `{ status, body }` khi cần trạng thái riêng); `stubFetchWithMethod`
 * cho handler dạng đầy đủ `(url, method, body, init)` (nhóm messaging,
 * notifications — handler đọc thẳng `method`/`body` đã parse).
 */

/** Đáp ứng JSON cho stub fetch (đúng Content-Type như API thật). */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Một lời gọi fetch đã ghi: URL + method + body đã parse (undefined khi không có body). */
export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Handler stub fetch dạng ngắn: nhận URL và `init` thô của fetch; trả thân
 * JSON (đáp 200), cặp `{ status, body }` (đáp đúng trạng thái đó), hoặc
 * `undefined` (đáp 404 rỗng).
 */
export type StubFetchHandler = (url: string, init?: RequestInit) => unknown;

/**
 * Handler stub fetch dạng đầy đủ: nhận URL/method/body đã parse (và `init`
 * thô khi cần đọc header) rồi trả body JSON, Response sẵn, hoặc undefined.
 */
export type StubFetchMethodHandler = (
  url: string,
  method: string,
  body: unknown,
  init?: RequestInit,
) => unknown | Response | undefined;

/** Kết quả có mang trạng thái riêng (ví dụ 403 cho endpoint bị khoá quyền). */
function isStatusResult(value: unknown): value is { status: number; body: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'body' in value &&
    typeof (value as { status: unknown }).status === 'number'
  );
}

/**
 * Cài stub fetch toàn cục theo handler dạng ngắn: URL lạ thì 404 `'{}'` như
 * các stub cũ.
 *
 * @param handler - Bảng route của spec.
 */
export function stubFetch(handler: StubFetchHandler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const result = handler(url, init);
      if (result === undefined) return jsonResponse({}, 404);
      if (isStatusResult(result)) return jsonResponse(result.body, result.status);
      return jsonResponse(result, 200);
    }),
  );
}

/**
 * Cài stub fetch toàn cục theo handler dạng đầy đủ: ghi lời gọi vào `calls`
 * (khi truyền), rồi định tuyến qua `handler` — lạ thì 404 `'{}'` như các
 * stub cũ. Handler được phép giữ state riêng (ví dụ trạng thái chặn thay
 * đổi theo POST/DELETE) vì nó là closure của spec đó.
 *
 * @param handler - Bảng route của spec.
 * @param calls - Mảng ghi lời gọi (không truyền thì không ghi).
 */
export function stubFetchWithMethod(handler: StubFetchMethodHandler, calls?: RecordedCall[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls?.push({ url, method, body });
      const result = handler(url, method, body, init);
      if (result === undefined)
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      if (result instanceof Response) return result;
      return jsonResponse(result);
    }),
  );
}

/**
 * Hồ sơ người dùng mẫu cho spec: mọi trường theo đúng `userProfileSchema`
 * của contracts; spec ghi đè id/username/tên qua `overrides` để khớp vai
 * đang stub. Mốc `createdAt` ghim ở quá khứ cố định để chuỗi hiển thị ổn định.
 */
export function userProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: '01900000-0000-7000-8000-000000000001',
    username: 'user',
    firstName: 'Người',
    lastName: 'Dùng',
    email: 'user@example.com',
    suspended: false,
    deleted: false,
    isGuest: false,
    forcePasswordChange: false,
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    customFields: [],
    ...overrides,
  };
}
