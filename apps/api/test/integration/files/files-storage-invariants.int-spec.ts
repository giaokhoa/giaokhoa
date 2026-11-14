import type { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { FilesService } from '../../../src/modules/files/files.service';
import { FilesRepository } from '@giaokhoa/db/repositories/files';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../src/modules/files/storage';
import {
  adminToken, assignRole, createContextViaApi, createTestApp, createUserViaApi, http, login,
  roleIdByShortname, STRONG_PASSWORD, systemContextId,
} from '../../support/identity-access-helpers';

describe('Files: bất biến lưu trữ theo nội dung (integration)', () => {
  let app: INestApplication;
  let admin: string;
  let courseCtx: string;
  let uploaderToken: string;

  async function upload(token: string, fileName: string, content: string): Promise<{ id: string; contentHash: string }> {
    const res = await http(app).post('/api/v1/files').set('Authorization', `Bearer ${token}`)
      .field('contextId', String(courseCtx)).field('component', 'core_user').field('fileArea', 'profile')
      .attach('file', Buffer.from(content), fileName);
    if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    const systemId = await systemContextId(app, admin);
    courseCtx = (await createContextViaApi(app, admin, 50, uuidv7(), systemId)).id;
    const uploader = await createUserViaApi(app, admin);
    const studentRole = await roleIdByShortname(app, admin, 'student');
    await assignRole(app, admin, uploader.id, studentRole, courseCtx);
    uploaderToken = (await login(app, uploader.username, STRONG_PASSWORD)).accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('hai bản ghi cùng nội dung: refcount bằng 2 và đúng một file vật lý tại khoá nội dung', async () => {
    const content = `storage-invariant-dedup-${Date.now()}`;
    const a = await upload(uploaderToken, 'a.txt', content);
    const b = await upload(uploaderToken, 'b.txt', content);
    expect(a.contentHash).toBe(b.contentHash);
    const service = app.get(FilesService);
    expect(await service.refcount(a.contentHash)).toBe(2);
    expect(existsSync(service.physicalKey(a.contentHash))).toBe(true);
    expect(service.physicalKey(a.contentHash)).toContain(`/${a.contentHash.slice(0, 2)}/${a.contentHash.slice(2, 4)}/`);
  });

  it('upload B đã ghi object nhưng chưa lưu metadata: rollback A chờ B, giữ được byte và bản ghi B cùng hash', async () => {
    const service = app.get(FilesService);
    const repo = app.get(FilesRepository);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const payload = Buffer.from(`concurrent-content-${uuidv7()}`);
    const original = await service.upload({
      contextId: courseCtx, component: 'question', fileArea: 'question',
      fileName: 'first-fork.png', data: payload,
    });
    const secondName = `second-fork-${uuidv7()}.png`;
    let signalAfterPut!: () => void;
    let allowInsert!: () => void;
    const afterPut = new Promise<void>((resolve) => { signalAfterPut = resolve; });
    const insertPermit = new Promise<void>((resolve) => { allowInsert = resolve; });
    const insert = repo.insert.bind(repo);
    const spy = vi.spyOn(repo, 'insert').mockImplementation(async (values, db) => {
      if (values.fileName === secondName) {
        signalAfterPut();
        await insertPermit;
      }
      return insert(values, db);
    });
    let secondUpload: Promise<typeof original> | undefined;
    let rollback: Promise<void> | undefined;
    try {
      secondUpload = service.upload({
        contextId: courseCtx, component: 'question', fileArea: 'question',
        fileName: secondName, data: payload,
      });
      await afterPut;
      expect(await storage.exists(original.storageDomain, original.contentHash)).toBe(true);
      let cleanupFinished = false;
      rollback = service.discardUncommittedQuestionFile(original.id).then(() => {
        cleanupFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(cleanupFinished).toBe(false);
      allowInsert();
      const second = await secondUpload;
      await rollback;
      expect(await repo.getById(original.id)).toBeUndefined();
      expect((await repo.getById(second.id))?.contentHash).toBe(original.contentHash);
      expect(await service.refcount(original.contentHash)).toBe(1);
      expect(await storage.get(original.storageDomain, original.contentHash)).toEqual(payload);
    } finally {
      allowInsert();
      await Promise.allSettled([secondUpload, rollback].filter((value) => value !== undefined));
      spy.mockRestore();
    }
  });

  it('xoá hết bản ghi: file vật lý còn khi còn một bản ghi, cleanupOrphan gỡ file khi refcount về 0', async () => {
    const content = `storage-invariant-orphan-${Date.now()}`;
    const a = await upload(uploaderToken, 'c.txt', content);
    const b = await upload(uploaderToken, 'd.txt', content);
    const service = app.get(FilesService);
    const delA = await http(app).delete(`/api/v1/files/${a.id}`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(delA.status).toBe(200);
    expect(existsSync(service.physicalKey(a.contentHash))).toBe(true);
    const delB = await http(app).delete(`/api/v1/files/${b.id}`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(delB.status).toBe(200);
    const removed = await service.cleanupOrphan(a.contentHash);
    expect(removed).toBe(true);
    expect(existsSync(service.physicalKey(a.contentHash))).toBe(false);
  });
});
