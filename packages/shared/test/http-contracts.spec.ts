import { assignmentsContract } from '../src/http/assignments.js';
import { attemptsContract } from '../src/http/attempts.js';
import { classesContract } from '../src/http/classes.js';
import { examsContract } from '../src/http/exams.js';
import { filesContract, uploadFileBodySchema } from '../src/http/files.js';
import { authContract } from '../src/http/auth.js';
import { curriculaContract } from '../src/http/curricula.js';
import { curriculumNodesContract } from '../src/http/curriculum-nodes.js';
import { learningOutcomesContract } from '../src/http/learning-outcomes.js';
import {
  questionUpdateBodySchema,
  questionsContract,
  questionVersionPathParamsSchema,
} from '../src/http/questions.js';
import { stimuliContract } from '../src/http/stimuli.js';
import { subjectsContract } from '../src/http/subjects.js';
import { describe, expect, it } from 'vitest';

type Operation = {
  method: string;
  path: string;
  responses: Record<number, unknown>;
  pathParams?: { shape: Record<string, unknown> };
};

const resources = {
  assignments: assignmentsContract,
  attempts: attemptsContract,
  classes: classesContract,
  exams: examsContract,
  files: filesContract,
  auth: authContract,
  curricula: curriculaContract,
  curriculumNodes: curriculumNodesContract,
  learningOutcomes: learningOutcomesContract,
  questions: questionsContract,
  stimuli: stimuliContract,
  subjects: subjectsContract,
} as const;

const operations = Object.values(resources).flatMap(
  (resource) => Object.values(resource) as Operation[],
);

describe('Quy ước hợp đồng HTTP', () => {
  it('mỗi thao tác API chỉ có một cặp phương thức và đường dẫn duy nhất', () => {
    const operationKeys = operations.map(({ method, path }) => `${method} ${path}`);
    expect(operations).toHaveLength(73);
    expect(new Set(operationKeys).size).toBe(operationKeys.length);
  });

  it('truy xuất phiên bản sẵn sàng có thể sử dụng thông qua tài nguyên câu hỏi', () => {
    const id = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d20';
    expect(questionsContract.getReady.method).toBe('GET');
    expect(questionsContract.getReady.path).toBe('/questions/:id/ready');
    expect(questionsContract.getReady.pathParams.parse({ id })).toEqual({ id });
    expect(questionsContract.getReady.responses[200]).toBe(questionsContract.get.responses[200]);
  });

  it('xác thực tham số phiên bản dạng số trên đường dẫn', () => {
    const id = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d20';
    expect(questionVersionPathParamsSchema.parse({ id, version: '2' })).toEqual({ id, version: 2 });
    for (const version of ['0', '-1', '1.5', 'latest']) {
      expect(questionVersionPathParamsSchema.safeParse({ id, version }).success).toBe(false);
    }
  });

  it('yêu cầu điều kiện phiên bản dự kiến khi cập nhật PATCH và từ chối cập nhật không tạo thay đổi', () => {
    expect(
      questionUpdateBodySchema.safeParse({ expectedVersion: 1, status: 'ready' }).success,
    ).toBe(true);
    expect(
      questionUpdateBodySchema.safeParse({ expectedVersion: 2, status: 'draft', guidance: null })
        .success,
    ).toBe(true);
    for (const invalid of [
      { expectedVersion: 1 },
      { status: 'ready' },
      { expectedVersion: 0, status: 'ready' },
      { expectedVersion: 1.5, status: 'ready' },
      { expectedVersion: '1', status: 'ready' },
    ]) {
      expect(questionUpdateBodySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('khai báo phản hồi theo mã trạng thái thay vì một trường phản hồi duy nhất', () => {
    for (const operation of operations) {
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
      expect('response' in operation).toBe(false);
    }
  });

  it('đặt tên tham số đường dẫn khớp với vị trí giữ chỗ', () => {
    for (const operation of operations) {
      const pathNames = [...operation.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
      const schemaNames = operation.pathParams ? Object.keys(operation.pathParams.shape) : [];
      expect(schemaNames.sort()).toEqual(pathNames.sort());
    }
  });

  it('biểu diễn mã 204 thành phản hồi không có nội dung', () => {
    for (const operation of operations) {
      if (204 in operation.responses) expect(operation.responses[204]).toBeNull();
    }
  });

  it('mô tả ranh giới tải tệp nhiều phần', () => {
    expect(filesContract.upload.file).toEqual({
      field: 'file',
      required: true,
      maxBytes: 8 * 1024 * 1024,
    });
    expect(uploadFileBodySchema.parse(undefined)).toEqual({});
  });
});
