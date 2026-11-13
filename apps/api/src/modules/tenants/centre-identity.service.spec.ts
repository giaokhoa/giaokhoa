import { describe, expect, it, vi } from 'vitest';
import type { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { CentreIdentityService } from './centre-identity.service';
import { tenantAls } from './tenant-als';
import type { CentreIdentityRepository } from '@giaokhoa/db/repositories/centre-identity';
import type { TenantsRepository } from '@giaokhoa/db/repositories/tenants';
import type { UsersService } from '../users/users.service';

/**
 * Ca đơn vị của service nhận diện trung tâm (issue #583): khung định tuyến, sổ tenant, kho nhận diện và service người dùng được thay bằng vật giả — các ca khoá đúng luật gắn trung tâm của service:
 * đọc nhận diện KHÔNG chạm control plane khi trung tâm đã chuẩn bị
 * (đường sống sau khi control plane ngừng hoạt động), và vẫn phân
 * giải + chuẩn bị trước khi đọc khi trung tâm chưa chuẩn bị (đọc thẳng khi chưa chuẩn bị sẽ rơi về kho chung — sai kho).
 */
function makeService(options?: { prepared?: boolean; shared?: boolean }) {
  const spaceDb = {
    isSpacePrepared: vi.fn(() => options?.prepared ?? false),
    resolveTarget: vi.fn(async () => ({ slug: 'trung-tam-a', spaceId: 'space-a', status: 'active', mode: options?.shared ? 'shared' : 'dedicated' })),
    getKyselyForSpace: vi.fn(async () => ({})),
    preparedSpaceScope: vi.fn(() => options?.shared ? {} : { spaceId: 'space-a', spaceHandle: {} }),
  };
  const tenants = {
    getTenantBySlug: vi.fn(
      async (): Promise<{ id: string; slug: string; name: string } | undefined> => ({
        id: 'tenant-a',
        slug: 'trung-tam-a',
        name: 'Trung tâm A',
      }),
    ),
  };
  const centreRepo = {
    getIdentity: vi.fn(async () => ({ displayName: 'Trung tâm A — tên riêng', logoPath: null, brandColor: '#1d4ed8' })),
    listSiteAdmins: vi.fn(async () => ['admin-a']),
    upsertIdentity: vi.fn(async () => ({ displayName: 'Shared đã đổi', logoPath: null, brandColor: '#1d4ed8' })),
  };
  const users = { updateUser: vi.fn(async () => ({})) };
  const service = new CentreIdentityService(
    spaceDb as unknown as SpaceDatabaseService,
    tenants as unknown as TenantsRepository,
    centreRepo as unknown as CentreIdentityRepository,
    users as unknown as UsersService,
  );
  return { service, spaceDb, tenants, centreRepo };
}

describe('Service nhận diện trung tâm', () => {
  it('trung tâm đã chuẩn bị thì đọc nhận diện mà không phân giải hay chuẩn bị lại', async () => {
    const { service, spaceDb, tenants } = makeService({ prepared: true });
    const identity = await service.getIdentity('trung-tam-a');
    expect(identity).toMatchObject({ displayName: 'Trung tâm A — tên riêng', brandColor: '#1d4ed8' });
    expect(spaceDb.resolveTarget).not.toHaveBeenCalled();
    expect(spaceDb.getKyselyForSpace).not.toHaveBeenCalled();
    expect(spaceDb.preparedSpaceScope).toHaveBeenCalledWith('trung-tam-a');
    expect(tenants.getTenantBySlug).toHaveBeenCalledWith('trung-tam-a');
  });

  it('trung tâm chưa chuẩn bị thì phân giải và chuẩn bị kho trước khi đọc nhận diện', async () => {
    const { service, spaceDb } = makeService({ prepared: false });
    const identity = await service.getIdentity('trung-tam-a');
    expect(identity).toMatchObject({ displayName: 'Trung tâm A — tên riêng' });
    expect(spaceDb.resolveTarget).toHaveBeenCalledWith('trung-tam-a');
    expect(spaceDb.getKyselyForSpace).toHaveBeenCalledWith('trung-tam-a');
  });

  it('trung tâm shared đã chuẩn bị: nhận diện vẫn trả thành công, không cần identity của kho dedicated', async () => {
    const { service, spaceDb, tenants } = makeService({ prepared: true, shared: true });
    const stores: Array<{ slug?: string; spaceId?: string; spaceHandle?: object }> = [];
    tenants.getTenantBySlug.mockImplementation(async () => {
      const store = tenantAls.getStore();
      stores.push({ slug: store?.spaceSlug, spaceId: store?.spaceId, spaceHandle: store?.spaceHandle });
      return { id: 'tenant-a', slug: 'trung-tam-a', name: 'Trung tâm A' };
    });
    const identity = await service.getIdentity('trung-tam-a');
    expect(identity).toMatchObject({ displayName: 'Trung tâm A — tên riêng' });
    expect(stores).toEqual([{ slug: 'trung-tam-a', spaceId: undefined, spaceHandle: undefined }]);
    expect(spaceDb.resolveTarget).not.toHaveBeenCalled();
    expect(spaceDb.preparedSpaceScope).toHaveBeenCalledWith('trung-tam-a');
  });

  it('đổi nhận diện trung tâm shared cũng chạy đúng đường shared, không yêu cầu spaceId dedicated', async () => {
    const { service, spaceDb, centreRepo } = makeService({ prepared: true, shared: true });
    const changed = await service.updateIdentity('trung-tam-a', 'admin-a', { displayName: 'Shared đã đổi' });
    expect(changed).toMatchObject({ tenantId: 'tenant-a', displayName: 'Shared đã đổi' });
    expect(spaceDb.preparedSpaceScope).toHaveBeenCalledWith('trung-tam-a', expect.any(Object));
    expect(centreRepo.upsertIdentity).toHaveBeenCalledWith('tenant-a', { displayName: 'Shared đã đổi' });
  });

  it('trung tâm đã chuẩn bị nhưng không có dòng tenant trong kho của nó thì trả 404', async () => {
    const { service, tenants } = makeService({ prepared: true });
    tenants.getTenantBySlug.mockResolvedValueOnce(undefined);
    await expect(service.getIdentity('trung-tam-a')).rejects.toThrow('Centre not found');
  });
});
