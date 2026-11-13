import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ContextsService } from '../access/contexts.service';
import type { PermissionEvaluator } from '../access/permission-evaluator.service';
import type { CoursesService } from '../courses/courses.service';
import type { IntegrationsRepository, ServiceRow, TokenOwnerState, TokenRow } from '@giaokhoa/db/repositories/integrations';
import { hashToken, IntegrationsService } from './integrations.service';


const RAW_TOKEN = 'unit-test-raw-token';
const OWNER_ID = '01900000-0000-7000-8000-0000000000aa';
const SERVICE_ID = '01900000-0000-7000-8000-0000000000bb';
const TOKEN_ID = '01900000-0000-7000-8000-0000000000cc';

function buildService() {
  let ownerState: TokenOwnerState | undefined = { suspended: false, deleted: false };
  const tokenRow = {
    id: TOKEN_ID,
    tokenHash: hashToken(RAW_TOKEN),
    userId: OWNER_ID,
    serviceId: SERVICE_ID,
    validUntil: null,
    ipRestriction: null,
    revoked: false,
    lastAccess: null,
    createdAt: new Date(),
  } as unknown as TokenRow;
  const serviceRow = {
    id: SERVICE_ID,
    name: 'Unit service',
    shortName: 'unit',
    enabled: true,
    functions: ['core_course_get_courses'],
  } as unknown as ServiceRow;
  const updateToken = vi.fn(async (_id: string, _patch: Record<string, unknown>) => {});
  const repo = {
    getTokenByHash: async () => tokenRow,
    getService: async () => serviceRow,
    updateToken,
    getTokenOwnerState: async () => ownerState,
  } as unknown as IntegrationsRepository;
  const evaluator = { hasCapability: async () => true } as unknown as PermissionEvaluator;
  const contexts = { ensureSystemContext: async () => ({ id: 'system-context' }) } as unknown as ContextsService;
  const listCourses = vi.fn(async () => [{ id: 'course-1' }]);
  const courses = { listCourses } as unknown as CoursesService;
  return {
    service: new IntegrationsService(repo, evaluator, contexts, courses),
    tokenRow,
    updateToken,
    listCourses,
    setOwnerState: (state: TokenOwnerState | undefined) => { ownerState = state; },
  };
}

const call = (service: IntegrationsService) =>
  service.callFunction({ token: RAW_TOKEN, functionName: 'core_course_get_courses', args: {} });

describe('IntegrationsService.callFunction — trạng thái tài khoản chủ token lúc gọi', () => {
  it('chủ token đang hoạt động vẫn gọi được hàm trong service như trước', async () => {
    const { service, listCourses } = buildService();
    await expect(call(service)).resolves.toEqual([{ id: 'course-1' }]);
    expect(listCourses).toHaveBeenCalledTimes(1);
  });

  it('chủ token bị đình chỉ bị từ chối với 401 và handler hàm không bao giờ chạy', async () => {
    const { service, listCourses, setOwnerState } = buildService();
    setOwnerState({ suspended: true, deleted: false });
    const err = await call(service).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: 'webservice.owner_inactive' });
    expect((err as UnauthorizedException).getStatus()).toBe(401);
    expect(listCourses).not.toHaveBeenCalled();
  });

  it('chủ token đã xoá bị từ chối với 401 và handler hàm không bao giờ chạy', async () => {
    const { service, listCourses, setOwnerState } = buildService();
    setOwnerState({ suspended: false, deleted: true });
    const err = await call(service).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: 'webservice.owner_inactive' });
    expect(listCourses).not.toHaveBeenCalled();
  });

  it('token mà dòng chủ đã không còn thì bị từ chối với 401', async () => {
    const { service, listCourses, setOwnerState } = buildService();
    setOwnerState(undefined);
    const err = await call(service).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: 'webservice.owner_inactive' });
    expect(listCourses).not.toHaveBeenCalled();
  });

  it('chủ đã khôi phục (hết đình chỉ) gọi lại được với cùng token — đình chỉ không bao giờ thu hồi token', async () => {
    const { service, tokenRow, updateToken, setOwnerState } = buildService();
    setOwnerState({ suspended: true, deleted: false });
    await expect(call(service)).rejects.toBeInstanceOf(UnauthorizedException);
    setOwnerState({ suspended: false, deleted: false });
    await expect(call(service)).resolves.toEqual([{ id: 'course-1' }]);
    expect(tokenRow.revoked).toBe(false);
    for (const [, patch] of updateToken.mock.calls) {
      expect(patch).not.toMatchObject({ revoked: true });
    }
  });
});
