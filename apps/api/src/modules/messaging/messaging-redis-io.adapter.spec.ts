import { describe, expect, it } from 'vitest';
import { isMessagingOriginAllowed } from './messaging-redis-io.adapter';

describe('Bảo vệ kết nối Socket.IO', () => {
  const origins = ['https://example.org', 'http://localhost:5173'];

  it('chấp nhận origin thuộc allowlist khi mở polling hoặc WebSocket', () => {
    expect(isMessagingOriginAllowed('https://example.org', origins)).toBe(true);
  });

  it('từ chối origin bên ngoài allowlist, kể cả giá trị null của trình duyệt', () => {
    expect(isMessagingOriginAllowed('https://evil.example', origins)).toBe(false);
    expect(isMessagingOriginAllowed('null', origins)).toBe(false);
  });

  it('chấp nhận client không có Origin nhưng vẫn cần xác thực phiên khi kết nối', () => {
    expect(isMessagingOriginAllowed(undefined, origins)).toBe(true);
  });
});
