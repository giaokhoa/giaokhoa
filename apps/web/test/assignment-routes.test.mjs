import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createServer as createViteServer } from 'vite';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';

void test('tạo, sửa bản nháp, công bố, thu hồi và bắt đầu làm qua đúng API', async () => {
  const id = '01900000-0000-7000-8000-000000000001';
  const classId = '01900000-0000-7000-8000-000000000002';
  const examRevisionId = '01900000-0000-7000-8000-000000000003';
  const userId = '01900000-0000-7000-8000-000000000004';
  const attemptId = '01900000-0000-7000-8000-000000000005';
  const openAt = '2026-10-21T01:00:00.000Z';
  const closeAt = '2026-10-22T01:00:00.000Z';
  const calls = [];
  let assignment = {
    id,
    classId,
    examRevisionId,
    createdByUserId: userId,
    audienceMode: 'ALL_CLASS',
    selectedUserIds: [],
    status: 'draft',
    openAt,
    closeAt,
    maxAttempts: 1,
    releaseScoreAt: null,
    releaseFeedbackAt: null,
    releaseSolutionsAt: null,
    createdAt: openAt,
    publishedAt: null,
  };
  let recipients = [];
  let startStatus = 201;
  let sessionStatus = 200;
  let invalidDelivery = false;
  let leakedSolution = false;
  const content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nêu kết quả.' }] }],
  };
  const api = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ path: request.url, method: request.method, body, cookie: request.headers.cookie });
    response.setHeader('content-type', 'application/json');
    const send = (status, value) => {
      response.statusCode = status;
      response.end(JSON.stringify(value));
    };
    if (request.url === '/api/auth/get-session') {
      return send(sessionStatus, {
        user: { id: userId, name: 'Giáo viên', email: 'test@example.test' },
        session: { id: 'phiên' },
      });
    }
    if (request.url === '/assignments' && request.method === 'POST') {
      const parsed = assignmentsContract.create.body.safeParse(body);
      if (!parsed.success) return send(400, { message: 'Cấu hình không hợp lệ.' });
      assignment = { ...assignment, ...parsed.data };
      return send(201, assignment);
    }
    if (request.url === `/assignments/${id}`) {
      if (request.method === 'PATCH')
        assignment = { ...assignment, ...assignmentsContract.update.body.parse(body) };
      return send(200, assignment);
    }
    if (request.url === `/assignments/${id}/publish`) {
      assignment = { ...assignment, status: 'published', publishedAt: openAt };
      recipients = [
        { userId, status: 'active', source: 'all_class', assignedAt: openAt, revokedAt: null },
      ];
      return send(200, assignment);
    }
    if (request.url === `/assignments/${id}/recipients`) return send(200, recipients);
    if (request.url === `/assignments/${id}/recipients/${userId}/revoke`) {
      recipients[0] = { ...recipients[0], status: 'revoked', revokedAt: closeAt };
      return send(204);
    }
    if (request.url === `/assignments/${id}/delivery`)
      return send(200, {
        assignmentId: id,
        examRevisionId,
        title: 'Đề kiểm tra',
        openAt: invalidDelivery ? null : openAt,
        closeAt,
        maxAttempts: 2,
        questions: [
          {
            position: 1,
            question: {
              id: userId,
              version: 1,
              type: 'short_answer',
              content: leakedSolution ? { ...content, solution: 'bí mật' } : content,
              stimulus: null,
            },
          },
        ],
      });
    if (request.url === `/assignments/${id}/attempts` && request.method === 'POST') {
      if (startStatus !== 201) return send(startStatus, { message: 'Đã hết lượt làm bài.' });
      return send(201, {
        id: attemptId,
        assignmentId: id,
        userId,
        attemptNumber: 1,
        status: 'in_progress',
        startedAt: openAt,
        submittedAt: null,
        gradedAt: null,
        responses: [
          { position: 1, answer: { type: 'short_answer', answer: '1' }, updatedAt: openAt },
        ],
      });
    }
    return send(404, { message: 'Điểm truy cập không tồn tại.' });
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const vite = await createViteServer({
    root: resolve(import.meta.dirname, '..'),
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: {
      alias: {
        '#features': resolve(import.meta.dirname, '../app/features'),
        '#lib': resolve(import.meta.dirname, '../app/lib'),
      },
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(`http://127.0.0.1:${api.address().port}`),
    },
    ssr: { noExternal: ['@giaokhoa/ui', '@giaokhoa/editor'] },
  });
  function args(path, fields) {
    const form = fields ? new URLSearchParams(fields) : undefined;
    return {
      params: { id },
      request: new Request(`http://web.example.test${path}`, {
        method: fields ? 'POST' : 'GET',
        headers: { cookie: 'session=thu-nghiem' },
        body: form,
      }),
    };
  }
  const fields = {
    classId,
    examRevisionId,
    audienceMode: 'ALL_CLASS',
    selectedUserIds: '',
    openAt,
    closeAt,
    maxAttempts: '1',
  };
  try {
    const newRoute = await vite.ssrLoadModule('/app/routes/assignments/new.tsx');
    const detailRoute = await vite.ssrLoadModule('/app/routes/assignments/detail.tsx');
    const deliveryRoute = await vite.ssrLoadModule('/app/routes/assignments/delivery.tsx');

    assert.deepEqual(
      await newRoute.loader(
        args(`/assignments/new?classId=${classId}&examRevisionId=${examRevisionId}`),
      ),
      { classId, examRevisionId },
    );
    const invalidCreate = await newRoute.action(
      args('/assignments/new', { ...fields, closeAt: openAt }),
    );
    assert.equal(invalidCreate.init.status, 400);
    assert.equal(calls.filter((call) => call.path === '/assignments').length, 0);
    const created = await newRoute.action(args('/assignments/new', fields));
    assert.equal(created.status, 302);
    assert.equal(created.headers.get('location'), `/assignments/${id}`);

    const loadedDraft = await detailRoute.loader(args(`/assignments/${id}`));
    assert.equal(loadedDraft.assignment.openAt.toISOString(), openAt);
    assert.deepEqual(loadedDraft.recipients, []);
    const invalidUpdate = await detailRoute.action(
      args(`/assignments/${id}`, { ...fields, intent: 'update', closeAt: openAt }),
    );
    assert.equal(invalidUpdate.init.status, 400);
    assert.equal(
      calls.some((call) => call.method === 'PATCH'),
      false,
    );
    const updated = await detailRoute.action(
      args(`/assignments/${id}`, {
        ...fields,
        intent: 'update',
        classId: 'giả mạo',
        maxAttempts: '2',
      }),
    );
    assert.match(updated.data.success, /Đã lưu/);
    const patch = calls.find((call) => call.method === 'PATCH').body;
    assert.equal(patch.maxAttempts, 2);
    assert.equal('classId' in patch, false);
    assert.equal('examRevisionId' in patch, false);

    const published = await detailRoute.action(args(`/assignments/${id}`, { intent: 'publish' }));
    assert.match(published.data.success, /Đã công bố/);
    const loadedPublished = await detailRoute.loader(args(`/assignments/${id}`));
    assert.equal(loadedPublished.recipients[0].assignedAt.toISOString(), openAt);
    assert.equal(loadedPublished.recipients[0].revokedAt, null);
    const forbiddenUpdate = await detailRoute.action(
      args(`/assignments/${id}`, { ...fields, intent: 'update' }),
    );
    assert.equal(forbiddenUpdate.init.status, 409);
    assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
    const revoked = await detailRoute.action(
      args(`/assignments/${id}`, { intent: 'revoke', userId }),
    );
    assert.match(revoked.data.success, /Đã thu hồi/);
    const loadedRevoked = await detailRoute.loader(args(`/assignments/${id}`));
    assert.equal(loadedRevoked.recipients[0].status, 'revoked');
    assert.equal(loadedRevoked.recipients[0].revokedAt.toISOString(), closeAt);

    const delivered = await deliveryRoute.loader(args(`/assignments/${id}/delivery`));
    assert.equal(delivered.assignment.openAt.toISOString(), openAt);
    assert.deepEqual(delivered.assignment.questions[0].question.content, content);
    const started = await deliveryRoute.action(
      args(`/assignments/${id}/delivery`, { intent: 'start' }),
    );
    assert.equal(started.status, 302);
    assert.equal(started.headers.get('location'), `/attempts/${attemptId}`);
    startStatus = 409;
    const exhausted = await deliveryRoute.action(
      args(`/assignments/${id}/delivery`, { intent: 'start' }),
    );
    assert.equal(exhausted.init.status, 409);
    assert.equal(exhausted.data.error, 'Đã hết lượt làm bài.');
    invalidDelivery = true;
    await assert.rejects(
      deliveryRoute.loader(args(`/assignments/${id}/delivery`)),
      (error) => error instanceof Response && error.status === 502,
    );
    invalidDelivery = false;
    leakedSolution = true;
    await assert.rejects(
      deliveryRoute.loader(args(`/assignments/${id}/delivery`)),
      (error) => error instanceof Response && error.status === 502,
    );

    sessionStatus = 401;
    await assert.rejects(
      newRoute.loader(args('/assignments/new')),
      (error) =>
        error instanceof Response && error.headers.get('location').startsWith('/login?redirect='),
    );
    assert.equal(
      calls.every((call) => call.cookie === 'session=thu-nghiem'),
      true,
    );
    assert.equal(
      calls.some((call) => call.path === '/assignments' && call.method === 'GET'),
      false,
    );
    assert.equal(
      calls.some((call) => /solutions|questions|exams/.test(call.path)),
      false,
    );
  } finally {
    await vite.close();
    await new Promise((resolveClose) => api.close(resolveClose));
  }
});
