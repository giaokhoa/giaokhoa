import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileDomainForSpace, LEGACY_FILE_DOMAIN, SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import { FilesRepository } from '@giaokhoa/db/repositories/files';
import { FilesService } from '../../../src/modules/files/files.service';
import { OBJECT_STORAGE, sha256Hex, type ObjectStorage } from '../../../src/modules/files/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  adminToken, assignRole, createContextViaApi, createTestApp, createUserViaApi, http, login,
  roleIdByShortname, STRONG_PASSWORD, systemContextId,
} from '../../support/identity-access-helpers';

describe('File: khử trùng theo địa chỉ nội dung, dọn refcount, phục vụ kiểm tra năng lực', () => {
  let app: INestApplication;
  let admin: string;
  let courseCtx: string;
  let uploaderToken: string;
  let uploaderId: string;
  const CONTENT = `hello-dedup-content-${Date.now()}`;

  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const PDF_BYTES = Buffer.from('%PDF-1.4\n%noi-dung-pdf-gia\n');
  const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);

  async function upload(token: string, fileName: string, content: string): Promise<{ id: string; contentHash: string }> {
    const res = await http(app).post('/api/v1/files').set('Authorization', `Bearer ${token}`)
      .field('contextId', String(courseCtx)).field('component', 'core_user').field('fileArea', 'profile')
      .attach('file', Buffer.from(content), fileName);
    if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function uploadBytes(token: string, fileName: string, buffer: Buffer): Promise<{ id: string; contentHash: string }> {
    const res = await http(app).post('/api/v1/files').set('Authorization', `Bearer ${token}`)
      .field('contextId', String(courseCtx)).field('component', 'core_user').field('fileArea', 'profile')
      .attach('file', buffer, fileName);
    if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function uploadExpecting(token: string, fileName: string, buffer: Buffer, status: number): Promise<{ status: number; headers: Record<string, string | undefined>; body: { code?: string } }> {
    const res = await http(app).post('/api/v1/files').set('Authorization', `Bearer ${token}`)
      .field('contextId', String(courseCtx)).field('component', 'core_user').field('fileArea', 'profile')
      .attach('file', buffer, fileName);
    expect(res.status).toBe(status);
    return res;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    const systemId = await systemContextId(app, admin);
    courseCtx = (await createContextViaApi(app, admin, 50, uuidv7(), systemId)).id;
    const uploader = await createUserViaApi(app, admin);
    uploaderId = uploader.id;
    const studentRole = await roleIdByShortname(app, admin, 'student');
    await assignRole(app, admin, uploader.id, studentRole, courseCtx);
    uploaderToken = (await login(app, uploader.username, STRONG_PASSWORD)).accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('tải nội dung trùng hai lần tạo hai bản ghi dùng chung một hàm băm nội dung', async () => {
    const a = await upload(uploaderToken, 'a.txt', CONTENT);
    const b = await upload(uploaderToken, 'b.txt', CONTENT);
    expect(a.id).not.toBe(b.id);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toHaveLength(64);
  });

  it('xoá bản ghi báo refcount chung trong đáp ứng: 1 sau lần xoá đầu, 0 sau lần xoá cuối', async () => {
    const a = await upload(uploaderToken, 'c.txt', `${CONTENT}-v2`);
    const b = await upload(uploaderToken, 'd.txt', `${CONTENT}-v2`);
    const delA = await http(app).delete(`/api/v1/files/${a.id}`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(delA.status).toBe(200);
    expect(delA.body.refcount).toBe(1);
    const delB = await http(app).delete(`/api/v1/files/${b.id}`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(delB.body.refcount).toBe(0);
  });

  it('hai đợt upload/xóa cùng hash sinh hai job cleanup độc lập, không bị BullMQ nuốt vì completed retention', async () => {
    const content = 'hai-vong-xoa-10-' + Date.now();
    const queue = app.get<Queue>(getQueueToken('file-cleanup'));
    const first = await upload(uploaderToken, 'lap-mot.txt', content);
    expect((await http(app).delete('/api/v1/files/' + first.id)
      .set('Authorization', 'Bearer ' + uploaderToken)).status).toBe(200);
    const firstId = ['orphan', SYSTEM_FILE_DOMAIN, first.contentHash, first.id].join('-');
    expect(await queue.getJob(firstId)).toBeDefined();

    const second = await upload(uploaderToken, 'lap-hai.txt', content);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.id).not.toBe(first.id);
    expect((await http(app).delete('/api/v1/files/' + second.id)
      .set('Authorization', 'Bearer ' + uploaderToken)).status).toBe(200);
    const secondId = ['orphan', SYSTEM_FILE_DOMAIN, second.contentHash, second.id].join('-');
    expect(secondId).not.toBe(firstId);
    expect(await queue.getJob(secondId)).toBeDefined();
  });

  it('HTTP Trang chính đọc file legacy theo metadata/context hợp lệ, vẫn không dọn byte legacy', async () => {
    const payload = Buffer.from('legacy-trang-chinh-10-' + Date.now());
    const hash = sha256Hex(payload);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const repo = app.get(FilesRepository);
    const path = storage.keyFor(LEGACY_FILE_DOMAIN, hash);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, payload);
    const legacy = await repo.insert({
      contentHash: hash, storageDomain: LEGACY_FILE_DOMAIN,
      contextId: courseCtx, component: 'core_user', fileArea: 'profile',
      fileName: 'legacy.txt', fileSize: payload.length, mimeType: 'text/plain', userId: uploaderId,
    });
    const auth = { Authorization: 'Bearer ' + uploaderToken };
    try {
      const meta = await http(app).get('/api/v1/files/' + legacy.id).set(auth);
      expect(meta.status).toBe(200);
      const signed = await http(app).post('/api/v1/files/' + legacy.id + '/signed-url').set(auth);
      expect(signed.status).toBe(201);
      const download = await http(app).get(signed.body.url);
      expect(download.status).toBe(200);
      expect(download.text).toBe(payload.toString());
      expect((await http(app).delete('/api/v1/files/' + legacy.id).set(auth)).status).toBe(200);
      expect(await storage.exists(LEGACY_FILE_DOMAIN, hash)).toBe(true);
    } finally {
      await repo.deleteById(legacy.id);
      await rm(path, { force: true });
    }
  });

  it('phục vụ nội dung cho người có năng lực ngữ cảnh file qua URL đã ký và luồng có rào', async () => {
    const file = await upload(uploaderToken, 'serve.txt', 'serve-me');
    const signed = await http(app).post(`/api/v1/files/${file.id}/signed-url`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(signed.status).toBe(201);
    const download = await http(app).get(signed.body.url.replace('/api/v1', '/api/v1'));
    expect(download.status).toBe(200);
    expect(download.text).toBe('serve-me');
    const stream = await http(app).get(`/api/v1/files/${file.id}/content`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(stream.status).toBe(200);
    expect(stream.text).toBe('serve-me');
  });

  it('HTTP không cho thay id/chữ ký để đọc file cùng hash của miền B; cleanup miền hệ thống giữ byte B', async () => {
    const text = 'noi-dung-trung-mien-10-' + Date.now();
    const payload = Buffer.from(text);
    const hash = sha256Hex(payload);
    const spaceB = fileDomainForSpace('22222222-2222-7222-8222-222222222222');
    const fileA = await upload(uploaderToken, 'bank-a.txt', text);
    const repo = app.get(FilesRepository);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const service = app.get(FilesService);
    await storage.put(spaceB, hash, payload);
    const fileB = await repo.insert({
      contentHash: hash, storageDomain: spaceB,
      contextId: courseCtx, component: 'core_user', fileArea: 'profile',
      fileName: 'space-b.txt', fileSize: payload.length, mimeType: 'text/plain',
      userId: uploaderId,
    });
    const auth = { Authorization: 'Bearer ' + uploaderToken };
    try {
      const aSigned = await http(app).post('/api/v1/files/' + fileA.id + '/signed-url').set(auth);
      expect(aSigned.status).toBe(201);
      const signedAUrl = aSigned.body.url as string;
      expect((await http(app).get(signedAUrl)).text).toBe(text);

      const bMeta = await http(app).get('/api/v1/files/' + fileB.id).set(auth);
      expect(bMeta.status).toBe(404);
      const bSigned = await http(app).post('/api/v1/files/' + fileB.id + '/signed-url').set(auth);
      expect(bSigned.status).toBe(404);
      const bStream = await http(app).get('/api/v1/files/' + fileB.id + '/content').set(auth);
      expect(bStream.status).toBe(404);
      const forgedUrl = signedAUrl.replace(fileA.id, fileB.id);
      expect((await http(app).get(forgedUrl)).status).toBe(404);

      expect((await http(app).delete('/api/v1/files/' + fileA.id).set(auth)).status).toBe(200);
      expect(await service.cleanupOrphan(hash, SYSTEM_FILE_DOMAIN)).toBe(true);
      expect(await storage.exists(SYSTEM_FILE_DOMAIN, hash)).toBe(false);
      expect(await storage.exists(spaceB, hash)).toBe(true);
      expect((await storage.get(spaceB, hash)).equals(payload)).toBe(true);
    } finally {
      await repo.deleteById(fileB.id);
      await storage.delete(spaceB, hash);
    }
  });

  it('tải lên thiếu part file trả 400 ProblemDetails thay vì 500', async () => {
    const res = await http(app).post('/api/v1/files').set('Authorization', `Bearer ${uploaderToken}`)
      .field('contextId', String(courseCtx)).field('component', 'core_user').field('fileArea', 'profile');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.status).toBe(400);
    expect(res.body.code).toBe('file.file_required');
  });

  it('tải ảnh câu hỏi thiếu part file trả 400 ProblemDetails thay vì 500', async () => {
    const res = await http(app).post('/api/v1/files/question-image').set('Authorization', `Bearer ${uploaderToken}`)
      .field('contextId', String(courseCtx)).field('fileArea', 'questiontext');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.status).toBe(400);
    expect(res.body.code).toBe('file.file_required');
  });

  it('tải file chung có đuôi .png nhưng byte là chữ trả 400 file.type_mismatch', async () => {
    const res = await uploadExpecting(uploaderToken, 'gia.png', Buffer.from('day la chu, khong phai anh'), 400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('file.type_mismatch');
  });

  it('tải file .exe đổi tên .png trả 400 file.type_mismatch', async () => {
    const res = await uploadExpecting(uploaderToken, 'gia.png', EXE_BYTES, 400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('file.type_mismatch');
  });

  it('tải file .pdf chứa byte PNG trả 400 file.type_mismatch', async () => {
    const res = await uploadExpecting(uploaderToken, 'gia.pdf', PNG_BYTES, 400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('file.type_mismatch');
  });

  it('tải file PNG và PDF thật qua route chung trả 201 và lưu đúng mime đã sniff', async () => {
    const png = await uploadBytes(uploaderToken, 'that.png', PNG_BYTES);
    const pngMeta = await http(app).get(`/api/v1/files/${png.id}`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(pngMeta.status).toBe(200);
    expect(pngMeta.body.mimeType).toBe('image/png');
    const pdf = await uploadBytes(uploaderToken, 'that.pdf', PDF_BYTES);
    const pdfMeta = await http(app).get(`/api/v1/files/${pdf.id}`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(pdfMeta.status).toBe(200);
    expect(pdfMeta.body.mimeType).toBe('application/pdf');
  });

  it('nội dung file text/html phục vụ dạng attachment kèm CSP sandbox thay vì inline', async () => {
    const file = await upload(uploaderToken, 'evil.html', '<script>alert(1)</script>');
    const stream = await http(app).get(`/api/v1/files/${file.id}/content`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toContain('text/html');
    expect(stream.headers['content-disposition']).toContain('attachment');
    expect(stream.headers['content-security-policy']).toContain('sandbox');
    expect(stream.text).toBe('<script>alert(1)</script>');
  });

  it('ảnh PNG hợp lệ phục vụ inline qua /content, không ép attachment', async () => {
    const file = await uploadBytes(uploaderToken, 'xem.png', PNG_BYTES);
    const stream = await http(app).get(`/api/v1/files/${file.id}/content`).set('Authorization', `Bearer ${uploaderToken}`);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toContain('image/png');
    expect(stream.headers['content-disposition']).toBeUndefined();
  });

  it('tải file chung vượt trần 25 MB trả 413 ProblemDetails với title Payload Too Large', async () => {
    const res = await http(app).post('/api/v1/files').set('Authorization', `Bearer ${uploaderToken}`)
      .field('contextId', String(courseCtx)).field('component', 'core_user').field('fileArea', 'profile')
      .attach('file', Buffer.alloc(25 * 1024 * 1024 + 1), 'qua-lon.bin');
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ title: 'Payload Too Large', status: 413, code: 'http.payload_too_large' });
  });

  it('tải ảnh câu hỏi vượt trần 8 MB trả 413 ProblemDetails thay vì 400 của service', async () => {
    const res = await http(app).post('/api/v1/files/question-image').set('Authorization', `Bearer ${uploaderToken}`)
      .field('contextId', String(courseCtx)).field('fileArea', 'questiontext')
      .attach('file', Buffer.alloc(8 * 1024 * 1024 + 1), 'qua-lon.png');
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ title: 'Payload Too Large', status: 413, code: 'http.payload_too_large' });
  });

  it('từ chối người lạ: request URL đã ký và luồng có rào trả 403 Problem Details; tải không ký trả 401', async () => {
    const file = await upload(uploaderToken, 'secret.txt', 'top-secret');
    const stranger = await createUserViaApi(app, admin);
    const strangerToken = (await login(app, stranger.username, STRONG_PASSWORD)).accessToken;
    const signed = await http(app).post(`/api/v1/files/${file.id}/signed-url`).set('Authorization', `Bearer ${strangerToken}`);
    expect(signed.status).toBe(403);
    expect(signed.headers['content-type']).toContain('application/problem+json');
    expect(signed.body.code).toBe('access.capability_denied');
    const stream = await http(app).get(`/api/v1/files/${file.id}/content`).set('Authorization', `Bearer ${strangerToken}`);
    expect(stream.status).toBe(403);
    const unsigned = await http(app).get(`/api/v1/files/${file.id}/download`);
    expect(unsigned.status).toBe(401);
    const tampered = await http(app).get(`/api/v1/files/${file.id}/download`).query({ sig: '9999999999.forged' });
    expect(tampered.status).toBe(401);
    void uploaderId;
  });
});
