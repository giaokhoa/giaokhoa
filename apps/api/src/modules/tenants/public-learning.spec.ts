import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPublicLearningHost, PUBLIC_LEARNING_SLUG } from './public-learning';
import { resolveDedicatedSpace, spaceSlugForHost } from './space-resolution';
import type { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { validateEnv } from '../../config/env';

const ROOT = 'giaokhoa.vn';

describe('Khu công cộng — địa chỉ và ranh giới kho', () => {
  beforeEach(() => {
    vi.stubEnv('PUBLIC_LEARNING_ENABLED', 'true');
    vi.stubEnv('BETTER_AUTH_URL', `https://${ROOT}`);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('chỉ hostname gốc đã khai báo được định tuyến vào kho cong-cong', () => {
    expect(isPublicLearningHost(ROOT)).toBe(true);
    expect(isPublicLearningHost('GIAOKHOA.VN:443')).toBe(true);
    expect(spaceSlugForHost(`${ROOT}:443`)).toBe(PUBLIC_LEARNING_SLUG);
    expect(spaceSlugForHost('trung-tam-a.giaokhoa.vn')).toBe('trung-tam-a');
    expect(isPublicLearningHost('other.giaokhoa.vn')).toBe(false);
    expect(isPublicLearningHost('giaokhoa.vn.evil.com')).toBe(false);
    expect(isPublicLearningHost('giaokhoa.vn,host.evil.com')).toBe(false);
    expect(isPublicLearningHost('giaokhoa.vn/private')).toBe(false);
    expect(isPublicLearningHost('evil@giaokhoa.vn')).toBe(false);
    expect(isPublicLearningHost('giaokhoa.vn?redirect=evil.com')).toBe(false);
    expect(isPublicLearningHost('giaokhoa.vn#fragment')).toBe(false);
  });

  it('cờ tắt giữ cách định tuyến cũ, host gốc không lấy kho riêng', () => {
    vi.stubEnv('PUBLIC_LEARNING_ENABLED', 'false');
    expect(spaceSlugForHost(ROOT)).toBeNull();
  });

  it('public host không được rơi về kho chung khi sổ ghi shared', async () => {
    const db = { resolveTarget: vi.fn(async () => ({
      mode: 'shared', slug: PUBLIC_LEARNING_SLUG, status: 'active', spaceId: 'public-id',
    })) } as unknown as SpaceDatabaseService;
    await expect(resolveDedicatedSpace(db, ROOT)).rejects.toThrow('public_learning.dedicated_required');
  });

  it('public host chỉ chấp nhận đích dedicated có ID từ sổ', async () => {
    const db = { resolveTarget: vi.fn(async () => ({
      mode: 'dedicated', slug: PUBLIC_LEARNING_SLUG, status: 'active', spaceId: 'public-id',
    })) } as unknown as SpaceDatabaseService;
    await expect(resolveDedicatedSpace(db, ROOT)).resolves.toEqual({ slug: PUBLIC_LEARNING_SLUG, spaceId: 'public-id' });
  });

  it('thiếu secret/kho thì cấu hình bật public bị chặn trước khi boot', () => {
    const base = {
      DATABASE_URL: 'postgres://test',
      REDIS_URL: 'redis://localhost',
      JWT_SECRET: '0123456789abcdef0123456789abcdef',
      PUBLIC_LEARNING_ENABLED: 'true',
      BETTER_AUTH_ENABLED: 'true',
      BETTER_AUTH_URL: `https://${ROOT}`,
      BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
      CONTROL_PLANE_DATABASE_URL: 'postgres://control-plane',
    };
    expect(() => validateEnv(base)).toThrow('SPACE_CONG_CONG_DATABASE_URL');
    expect(validateEnv({ ...base, PUBLIC_LEARNING_ENABLED: 'false' }).PUBLIC_LEARNING_ENABLED).toBe(false);
    expect(validateEnv({ ...base, SPACE_CONG_CONG_DATABASE_URL: 'postgres://public' }).PUBLIC_LEARNING_ENABLED).toBe(true);
  });
});
