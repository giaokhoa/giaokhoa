import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const id = '01900000-0000-7000-8000-000000000001';
const childIds = Array.from(
  { length: 4 },
  (_, index) => `550e8400-e29b-41d4-a716-44665544000${index}`,
);
const instant = '2026-10-21T09:30:00.000Z';
const attempt = {
  id,
  assignmentId: id,
  userId: id,
  attemptNumber: 1,
  status: 'in_progress',
  startedAt: instant,
  submittedAt: null,
  gradedAt: null,
  responses: [],
};
const document = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bài giải' }] }],
};

void test('các trang lượt làm tuân thủ quyền, hợp đồng và mốc công bố của API', async (t) => {
  let responses = new Map();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/api/auth/get-session')
      return Response.json({
        user: { id, name: 'Người dùng', email: 'user@example.test' },
        session: { id: 'session' },
      });
    calls.push({
      method: request.method,
      path,
      body: await request.text(),
      cookie: request.headers.get('cookie'),
    });
    const response = responses.get(`${request.method} ${path}`);
    assert.ok(response, `Yêu cầu API ngoài dự kiến: ${request.method} ${path}`);
    return Response.json(response.body, { status: response.status ?? 200 });
  });
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  t.after(() => server.close());
  const detail = await server.ssrLoadModule('/app/routes/attempts/detail.tsx');
  const review = await server.ssrLoadModule('/app/routes/attempts/review.tsx');
  const list = await server.ssrLoadModule('/app/routes/assignments/attempts.tsx');

  function reset(entries) {
    calls.length = 0;
    responses = new Map(entries);
  }
  function request(form) {
    return new Request(`http://web.test/attempts/${id}`, {
      headers: { cookie: 'session=test' },
      ...(form ? { method: 'POST', body: new URLSearchParams(form) } : {}),
    });
  }

  await t.test('lượt đang làm chỉ tải đề, không yêu cầu kết quả hoặc lời giải', async () => {
    reset([
      [`GET /attempts/${id}`, { body: attempt }],
      [
        `GET /assignments/${id}/delivery`,
        {
          body: {
            assignmentId: id,
            examRevisionId: id,
            title: 'Đề được giao',
            openAt: instant,
            closeAt: '2026-10-22T09:30:00.000Z',
            maxAttempts: 1,
            questions: [],
          },
        },
      ],
    ]);
    const loaded = await detail.loader({ request: request(), params: { id } });
    assert.ok(loaded.attempt.startedAt instanceof Date);
    assert.ok(loaded.delivery.value.closeAt instanceof Date);
    assert.equal(loaded.result.value, null);
    assert.equal(loaded.solutions.value, null);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.cookie === 'session=test'));
  });

  await t.test(
    'vẫn xem lịch sử và lời giải được công bố khi đề bị từ chối, kết quả chưa công bố',
    async () => {
      reset([
        [
          `GET /attempts/${id}`,
          { body: { ...attempt, status: 'submitted', submittedAt: instant } },
        ],
        [
          `GET /assignments/${id}/delivery`,
          { status: 403, body: { message: 'Không còn quyền đọc đề' } },
        ],
        [
          `GET /attempts/${id}/result`,
          { status: 404, body: { message: 'Kết quả chưa được công bố' } },
        ],
        [
          `GET /attempts/${id}/solutions`,
          { body: { attemptId: id, questions: [{ position: 7, solution: { answer: '12' } }] } },
        ],
      ]);
      const loaded = await detail.loader({ request: request(), params: { id } });
      assert.equal(loaded.attempt.status, 'submitted');
      assert.equal(loaded.delivery.value, null);
      assert.equal(loaded.delivery.error, 'Không còn quyền đọc đề');
      assert.equal(loaded.result.value, null);
      assert.equal(loaded.solutions.value.questions[0].position, 7);
      assert.deepEqual(loaded.solutions.value.questions[0].solution, { answer: '12' });
    },
  );

  await t.test('không công bố lời giải lỗi và giữ nguyên điểm null dù đã có nhận xét', async () => {
    reset([
      [
        `GET /attempts/${id}`,
        { body: { ...attempt, status: 'graded', submittedAt: instant, gradedAt: instant } },
      ],
      [`GET /assignments/${id}/delivery`, { status: 403, body: { message: 'Không được đọc đề' } }],
      [
        `GET /attempts/${id}/result`,
        { body: { attemptId: id, gradedAt: instant, score: null, feedback: 'Đã nhận xét' } },
      ],
      [
        `GET /attempts/${id}/solutions`,
        {
          status: 404,
          body: {
            message: 'Đáp án chưa được công bố',
            questions: [{ solution: 'không được hiển thị' }],
          },
        },
      ],
    ]);
    const loaded = await detail.loader({ request: request(), params: { id } });
    assert.equal(loaded.result.value.score, null);
    assert.equal(loaded.result.value.feedback, 'Đã nhận xét');
    assert.equal(loaded.solutions.value, null);
    assert.equal(JSON.stringify(loaded).includes('không được hiển thị'), false);
  });

  await t.test(
    'lưu đúng vị trí cho mọi dạng câu trả lời và không gửi đáp án của tác giả',
    async () => {
      const answers = [
        { type: 'multiple_choice', choiceId: childIds[0] },
        {
          type: 'true_false',
          answers: childIds.map((statementId, index) => ({ statementId, value: index % 2 === 0 })),
        },
        { type: 'short_answer', answer: '12' },
        { type: 'essay', answer: document },
        {
          type: 'essay',
          answers: childIds.slice(0, 2).map((partId) => ({ partId, content: document })),
        },
      ];
      for (const answer of answers) {
        reset([[`PUT /attempts/${id}/responses/7`, { body: attempt }]]);
        const result = await detail.action({
          params: { id },
          request: request({ intent: 'save', position: '7', answer: JSON.stringify(answer) }),
        });
        assert.equal(result.data.success, 'Đã lưu câu trả lời.');
        assert.deepEqual(JSON.parse(calls[0].body), answer);
        assert.equal(calls[0].path, `/attempts/${id}/responses/7`);
      }
    },
  );

  await t.test('từ chối mệnh đề trùng và vị trí sai trước khi gọi API lưu', async () => {
    reset([]);
    for (const form of [
      {
        intent: 'save',
        position: '0',
        answer: JSON.stringify({ type: 'short_answer', answer: '12' }),
      },
      {
        intent: 'save',
        position: '7',
        answer: JSON.stringify({
          type: 'true_false',
          answers: childIds.map(() => ({ statementId: childIds[0], value: true })),
        }),
      },
      { intent: 'save', position: '7', answer: 'sai định dạng' },
    ]) {
      const result = await detail.action({ params: { id }, request: request(form) });
      assert.equal(result.init.status, 400);
    }
    assert.equal(calls.length, 0);
  });

  await t.test('nộp cần xác nhận và chuyển nguyên lỗi quá hạn từ API', async () => {
    reset([
      [`POST /attempts/${id}/submit`, { status: 409, body: { message: 'Đã hết hạn làm bài' } }],
    ]);
    const unconfirmed = await detail.action({
      params: { id },
      request: request({ intent: 'submit' }),
    });
    assert.equal(unconfirmed.init.status, 400);
    assert.equal(calls.length, 0);
    const expired = await detail.action({
      params: { id },
      request: request({ intent: 'submit', confirm: 'yes' }),
    });
    assert.equal(expired.init.status, 409);
    assert.equal(expired.data.error, 'Đã hết hạn làm bài');
  });

  await t.test(
    'trang giáo viên dùng API riêng, chấm điểm 0 và gửi nhận xét rỗng thành null',
    async () => {
      const graded = {
        ...attempt,
        status: 'graded',
        submittedAt: instant,
        gradedAt: instant,
        score: 0,
        feedback: null,
      };
      reset([
        [`GET /attempts/${id}/review`, { body: graded }],
        [`PATCH /attempts/${id}/grade`, { body: graded }],
        [
          `GET /assignments/${id}/attempts`,
          { body: [graded].map(({ responses: _responses, ...summary }) => summary) },
        ],
      ]);
      const loaded = await review.loader({ request: request(), params: { id } });
      assert.equal(loaded.attempt.score, 0);
      const listed = await list.loader({ request: request(), params: { assignmentId: id } });
      assert.equal(listed.attempts[0].score, 0);
      const result = await review.action({
        request: request({ score: '0', feedback: '' }),
        params: { id },
      });
      assert.equal(result.data.success, 'Đã lưu điểm và nhận xét.');
      assert.deepEqual(JSON.parse(calls.at(-1).body), { score: 0, feedback: null });
      assert.equal(
        calls.some((call) => call.path.endsWith('/delivery') || call.path.endsWith('/solutions')),
        false,
      );
    },
  );

  await t.test(
    'từ chối điểm rỗng, ngoài thang, quá hai chữ số lẻ và quyền chấm bị từ chối',
    async () => {
      reset([
        [
          `GET /attempts/${id}/review`,
          { status: 403, body: { message: 'Không được chấm bài này' } },
        ],
      ]);
      for (const score of ['', ' ', '-1', '101', '1.234']) {
        const result = await review.action({ request: request({ score }), params: { id } });
        assert.equal(result.init.status, 400);
      }
      assert.equal(calls.length, 0);
      await assert.rejects(
        review.loader({ request: request(), params: { id } }),
        (error) => error instanceof Response && error.status === 403,
      );
    },
  );

  await t.test(
    'từ chối phản hồi thành công có ngày sai thay vì đưa dữ liệu chưa kiểm tra ra giao diện',
    async () => {
      reset([[`GET /attempts/${id}`, { body: { ...attempt, startedAt: 'không phải ngày' } }]]);
      await assert.rejects(
        detail.loader({ request: request(), params: { id } }),
        (error) => error instanceof Response && error.status === 502,
      );
      assert.equal(calls.length, 1);
    },
  );
});
