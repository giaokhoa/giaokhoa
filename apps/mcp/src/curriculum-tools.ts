import { ClientError } from '@giaokhoa/application/common/client-error';
import type { CurriculumService } from '@giaokhoa/application/curriculum/service';
import {
  curriculumCreateSchema,
  curriculumNodeCreateSchema,
  learningOutcomeCreateSchema,
  // subjectCreateSchema,
  // subjectPatchSchema,
} from '@giaokhoa/shared/curriculum';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const idSchema = z.uuidv7();
// const updateSubjectSchema = z.object({ id: idSchema }).and(subjectPatchSchema);

function success(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}

async function run(action: () => Promise<unknown>) {
  try {
    return success(await action());
  } catch (error) {
    if (error instanceof ClientError) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `${error.code}: ${error.message}` }],
      };
    }
    throw error;
  }
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const createOnly = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/* Reserved for update_subject when Subject writes are restored.
const updateOnly = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
*/

export function registerCurriculumTools(server: McpServer, curriculum: CurriculumService) {
  server.registerTool(
    'list_subjects',
    {
      description: 'Liệt kê các môn học hiện có.',
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    () => run(() => curriculum.listSubjects()),
  );

  server.registerTool(
    'get_subject',
    {
      description: 'Đọc một môn học theo ID.',
      inputSchema: z.object({ id: idSchema }),
      annotations: readOnly,
    },
    ({ id }) => run(() => curriculum.getSubject(id)),
  );

  /* Subject mutations are intentionally disabled in MCP.
  server.registerTool(
    'create_subject',
    {
      description: 'Tạo một môn học mới.',
      inputSchema: subjectCreateSchema,
      annotations: createOnly,
    },
    (input) => run(() => curriculum.createSubject(input)),
  );

  server.registerTool(
    'update_subject',
    {
      description: 'Cập nhật tên, slug hoặc vị trí sắp xếp của một môn học.',
      inputSchema: updateSubjectSchema,
      annotations: updateOnly,
    },
    ({ id, ...patch }) => run(() => curriculum.updateSubject(id, patch)),
  );
  */

  server.registerTool(
    'list_curricula',
    {
      description: 'Liệt kê chương trình các lớp của một môn học.',
      inputSchema: z.object({ subjectId: idSchema }),
      annotations: readOnly,
    },
    ({ subjectId }) => run(() => curriculum.listCurricula(subjectId)),
  );

  server.registerTool(
    'get_curriculum',
    {
      description: 'Đọc một chương trình môn/lớp theo ID.',
      inputSchema: z.object({ id: idSchema }),
      annotations: readOnly,
    },
    ({ id }) => run(() => curriculum.getCurriculum(id)),
  );

  server.registerTool(
    'create_curriculum',
    {
      description: 'Tạo chương trình cho một môn học và khối lớp.',
      inputSchema: curriculumCreateSchema,
      annotations: createOnly,
    },
    (input) => run(() => curriculum.createCurriculum(input)),
  );

  server.registerTool(
    'list_curriculum_nodes',
    {
      description: 'Liệt kê các nút nội dung của một chương trình.',
      inputSchema: z.object({ curriculumId: idSchema }),
      annotations: readOnly,
    },
    ({ curriculumId }) => run(() => curriculum.listNodes(curriculumId)),
  );

  server.registerTool(
    'get_curriculum_node',
    {
      description: 'Đọc một nút nội dung chương trình theo ID.',
      inputSchema: z.object({ id: idSchema }),
      annotations: readOnly,
    },
    ({ id }) => run(() => curriculum.getNode(id)),
  );

  server.registerTool(
    'create_curriculum_node',
    {
      description: 'Tạo một nút nội dung trong cây chương trình.',
      inputSchema: curriculumNodeCreateSchema,
      annotations: createOnly,
    },
    (input) => run(() => curriculum.createNode(input)),
  );

  server.registerTool(
    'list_learning_outcomes',
    {
      description: 'Liệt kê yêu cầu cần đạt của một nút nội dung.',
      inputSchema: z.object({ nodeId: idSchema }),
      annotations: readOnly,
    },
    ({ nodeId }) => run(() => curriculum.listOutcomes(nodeId)),
  );

  server.registerTool(
    'get_learning_outcome',
    {
      description: 'Đọc một yêu cầu cần đạt theo ID.',
      inputSchema: z.object({ id: idSchema }),
      annotations: readOnly,
    },
    ({ id }) => run(() => curriculum.getOutcome(id)),
  );

  server.registerTool(
    'create_learning_outcome',
    {
      description: 'Tạo một yêu cầu cần đạt cho nút nội dung.',
      inputSchema: learningOutcomeCreateSchema,
      annotations: createOnly,
    },
    (input) => run(() => curriculum.createOutcome(input)),
  );
}
