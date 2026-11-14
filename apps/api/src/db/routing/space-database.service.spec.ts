import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { ConfigService } from '@nestjs/config';
import type { CentreDb } from '@giaokhoa/db';
import type { ControlPlaneConnection } from '../control-plane-connection.service';
import { KYSELY_CENTRE } from '../inject-kysely';
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
    const selectFrom = vi.fn().mockImplementation(function (this: unknown) {
      return this;
    });
    const fakeDb = { selectFrom } as unknown as CentreDb;
    service.bindSharedKysely(fakeDb);
    const routedSelectFrom = service.routedKysely.selectFrom as unknown as (...args: unknown[]) => unknown;
    expect(typeof routedSelectFrom).toBe('function');
    expect(routedSelectFrom('bang_khach_hang')).toBe(fakeDb);
    expect(selectFrom).toHaveBeenCalledTimes(1);
    expect(selectFrom).toHaveBeenCalledWith('bang_khach_hang');
    expect(await service.routedKysely).toBe(service.routedKysely);
    expect((service.routedKysely as unknown as { then?: unknown }).then).toBeUndefined();
    expect((service.routedKysely as unknown as { constructor?: unknown }).constructor).toBe(Object);
    const handle = service.routedKysely as unknown as Record<string, unknown>;
    expect(handle.onModuleInit).toBeUndefined();
    expect(handle.onModuleDestroy).toBeUndefined();
    expect(handle.onApplicationBootstrap).toBeUndefined();
    expect(handle.beforeApplicationShutdown).toBeUndefined();
    expect(handle.onApplicationShutdown).toBeUndefined();
  });
});

describe('Nest biên dịch và đóng module dùng handle định tuyến khi chưa bind handle chung', () => {
  it('factory trả về handle định tuyến được await và module khởi tạo rồi đóng không ném lỗi khi chưa bind', async () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    const controlPlane = {} as unknown as ControlPlaneConnection;
    const service = new SpaceDatabaseService(config, controlPlane);
    const module = await Test.createTestingModule({
      providers: [{ provide: KYSELY_CENTRE, useFactory: () => service.routedKysely }],
    }).compile();
    try {
      await module.init();
      expect(module.get(KYSELY_CENTRE)).toBe(service.routedKysely);
      expect(await module.get(KYSELY_CENTRE)).toBe(service.routedKysely);
      await module.close();
    } finally {
      await service.onModuleDestroy();
    }
  });
});
