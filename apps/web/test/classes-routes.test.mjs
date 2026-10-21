import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const userId = '01900000-0000-7000-8000-000000000001';
const classId = '01900000-0000-7000-8000-000000000002';
const memberId = '01900000-0000-7000-8000-000000000003';
const date = '2026-10-21T09:30:00.000Z';

void test('Đường dẫn lớp học kiểm tra hợp đồng, quyền và chuyển trạng thái qua API', async (t) => {
  const originalFetch = globalThis.fetch;
  let scenario;
  let requests;
  const reset = (changes = {}) => {
    scenario = {
      role: 'teacher',
      ownerId: userId,
      status: 'active',
      joinStatus: 'pending',
      memberStatus: 'active',
      getStatus: 200,
      ...changes,
    };
    requests = [];
  };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const method = request.method;
    requests.push({ path, method, body: await request.text() });
    const json = (value, status = 200) => Response.json(value, { status });
    if (path === '/api/auth/get-session') {
      return json({
        user: { id: userId, role: scenario.role, name: 'Giáo viên', email: 'teacher@example.com' },
        session: { id: 'session-id' },
      });
    }
    if (path === '/classes/join' && method === 'POST')
      return json({ classId, status: scenario.joinStatus }, 201);
    if (path === `/classes/${classId}` && method === 'GET') {
      if (scenario.getStatus !== 200)
        return json({ message: 'Bạn không có quyền xem lớp.' }, scenario.getStatus);
      return json({
        id: classId,
        name: 'Lớp Toán',
        createdByUserId: scenario.ownerId,
        status: scenario.status,
        joinMode: 'APPROVAL',
        createdAt: date,
        updatedAt: date,
      });
    }
    if (path === `/classes/${classId}/members` && method === 'GET')
      return json([
        { userId: memberId, status: scenario.memberStatus, joinedAt: date, updatedAt: date },
      ]);
    if (path === `/classes/${classId}/leave` && method === 'POST')
      return new Response(null, { status: 204 });
    throw new Error(`Yêu cầu ngoài dự kiến: ${method} ${path}`);
  };
  let server;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await server?.close();
  });
  server = await createServer({
    root: new URL('../', import.meta.url).pathname,
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  });
  const index = await server.ssrLoadModule('/app/routes/classes/index.tsx');
  const detail = await server.ssrLoadModule('/app/routes/classes/detail.tsx');
  const requestFor = (fields) =>
    new Request(`http://web.example/classes/${classId}`, {
      method: 'POST',
      body: new URLSearchParams(fields),
    });
  const runAction = (route, fields) =>
    route.action({ request: requestFor(fields), params: { id: classId } });
  const mutations = () => requests.filter((request) => request.method !== 'GET');

  await t.test('Tải lớp và thành viên chuyển chuỗi ngày JSON thành ngày hợp lệ', async () => {
    reset();
    const result = await detail.loader({
      request: new Request(`http://web.example/classes/${classId}`),
      params: { id: classId },
    });
    assert.equal(result.classroom.createdAt.toISOString(), date);
    assert.equal(result.members[0].joinedAt.toISOString(), date);
    assert.equal(result.access.canManage, true);
  });
  await t.test('Gia nhập chờ duyệt trả thông báo và không chuyển vào lớp', async () => {
    reset();
    const result = await runAction(index, { intent: 'join', code: 'ma-gia-nhap-lop-hop-le' });
    assert.equal(result instanceof Response, false);
    assert.deepEqual(result.data.joined, { classId, status: 'pending' });
    assert.equal(result.data.error, null);
    assert.equal(mutations()[0].path, '/classes/join');
  });
  await t.test('Gia nhập được chấp nhận chuyển đến lớp', async () => {
    reset({ joinStatus: 'active' });
    const result = await runAction(index, { intent: 'join', code: 'ma-gia-nhap-lop-hop-le' });
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('location'), `/classes/${classId}`);
  });
  await t.test('Người học tạo lớp bị từ chối trước khi gửi yêu cầu ghi', async () => {
    reset({ role: 'user' });
    const result = await runAction(index, { intent: 'create', name: 'Lớp Toán', joinMode: 'AUTO' });
    assert.equal(result.init.status, 403);
    assert.deepEqual(mutations(), []);
  });
  await t.test('Người không phải chủ lớp không được sửa thông tin', async () => {
    reset({ ownerId: memberId });
    const result = await runAction(detail, {
      intent: 'update',
      name: 'Tên mới',
      joinMode: 'AUTO',
      status: 'active',
    });
    assert.equal(result.init.status, 403);
    assert.deepEqual(mutations(), []);
    assert.equal(
      requests.some((request) => request.path.endsWith('/members')),
      false,
    );
  });
  await t.test('Lớp lưu trữ không cho tạo mã mời', async () => {
    reset({ status: 'archived' });
    const result = await runAction(detail, { intent: 'invite', expiresInHours: '24', maxUses: '' });
    assert.equal(result.init.status, 409);
    assert.deepEqual(mutations(), []);
  });
  await t.test('Không gửi yêu cầu duyệt người đã đang học', async () => {
    reset();
    const result = await runAction(detail, { intent: 'approve', userId: memberId });
    assert.equal(result.init.status, 409);
    assert.deepEqual(mutations(), []);
  });
  await t.test('Người không có quyền xem lớp vẫn tự rời lớp qua API', async () => {
    reset({ getStatus: 403 });
    const result = await runAction(detail, { intent: 'leave', confirm: 'yes' });
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('location'), '/classes');
    assert.deepEqual(
      mutations().map(({ path, method }) => ({ path, method })),
      [{ path: `/classes/${classId}/leave`, method: 'POST' }],
    );
    assert.equal(
      requests.some((request) => request.path === `/classes/${classId}`),
      false,
    );
  });
});
