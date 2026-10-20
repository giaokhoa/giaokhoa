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

describe('HTTP contract convention', () => {
  it('has one unique method + path per custom API operation', () => {
    const operationKeys = operations.map(({ method, path }) => `${method} ${path}`);
    expect(operations).toHaveLength(73);
    expect(new Set(operationKeys).size).toBe(operationKeys.length);
  });

  it('resolves a usable ready revision through the question resource', () => {
    const id = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d20';
    expect(questionsContract.getReady.method).toBe('GET');
    expect(questionsContract.getReady.path).toBe('/questions/:id/ready');
    expect(questionsContract.getReady.pathParams.parse({ id })).toEqual({ id });
    expect(questionsContract.getReady.responses[200]).toBe(questionsContract.get.responses[200]);
  });

  it('validates numeric version URL parameters', () => {
    const id = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d20';
    expect(questionVersionPathParamsSchema.parse({ id, version: '2' })).toEqual({ id, version: 2 });
    for (const version of ['0', '-1', '1.5', 'latest']) {
      expect(questionVersionPathParamsSchema.safeParse({ id, version }).success).toBe(false);
    }
  });

  it('requires an expectedVersion precondition on PATCH without accepting a no-op', () => {
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

  it('uses responses keyed by status code instead of a singular response field', () => {
    for (const operation of operations) {
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
      expect('response' in operation).toBe(false);
    }
  });

  it('uses pathParams names that match path placeholders', () => {
    for (const operation of operations) {
      const pathNames = [...operation.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
      const schemaNames = operation.pathParams ? Object.keys(operation.pathParams.shape) : [];
      expect(schemaNames.sort()).toEqual(pathNames.sort());
    }
  });

  it('represents 204 as an explicit no-body response', () => {
    for (const operation of operations) {
      if (204 in operation.responses) expect(operation.responses[204]).toBeNull();
    }
  });

  it('describes the multipart file boundary', () => {
    expect(filesContract.upload.file).toEqual({
      field: 'file',
      required: true,
      maxBytes: 8 * 1024 * 1024,
    });
    expect(uploadFileBodySchema.parse(undefined)).toEqual({});
  });
});
