import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { HealthStatus } from '@giaokhoa/contracts';
import { HealthController } from './health.controller';
import type { HealthService } from './health.service';

describe('Endpoint sức khỏe HTTP', () => {
  const runHealthCheck = async (status: HealthStatus) => {
    const check = vi.fn(async () => status);
    const setStatus = vi.fn();
    const controller = new HealthController({ check } as unknown as HealthService);
    const payload = await controller.getHealth({ status: setStatus } as unknown as Response);
    return { payload, setStatus };
  };

  it('trả HTTP 200 khi PostgreSQL và Redis cùng sẵn sàng', async () => {
    const status: HealthStatus = {
      status: 'ok', timestamp: '2026-11-13T00:00:00.000Z', checks: { database: 'up', redis: 'up' },
    };
    const result = await runHealthCheck(status);
    expect(result.setStatus).toHaveBeenCalledWith(200);
    expect(result.payload).toEqual(status);
  });

  it('trả HTTP 503 và dữ kiện chẩn đoán khi một phụ thuộc bị gián đoạn', async () => {
    const status: HealthStatus = {
      status: 'error', timestamp: '2026-11-13T00:00:00.000Z', checks: { database: 'up', redis: 'down' },
    };
    const result = await runHealthCheck(status);
    expect(result.setStatus).toHaveBeenCalledWith(503);
    expect(result.payload).toEqual(status);
  });
});
