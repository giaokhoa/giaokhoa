import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionEvaluator } from '../../../src/modules/access/permission-evaluator.service';
import { UsersService } from '../../../src/modules/users/users.service';
import {
  adminToken, createTestApp, systemContextId,
} from '../../support/identity-access-helpers';

describe('Access: tài khoản khách chỉ được đánh giá qua vai khách (integration)', () => {
  let app: INestApplication;
  let systemId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await adminToken(app);
    systemId = await systemContextId(app, admin);
  });
  afterAll(async () => { await app.close(); });

  it('tài khoản khách chỉ được đánh giá qua vai trò khách', async () => {
    const users = app.get(UsersService);
    const evaluator = app.get(PermissionEvaluator);
    const guest = await users.ensureGuestUser();
    expect(await evaluator.hasCapability(guest.id, 'course:view', systemId, { isGuest: true })).toBe(true);
    expect(await evaluator.hasCapability(guest.id, 'user:viewdetails', systemId, { isGuest: true })).toBe(false);
  });
});
