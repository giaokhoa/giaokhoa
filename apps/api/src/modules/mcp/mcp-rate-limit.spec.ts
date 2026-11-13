import { describe, expect, it } from 'vitest';
import { McpRateLimiter } from './mcp-rate-limit';

const HOUR_MS = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

type WindowsMap = Map<string, { windowStart: number; count: number }>;

function windowsOf(limiter: McpRateLimiter): WindowsMap {
  return (limiter as unknown as { windows: WindowsMap }).windows;
}

describe('McpRateLimiter — quyết định cho phép/chặn trong cửa sổ', () => {
  it('cho phép các lượt gọi trong hạn mức và chặn lượt vượt hạn với retryAfterSeconds bằng phần còn lại của cửa sổ', () => {
    const limiter = new McpRateLimiter({ read: 3, create: 120, publish: 10 });
    expect(limiter.check('u1', 'read', T0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.check('u1', 'read', T0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.check('u1', 'read', T0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.check('u1', 'read', T0)).toEqual({ allowed: false, retryAfterSeconds: 3600 });
    expect(limiter.check('u1', 'read', T0 + 1000)).toEqual({ allowed: false, retryAfterSeconds: 3599 });
  });

  it('ngay trước biên cửa sổ vẫn chặn, đúng tại biên cửa sổ thì cho phép và đếm lại từ đầu', () => {
    const limiter = new McpRateLimiter({ read: 1, create: 120, publish: 10 });
    expect(limiter.check('u1', 'read', T0).allowed).toBe(true);
    expect(limiter.check('u1', 'read', T0 + HOUR_MS - 1)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.check('u1', 'read', T0 + HOUR_MS)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.check('u1', 'read', T0 + HOUR_MS).allowed).toBe(false);
  });

  it('tính hạn mức theo cost: batch cộng dồn số item, cost nhỏ hơn 1 tính là 1 và cost lẻ làm tròn xuống', () => {
    const limiter = new McpRateLimiter({ read: 300, create: 5, publish: 10 });
    expect(limiter.check('u1', 'create', T0, 2).allowed).toBe(true);
    expect(limiter.check('u1', 'create', T0, 2).allowed).toBe(true);
    expect(limiter.check('u1', 'create', T0, 2).allowed).toBe(false);
    expect(limiter.check('u1', 'create', T0, 1).allowed).toBe(true);
    expect(limiter.check('u1', 'create', T0, 1).allowed).toBe(false);
    expect(limiter.check('u2', 'create', T0, 0).allowed).toBe(true);
    expect(limiter.check('u2', 'create', T0, 4).allowed).toBe(true);
    expect(limiter.check('u2', 'create', T0, 1).allowed).toBe(false);
    expect(limiter.check('u3', 'create', T0, 2.9).allowed).toBe(true);
    expect(limiter.check('u3', 'create', T0, 3).allowed).toBe(true);
    expect(limiter.check('u3', 'create', T0, 1).allowed).toBe(false);
  });

  it('các xô hạn mức độc lập với nhau và các người dùng độc lập với nhau', () => {
    const limiter = new McpRateLimiter({ read: 300, create: 1, publish: 10 });
    expect(limiter.check('u1', 'create', T0).allowed).toBe(true);
    expect(limiter.check('u1', 'create', T0).allowed).toBe(false);
    expect(limiter.check('u1', 'read', T0).allowed).toBe(true);
    expect(limiter.check('u2', 'create', T0).allowed).toBe(true);
  });

  it('ánh xạ tool sang đúng xô: publish_questions vào publish, các tool ghi câu hỏi vào create, còn lại vào read', () => {
    expect(McpRateLimiter.bucketForTool('publish_questions')).toBe('publish');
    expect(McpRateLimiter.bucketForTool('create_question')).toBe('create');
    expect(McpRateLimiter.bucketForTool('create_questions_batch')).toBe('create');
    expect(McpRateLimiter.bucketForTool('create_stimulus_with_questions')).toBe('create');
    expect(McpRateLimiter.bucketForTool('submit_contribution')).toBe('create');
    expect(McpRateLimiter.bucketForTool('list_questions')).toBe('read');
    expect(McpRateLimiter.bucketForTool(undefined)).toBe('read');
  });
});

describe('McpRateLimiter — dọn entry hết hạn khỏi Map cửa sổ', () => {
  it('xoá entry đã hết hạn khỏi Map khi một phép kiểm tra khác chạy sau thời điểm hết hạn', () => {
    const limiter = new McpRateLimiter({ read: 300, create: 120, publish: 10 });
    limiter.check('u1', 'read', T0);
    expect(windowsOf(limiter).size).toBe(1);
    limiter.check('u2', 'read', T0 + HOUR_MS + 1000);
    expect(windowsOf(limiter).size).toBe(1);
    expect(windowsOf(limiter).has('u1:read')).toBe(false);
    expect(windowsOf(limiter).has('u2:read')).toBe(true);
  });

  it('giữ nguyên entry và bộ đếm của khoá còn trong cửa sổ khi dọn entry đã hết hạn', () => {
    const limiter = new McpRateLimiter({ read: 300, create: 120, publish: 2 });
    limiter.check('userA', 'publish', T0);
    limiter.check('userB', 'publish', T0 + HOUR_MS / 2);
    limiter.check('userB', 'publish', T0 + HOUR_MS / 2);
    const now = T0 + HOUR_MS + 1000;
    limiter.check('userC', 'publish', now);
    expect(windowsOf(limiter).size).toBe(2);
    expect(windowsOf(limiter).has('userA:publish')).toBe(false);
    expect(limiter.check('userB', 'publish', now)).toEqual({
      allowed: false,
      retryAfterSeconds: 1799,
    });
  });

  it('kích thước Map không tăng đơn điệu khi nhiều khoá khác nhau gọi qua nhiều cửa sổ liên tiếp', () => {
    const limiter = new McpRateLimiter({ read: 300, create: 120, publish: 10 });
    const keysPerWindow = 20;
    const windowCount = 5;
    for (let round = 0; round < windowCount; round++) {
      const now = T0 + round * (HOUR_MS + 1);
      for (let i = 0; i < keysPerWindow; i++) {
        limiter.check(`user-r${round}-${i}`, 'read', now);
      }
      expect(windowsOf(limiter).size).toBe(keysPerWindow);
    }
    expect(windowsOf(limiter).size).toBe(20);
  });
});
