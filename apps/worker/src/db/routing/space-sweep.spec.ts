import { describe, expect, it } from 'vitest';
import { mapWithConcurrencyLimit } from './space-sweep';

describe('Bộ giới hạn đồng thời của vòng quét nhiều trung tâm', () => {
  it('không bao giờ chạy quá trần đồng thời và xử lý mọi phần tử đúng một lần', async () => {
    const items = [1, 2, 3, 4, 5, 6];
    let running = 0;
    let maxRunning = 0;
    const processed: number[] = [];
    const release: Array<() => void> = [];
    const done = mapWithConcurrencyLimit(items, 2, async (item) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((resolve) => {
        release.push(() => {
          running -= 1;
          processed.push(item);
          resolve();
        });
      });
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(running).toBe(2);
    while (release.length > 0) {
      release.shift()!();
      await new Promise((resolve) => setImmediate(resolve));
      expect(running).toBeLessThanOrEqual(2);
    }
    await done;
    expect(maxRunning).toBe(2);
    expect(processed.sort((a, b) => a - b)).toEqual(items);
  });

  it('trần bằng 1 thì các việc chạy tuần tự theo đúng thứ tự danh sách', async () => {
    const order: string[] = [];
    await mapWithConcurrencyLimit(['a', 'b', 'c'], 1, async (item) => {
      order.push(`start:${item}`);
      await new Promise((resolve) => setImmediate(resolve));
      order.push(`end:${item}`);
    });
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  it('lỗi của một lượt chạy được truyền ra qua promise trả về', async () => {
    const failure = new Error('việc lỗi');
    await expect(
      mapWithConcurrencyLimit([1, 2, 3], 2, async (item) => {
        if (item === 2) throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('danh sách rỗng thì hoàn thành ngay mà không chạy việc nào', async () => {
    let calls = 0;
    await mapWithConcurrencyLimit([], 3, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});
