import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassesService } from '@giaokhoa/application/classes/service';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClassesController } from './classes.controller.js';

const classId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const studentId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';

describe('ClassesController HTTP contract', () => {
  let app: INestApplication;
  const service = {
    approveMember: vi.fn(async () => ({
      userId: studentId,
      status: 'active',
      joinedAt: new Date(),
      updatedAt: new Date(),
    })),
    suspendMember: vi.fn(async () => ({
      userId: studentId,
      status: 'suspended',
      joinedAt: new Date(),
      updatedAt: new Date(),
    })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ClassesController],
      providers: [{ provide: ClassesService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: { session?: unknown }, _res: unknown, next: () => void) => {
      req.session = { user: { id: classId } };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns HTTP 200 after approving or suspending a member', async () => {
    const http = app.getHttpServer() as App;
    const approved = await request(http)
      .post(`/classes/${classId}/members/${studentId}/approve`)
      .expect(200);
    expect(approved.body.status).toBe('active');
    const suspended = await request(http)
      .post(`/classes/${classId}/members/${studentId}/suspend`)
      .expect(200);
    expect(suspended.body.status).toBe('suspended');
    expect(service.approveMember).toHaveBeenCalledWith(classId, classId, studentId);
    expect(service.suspendMember).toHaveBeenCalledWith(classId, classId, studentId);
  });
});
