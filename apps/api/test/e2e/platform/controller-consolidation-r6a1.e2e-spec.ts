import { Logger, type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminToken, createTestApp, http } from '../../support/identity-access-helpers';




describe('Controller consolidation R6-A1 (issue #343) — hành vi alias', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });



  it('phục vụ alias exam-papers kèm header deprecation và log có cấu trúc trong khi route chuẩn không bị đánh dấu', async () => {
    const bankRes = await http(app).post('/api/v1/question-banks').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Ngân hàng đề trường R6-A1', scope: 'school', bankKind: 'exam' });
    expect(bankRes.status, JSON.stringify(bankRes.body)).toBeLessThan(300);
    const bankId = (bankRes.body as { id: string }).id;

    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const canonicalList = await http(app).get(`/api/v1/exams/banks/${bankId}/exams`).set('Authorization', `Bearer ${admin}`);
    expect(canonicalList.status).toBe(200);
    expect(canonicalList.headers['deprecation']).toBeUndefined();

    const aliasList = await http(app).get(`/api/v1/exam-papers/banks/${bankId}/exams`).set('Authorization', `Bearer ${admin}`);
    expect(aliasList.status).toBe(200);
    expect(aliasList.body).toEqual(canonicalList.body);
    expect(aliasList.headers['deprecation']).toBe('true');
    expect(aliasList.headers['sunset']).toContain('2027');

    const canonicalMine = await http(app).get('/api/v1/exams/dossiers/mine').set('Authorization', `Bearer ${admin}`);
    expect(canonicalMine.status).toBe(200);
    expect(canonicalMine.headers['deprecation']).toBeUndefined();

    const aliasMine = await http(app).get('/api/v1/exam-papers/dossiers/mine').set('Authorization', `Bearer ${admin}`);
    expect(aliasMine.status).toBe(200);
    expect(aliasMine.body).toEqual(canonicalMine.body);
    expect(aliasMine.headers['deprecation']).toBe('true');

    const aliasLogs = warn.mock.calls
      .map((call) => String(call[0]))
      .flatMap((message) => {
        try {
          return [JSON.parse(message) as Record<string, unknown>];
        } catch {
          return [];
        }
      })
      .filter((entry) => entry.event === 'deprecated_route_alias');
    expect(aliasLogs.some((entry) => entry.alias === 'exam-papers/banks/:bankId/exams' && entry.canonical === 'exams/banks/:bankId/exams')).toBe(true);
    expect(aliasLogs.some((entry) => entry.alias === 'exam-papers/dossiers/mine' && entry.canonical === 'exams/dossiers/mine')).toBe(true);
  });
});
