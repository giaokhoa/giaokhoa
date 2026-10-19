import { imagesContract, uploadImageBodySchema } from '../src/http/images.js';
import { authContract } from '../src/http/auth.js';
import { curriculaContract } from '../src/http/curricula.js';
import { curriculumNodesContract } from '../src/http/curriculum-nodes.js';
import { learningOutcomesContract } from '../src/http/learning-outcomes.js';
import { questionsContract } from '../src/http/questions.js';
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
  images: imagesContract,
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
    expect(operations).toHaveLength(37);
    expect(new Set(operationKeys).size).toBe(operationKeys.length);
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

  it('describes the multipart image file boundary', () => {
    expect(imagesContract.upload.file).toEqual({
      field: 'file',
      required: true,
      maxBytes: 8 * 1024 * 1024,
    });
    expect(uploadImageBodySchema.parse(undefined)).toEqual({});
  });
});
