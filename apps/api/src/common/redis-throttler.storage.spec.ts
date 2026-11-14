import { createServer, type Server, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { RedisThrottlerStorage } from './redis-throttler.storage';

const DEAD_REDIS_URL = 'redis://localhost:6399';
const TIMEOUT_MESSAGE = 'Redis throttler storage did not become ready in time';

function makeStorage(url = DEAD_REDIS_URL): RedisThrottlerStorage {
  const config = {
    getOrThrow: () => url,
  } as unknown as ConfigService;
  return new RedisThrottlerStorage(config);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redisStatusOf(storage: RedisThrottlerStorage): string {
  return (storage as unknown as { redis: { status: string } }).redis.status;
}

function redisClientOf(storage: RedisThrottlerStorage): { disconnect(): void } {
  return (storage as unknown as { redis: { disconnect(): void } }).redis;
}

function parseRespCommands(buffer: Buffer): { commands: string[][]; rest: Buffer } {
  const commands: string[][] = [];
  let offset = 0;
  for (;;) {
    if (offset >= buffer.length || buffer[offset] !== 0x2a) break;
    const countEnd = buffer.indexOf('\r\n', offset);
    if (countEnd === -1) break;
    const count = Number(buffer.subarray(offset + 1, countEnd).toString());
    if (!Number.isInteger(count) || count < 0) break;
    let pos = countEnd + 2;
    const args: string[] = [];
    let complete = true;
    for (let i = 0; i < count; i += 1) {
      if (pos >= buffer.length) {
        complete = false;
        break;
      }
      if (buffer[pos] === 0x24) {
        const lengthEnd = buffer.indexOf('\r\n', pos);
        if (lengthEnd === -1) {
          complete = false;
          break;
        }
        const length = Number(buffer.subarray(pos + 1, lengthEnd).toString());
        const start = lengthEnd + 2;
        if (buffer.length < start + length + 2) {
          complete = false;
          break;
        }
        args.push(buffer.subarray(start, start + length).toString());
        pos = start + length + 2;
      } else if (buffer[pos] === 0x3a) {
        const valueEnd = buffer.indexOf('\r\n', pos);
        if (valueEnd === -1) {
          complete = false;
          break;
        }
        args.push(buffer.subarray(pos + 1, valueEnd).toString());
        pos = valueEnd + 2;
      } else {
        complete = false;
        break;
      }
    }
    if (!complete) break;
    commands.push(args);
    offset = pos;
  }
  return { commands, rest: Buffer.from(buffer.subarray(offset)) };
}

function replyFor(command: string[]): string {
  const name = command[0]?.toLowerCase();
  if (name === 'hello') {
    return '%3\r\n$6\r\nserver\r\n$5\r\nredis\r\n$7\r\nversion\r\n$5\r\n7.0.0\r\n$5\r\nproto\r\n:3\r\n';
  }
  if (name === 'info') {
    const payload = 'redis_version:7.0.0\r\nredis_mode:standalone\r\nloading:0\r\n';
    return `$${Buffer.byteLength(payload)}\r\n${payload}\r\n`;
  }
  if (name === 'eval') return '-ERR unknown command\r\n';
  return '+OK\r\n';
}

async function waitForRedisStatus(
  storage: RedisThrottlerStorage,
  status: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (redisStatusOf(storage) === status) return;
    if (Date.now() > deadline) throw new Error(`Redis không đạt trạng thái ${status} sau thời gian chờ`);
    await sleep(100);
  }
}

async function waitForRedisReady(storage: RedisThrottlerStorage, timeoutMs = 15_000): Promise<void> {
  await waitForRedisStatus(storage, 'ready', timeoutMs);
}

describe('Storage throttler Redis khi Redis chưa sẵn sàng', () => {
  it('Redis không trả lời thì increment lỗi sau thời gian chờ giới hạn thay vì treo vô hạn', async () => {
    const storage = makeStorage();
    try {
      const startedAt = Date.now();
      await expect(storage.increment('khoa', 5000, 3, 5000, 'unit-test')).rejects.toThrow(
        TIMEOUT_MESSAGE,
      );
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4900);
    } finally {
      await storage.onModuleDestroy();
    }
  });

  it('increment gọi trong lúc đang chờ và sau lần chờ đầu lỗi nhanh thay vì chờ đủ thời gian chờ', async () => {
    const storage = makeStorage();
    try {
      const first = storage.increment('khoa', 5000, 3, 5000, 'unit-test');
      await sleep(4000);
      const joinedAt = Date.now();
      await expect(storage.increment('khoa', 5000, 3, 5000, 'unit-test')).rejects.toThrow(
        TIMEOUT_MESSAGE,
      );
      expect(Date.now() - joinedAt).toBeLessThan(3000);
      await expect(first).rejects.toThrow(TIMEOUT_MESSAGE);
      const failedFastAt = Date.now();
      await expect(storage.increment('khoa', 5000, 3, 5000, 'unit-test')).rejects.toThrow(
        TIMEOUT_MESSAGE,
      );
      expect(Date.now() - failedFastAt).toBeLessThan(1000);
    } finally {
      await storage.onModuleDestroy();
    }
  });

  it('Redis đã đóng thì increment lỗi ngay với lỗi Redis đã đóng', async () => {
    const storage = makeStorage();
    try {
      redisClientOf(storage).disconnect();
      await waitForRedisStatus(storage, 'end', 5000);
      const startedAt = Date.now();
      await expect(storage.increment('khoa', 5000, 3, 5000, 'unit-test')).rejects.toThrow(
        'Redis throttler storage is closed',
      );
      expect(Date.now() - startedAt).toBeLessThan(1000);
    } finally {
      await storage.onModuleDestroy();
    }
  });

  it('Redis hồi phục sau lần chờ đầu thì increment không còn lỗi chờ quá hạn', async () => {
    const storage = makeStorage();
    const sockets = new Set<Socket>();
    const fakeRedis: Server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      let pending: Buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        const parsed = parseRespCommands(pending);
        pending = parsed.rest;
        for (const command of parsed.commands) socket.write(replyFor(command));
      });
    });
    try {
      await expect(storage.increment('khoa', 5000, 3, 5000, 'unit-test')).rejects.toThrow(
        TIMEOUT_MESSAGE,
      );
      await new Promise<void>((resolve) => fakeRedis.listen(6399, resolve));
      await waitForRedisReady(storage);
      const startedAt = Date.now();
      let failure: unknown;
      try {
        await storage.increment('khoa', 5000, 3, 5000, 'unit-test');
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(TIMEOUT_MESSAGE);
      expect(Date.now() - startedAt).toBeLessThan(2000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => fakeRedis.close(() => resolve()));
      await storage.onModuleDestroy();
    }
  });
});
