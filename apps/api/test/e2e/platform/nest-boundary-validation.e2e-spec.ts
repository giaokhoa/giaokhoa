import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, createTestApp, http } from '../../support/identity-access-helpers';

/**
 * Hồi quy biên HTTP cho tham số GET: schema Zod từ chối dữ liệu sai
 * trước khi service tạo Date hoặc chọn sai loại ngân hàng; dữ liệu hợp
 * lệ và giá trị mặc định cũ vẫn sử dụng được khi người dùng đăng nhập.
 */
describe('Kiểm chứng query của lịch và ngân hàng câu hỏi theo Nest Standard Schema', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await adminToken(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('ngày lọc lịch sai định dạng và eventType ngoài registry trả 400 thay vì đẩy xuống database', async () => {
    const badDate = await http(app).get('/api/v1/calendar/events')
      .query({ from: 'not-a-date' }).set('Authorization', `Bearer ${token}`);
    expect(badDate.status).toBe(400);
    expect(badDate.body.status).toBe(400);

    const badType = await http(app).get('/api/v1/calendar/events')
      .query({ eventType: 'unknown' }).set('Authorization', `Bearer ${token}`);
    expect(badType.status).toBe(400);

    const badExportDate = await http(app).get('/api/v1/calendar/exports')
      .query({ to: '2026-13-99' }).set('Authorization', `Bearer ${token}`);
    expect(badExportDate.status).toBe(400);
  });

  it('lọc lịch hợp lệ bằng ngày ISO và ISO datetime vẫn trả danh sách', async () => {
    const valid = await http(app).get('/api/v1/calendar/events')
      .query({ from: '2026-11-01', to: '2026-11-30T23:59:59Z', eventType: 'user' })
      .set('Authorization', `Bearer ${token}`);
    expect(valid.status).toBe(200);
    expect(Array.isArray(valid.body)).toBe(true);
  });

  it('loại bank không hợp lệ trả 400, loại hợp lệ và không truyền loại giữ nguyên hành vi', async () => {
    const bad = await http(app).get('/api/v1/question-banks')
      .query({ kind: 'garbage' }).set('Authorization', `Bearer ${token}`);
    expect(bad.status).toBe(400);

    const valid = await http(app).get('/api/v1/question-banks')
      .query({ kind: 'question' }).set('Authorization', `Bearer ${token}`);
    const fallback = await http(app).get('/api/v1/question-banks')
      .set('Authorization', `Bearer ${token}`);
    expect(valid.status).toBe(200);
    expect(fallback.status).toBe(200);
    expect(fallback.body).toEqual(valid.body);
  });
});
