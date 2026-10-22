import { curriculaContract } from '@giaokhoa/shared/http/curricula';
import { curriculumNodesContract } from '@giaokhoa/shared/http/curriculum-nodes';
import { learningOutcomesContract } from '@giaokhoa/shared/http/learning-outcomes';

export type ManagementEntity = 'curriculum' | 'node' | 'outcome';
export type ManagementFeedback = {
  error?: string;
  success?: string;
  fields?: Record<string, string>;
};

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : value;
}

function integer(form: FormData, key: string) {
  const value = text(form, key);
  if (value === null || value === '') return undefined;
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

const fieldMessages: Record<string, string> = {
  subjectId: 'Chọn môn học có mã UUID v7 hợp lệ.',
  curriculumId: 'Mã chương trình phải là UUID v7.',
  nodeId: 'Mã nút phải là UUID v7.',
  parentId: 'Mã nút cha phải là UUID v7 hoặc để trống cho nút gốc.',
  title: 'Nhập tiêu đề nút.',
  content: 'Nhập nội dung mục tiêu học tập.',
  grade: 'Lớp phải là số nguyên từ 1 đến 12.',
  position: 'Vị trí phải là số nguyên từ 1 đến 2147483647 hoặc để trống.',
};

export function parseManagementBody(
  form: FormData,
  entity: ManagementEntity,
  operation: 'create' | 'update',
  ownerId?: string,
) {
  const position = integer(form, 'position');
  let body: unknown;
  if (entity === 'curriculum') {
    body = { subjectId: text(form, 'subjectId'), grade: integer(form, 'grade') };
  } else if (entity === 'node') {
    body = {
      ...(operation === 'create' ? { curriculumId: ownerId } : {}),
      title: text(form, 'title'),
      parentId: text(form, 'parentId') === '' ? null : text(form, 'parentId'),
      ...(position === undefined ? {} : { position }),
    };
  } else {
    body = {
      ...(operation === 'create' ? { nodeId: ownerId } : {}),
      content: text(form, 'content'),
      ...(position === undefined ? {} : { position }),
    };
  }
  const contract =
    entity === 'curriculum'
      ? curriculaContract
      : entity === 'node'
        ? curriculumNodesContract
        : learningOutcomesContract;
  const result = contract[operation].body.safeParse(body);
  if (result.success) return { success: true as const, data: result.data };
  return {
    success: false as const,
    fields: Object.fromEntries(
      result.error.issues.map((issue) => {
        const field = String(issue.path[0] ?? '');
        return [field, fieldMessages[field] ?? 'Dữ liệu không hợp lệ.'];
      }),
    ),
  };
}
