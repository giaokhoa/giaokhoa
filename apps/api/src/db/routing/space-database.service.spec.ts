import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { CentreDb } from '@giaokhoa/db';
import type { ControlPlaneConnection } from '../control-plane-connection.service';
import { SpaceDatabaseService } from './space-database.service';
import { SpaceRoutingError } from './space-connection-resolver';

const services: SpaceDatabaseService[] = [];

function makeService(): SpaceDatabaseService {
  const config = { get: () => undefined } as unknown as ConfigService;
  const controlPlane = {} as unknown as ControlPlaneConnection;
  const service = new SpaceDatabaseService(config, controlPlane);
  services.push(service);
  return service;
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.onModuleDestroy()));
});

describe('Handle Kysely định tuyến theo không gian khi chưa bind handle chung', () => {
  it('await handle định tuyến không ném lỗi và trả về chính handle đó', async () => {
    const service = makeService();
    const awaited = await service.routedKysely;
    expect(awaited).toBe(service.routedKysely);
    expect((service.routedKysely as unknown as { then?: unknown }).then).toBeUndefined();
    expect((service.routedKysely as unknown as { constructor?: unknown }).constructor).toBeUndefined();
  });

  it('đọc thuộc tính truy vấn thật khi chưa bind vẫn ném lỗi handle chưa bind', () => {
    const service = makeService();
    expect(() => service.routedKysely.selectFrom).toThrow(SpaceRoutingError);
    expect(() => service.routedKysely.selectFrom).toThrow(
      'Shared Kysely database handle is not bound yet',
    );
  });

  it('Nest kiểm tra lifecycle hook trên handle khi chưa bind không ném lỗi và trả về undefined', () => {
    const service = makeService();
    const handle = service.routedKysely as unknown as Record<string, unknown>;
    expect(handle.onModuleInit).toBeUndefined();
    expect(handle.onModuleDestroy).toBeUndefined();
    expect(handle.onApplicationBootstrap).toBeUndefined();
    expect(handle.beforeApplicationShutdown).toBeUndefined();
    expect(handle.onApplicationShutdown).toBeUndefined();
  });

  it('sau khi bind handle chung thì đọc thuộc tính truy vấn thật đi qua handle đã bind', async () => {
    const service = makeService();
    const selectFrom = vi.fn();
    service.bindSharedKysely({ selectFrom } as unknown as CentreDb);
    const routedSelectFrom = service.routedKysely.selectFrom as unknown as (...args: unknown[]) => unknown;
    expect(typeof routedSelectFrom).toBe('function');
    routedSelectFrom('bang_khach_hang');
    expect(selectFrom).toHaveBeenCalledTimes(1);
    expect(await service.routedKysely).toBe(service.routedKysely);
    expect((service.routedKysely as unknown as { then?: unknown }).then).toBeUndefined();
  });
});
