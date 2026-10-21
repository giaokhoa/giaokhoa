import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { parseManagementBody } from '../app/features/curricula/management.ts';

const subjectId = '01900000-0000-7000-8000-000000000011';
const curriculumId = '01900000-0000-7000-8000-000000000012';
const nodeId = '01900000-0000-7000-8000-000000000013';
const outcomeId = '01900000-0000-7000-8000-000000000014';

void test('biểu mẫu chương trình, nút và mục tiêu tuân thủ hợp đồng trước khi gọi API', () => {
  const curriculum = new FormData();
  curriculum.set('subjectId', subjectId);
  curriculum.set('grade', '6');
  assert.equal(parseManagementBody(curriculum, 'curriculum', 'create').success, true);
  curriculum.set('grade', '13');
  assert.equal(parseManagementBody(curriculum, 'curriculum', 'create').success, false);

  const node = new FormData();
  node.set('title', 'Chương một');
  node.set('parentId', '');
  node.set('position', '1');
  const parsedNode = parseManagementBody(node, 'node', 'create', curriculumId);
  assert.equal(parsedNode.success, true);
  assert.equal(parsedNode.data.parentId, null);
  node.set('position', '-1');
  assert.equal(parseManagementBody(node, 'node', 'create', curriculumId).success, false);

  const outcome = new FormData();
  outcome.set('content', 'Nắm vững các khái niệm');
  assert.equal(parseManagementBody(outcome, 'outcome', 'create', nodeId).success, true);
  outcome.set('content', '');
  assert.equal(parseManagementBody(outcome, 'outcome', 'create', nodeId).success, false);
});

void test('trang chương trình và môn học gọi API thật để tạo, sửa, xem và xóa', async (t) => {
  const calls = [];
  const subjects = [{ id: subjectId, name: 'Toán học', slug: 'toan-hoc', position: 1 }];
  const curricula = [{ id: curriculumId, subjectId, grade: 6 }];
  const nodes = [];
  const outcomes = [];
  const send = (body, status = 200) =>
    status === 204 ? new Response(null, { status }) : Response.json(body, { status });

  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/api/auth/get-session') {
      return send({
        user: { id: subjectId, name: 'Giáo viên', email: 'gv@example.test', role: 'teacher' },
        session: { id: 'session' },
      });
    }
    const method = request.method;
    const body = ['POST', 'PATCH'].includes(method) ? await request.json() : null;
    calls.push({ path, method, body, cookie: request.headers.get('cookie') });
    if (path === '/subjects' && method === 'GET') return send(subjects);
    if (path === '/subjects' && method === 'POST') {
      const value = {
        ...body,
        id: '01900000-0000-7000-8000-000000000015',
        position: body.position ?? 2,
      };
      subjects.push(value);
      return send(value, 201);
    }
    if (path.startsWith('/subjects/') && method === 'DELETE') {
      const index = subjects.findIndex((s) => path === '/subjects/' + s.id);
      if (index === -1) return send({ message: 'Không tìm thấy.' }, 404);
      subjects.splice(index, 1);
      return send(null, 204);
    }
    if (path === '/curricula' && method === 'GET') return send(curricula);
    if (path === '/curricula' && method === 'POST') {
      const value = { id: '01900000-0000-7000-8000-000000000016', ...body };
      curricula.push(value);
      return send(value, 201);
    }
    if (path === '/curricula/' + curriculumId && method === 'GET') return send(curricula[0]);
    if (path === '/curricula/' + curriculumId && method === 'PATCH') {
      Object.assign(curricula[0], body);
      return send(curricula[0]);
    }
    if (path === '/curricula/' + curriculumId + '/nodes' && method === 'GET') return send(nodes);
    if (path === '/curriculum-nodes' && method === 'POST') {
      const value = { id: nodeId, position: 1, parentId: null, ...body };
      nodes.push(value);
      return send(value, 201);
    }
    if (path === '/curriculum-nodes/' + nodeId && method === 'PATCH') {
      Object.assign(nodes[0], body);
      return send(nodes[0]);
    }
    if (path === '/curriculum-nodes/' + nodeId && method === 'DELETE') {
      nodes.splice(0);
      return send(null, 204);
    }
    if (path === '/curriculum-nodes/' + nodeId + '/outcomes' && method === 'GET')
      return send(outcomes);
    if (path === '/learning-outcomes' && method === 'POST') {
      const value = { id: outcomeId, position: 1, ...body };
      outcomes.push(value);
      return send(value, 201);
    }
    if (path === '/learning-outcomes/' + outcomeId && method === 'PATCH') {
      Object.assign(outcomes[0], body);
      return send(outcomes[0]);
    }
    if (path === '/learning-outcomes/' + outcomeId && method === 'DELETE') {
      outcomes.splice(0);
      return send(null, 204);
    }
    throw Error('Yêu cầu ngoài dự kiến: ' + method + ' ' + path);
  });
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  t.after(() => server.close());
  const listRoute = await server.ssrLoadModule('/app/routes/curricula.tsx');
  const detailRoute = await server.ssrLoadModule('/app/routes/curriculum/detail.tsx');
  const subjectRoute = await server.ssrLoadModule('/app/routes/subjects.tsx');
  const getRequest = (url) =>
    new Request('http://web.test' + url, {
      headers: { cookie: 'sid=abc' },
    });
  const postRequest = (url, values) =>
    new Request('http://web.test' + url, {
      method: 'POST',
      headers: { cookie: 'sid=abc' },
      body: new URLSearchParams(values),
    });

  await t.test('liệt kê ma trận và xem nội dung từng chương trình', async () => {
    const list = await listRoute.loader({ request: getRequest('/curricula') });
    assert.equal(list.curricula.length, 1);
    assert.deepEqual(list.rows[0].grades, [6]);
    const detail = await detailRoute.loader({
      request: getRequest('/curricula/' + curriculumId),
      params: { id: curriculumId },
    });
    assert.equal(detail.curriculum.id, curriculumId);
    assert.equal(detail.entries.length, 0);
  });

  await t.test('không gửi API khi dữ liệu không hợp lệ', async () => {
    const previous = calls.length;
    const response = await detailRoute.action({
      request: postRequest('/curricula/' + curriculumId, {
        intent: 'node-create',
        title: '',
        parentId: '',
        position: '0',
      }),
      params: { id: curriculumId },
    });
    assert.equal(response.init.status, 400);
    assert.equal(calls.length, previous);
  });

  await t.test('tạo và sửa nút rồi tạo, sửa, xóa mục tiêu và nút', async () => {
    const action = (values) =>
      detailRoute.action({
        request: postRequest('/curricula/' + curriculumId, values),
        params: { id: curriculumId },
      });
    assert.equal(
      (
        await action({
          intent: 'node-create',
          title: 'Chương 1',
          parentId: '',
          position: '1',
        })
      ).data.success,
      'Đã lưu thay đổi.',
    );
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].curriculumId, curriculumId);

    await action({
      intent: 'node-update',
      id: nodeId,
      title: 'Chương I',
      parentId: '',
      position: '1',
    });
    assert.equal(nodes[0].title, 'Chương I');
    await action({ intent: 'outcome-create', nodeId, content: 'Hiểu lý thuyết', position: '1' });
    assert.equal(outcomes[0].nodeId, nodeId);
    await action({
      intent: 'outcome-update',
      id: outcomeId,
      nodeId,
      content: 'Vận dụng',
      position: '1',
    });
    assert.equal(outcomes[0].content, 'Vận dụng');
    const detail = await detailRoute.loader({
      request: getRequest('/curricula/' + curriculumId),
      params: { id: curriculumId },
    });
    assert.equal(detail.entries[0].outcomes.length, 1);
    await action({ intent: 'outcome-delete', id: outcomeId, nodeId });
    await action({ intent: 'node-delete', id: nodeId });
    assert.equal(outcomes.length, 0);
    assert.equal(nodes.length, 0);
  });

  await t.test('tạo chương trình và môn học, sau đó xóa môn', async () => {
    const created = await listRoute.action({
      request: postRequest('/curricula', {
        intent: 'curriculum-create',
        subjectId,
        grade: '7',
      }),
    });
    assert.equal(created.status, 302);
    assert.equal(curricula.length, 2);

    const subject = await subjectRoute.action({
      request: postRequest('/subjects', {
        intent: 'create',
        name: 'Văn học',
        slug: 'van-hoc',
        position: '2',
      }),
    });
    const subjectBody = await subject.json();
    assert.equal(subjectBody.subject.name, 'Văn học');
    const removed = await subjectRoute.action({
      request: postRequest('/subjects', {
        intent: 'delete',
        id: subjectBody.subject.id,
      }),
    });
    const removedBody = await removed.json();
    assert.equal(removedBody.deleted, true);
    assert.equal(subjects.length, 1);
  });
  assert.ok(calls.every((call) => call.cookie === 'sid=abc'));
});
