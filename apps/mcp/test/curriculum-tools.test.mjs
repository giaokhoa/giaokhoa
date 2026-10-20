import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClientError } from '@giaokhoa/application/common/client-error';
import { registerCurriculumTools } from '../dist/curriculum-tools.js';

void test('Curriculum MCP writes reject untrusted principals before executing commands', async () => {
  const handlers = new Map();
  const server = { registerTool: (name, _schema, handler) => handlers.set(name, handler) };
  let writes = 0;
  const curriculum = {
    createCurriculum: async () => {
      writes++;
      return {};
    },
    createNode: async () => {
      writes++;
      return {};
    },
    createOutcome: async () => {
      writes++;
      return {};
    },
  };
  const guard = async () => {
    throw new ClientError('forbidden', 'mcp_trusted_actor_required', 'Không đủ quyền');
  };
  registerCurriculumTools(server, curriculum, guard);

  for (const tool of ['create_curriculum', 'create_curriculum_node', 'create_learning_outcome']) {
    const result = await handlers.get(tool)({});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /mcp_trusted_actor_required/);
  }
  assert.equal(writes, 0);
});

void test('Curriculum MCP writes execute after authorization succeeds', async () => {
  const handlers = new Map();
  const server = { registerTool: (name, _schema, handler) => handlers.set(name, handler) };
  let authorized = 0;
  let created = 0;
  registerCurriculumTools(
    server,
    {
      createCurriculum: async () => {
        created++;
        return { id: 'new' };
      },
    },
    async () => {
      authorized++;
    },
  );

  const result = await handlers.get('create_curriculum')({});
  assert.equal(result.isError, undefined);
  assert.equal(authorized, 1);
  assert.equal(created, 1);
});
