import { describe, expect, it } from 'vitest';
import {
  curriculumCreateSchema,
  curriculumNodeCreateSchema,
  curriculumNodePatchSchema,
  curriculumPatchSchema,
  learningOutcomeCreateSchema,
  subjectCreateSchema,
  subjectPatchSchema,
} from '../../src/curriculum.js';

const uuid = '0199f6e8-865f-7a63-b4ad-a6d488412248';

describe('curriculum schemas', () => {
  it('accepts the minimal subject payload and normalizes text', () => {
    expect(subjectCreateSchema.parse({ name: '  Toán  ', slug: 'toan' })).toEqual({
      name: 'Toán',
      slug: 'toan',
    });
  });

  it('rejects unstable subject slugs', () => {
    expect(subjectCreateSchema.safeParse({ name: 'Toán', slug: 'Toán 6' }).success).toBe(false);
  });

  it('keeps grade on curriculum, not curriculum nodes', () => {
    expect(curriculumCreateSchema.safeParse({ subjectId: uuid, grade: 0 }).success).toBe(false);
    expect(curriculumCreateSchema.safeParse({ subjectId: uuid, grade: 12 }).success).toBe(true);
    expect(
      curriculumNodeCreateSchema.safeParse({
        curriculumId: uuid,
        grade: 6,
        title: 'Số và Đại số',
      }).success,
    ).toBe(false);
  });

  it('requires non-empty patches', () => {
    expect(subjectPatchSchema.safeParse({}).success).toBe(false);
    expect(curriculumPatchSchema.safeParse({}).success).toBe(false);
    expect(curriculumNodePatchSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a minimal curriculum node', () => {
    expect(
      curriculumNodeCreateSchema.parse({
        curriculumId: uuid,
        title: '  Số và Đại số  ',
      }),
    ).toEqual({ curriculumId: uuid, title: 'Số và Đại số' });
  });

  it('requires positions to fit a positive PostgreSQL integer', () => {
    const maxPosition = 2_147_483_647;
    expect(
      subjectCreateSchema.safeParse({ name: 'Toán', slug: 'toan', position: maxPosition }).success,
    ).toBe(true);
    expect(
      curriculumNodeCreateSchema.safeParse({
        curriculumId: uuid,
        title: 'Số',
        position: maxPosition,
      }).success,
    ).toBe(true);
    expect(
      learningOutcomeCreateSchema.safeParse({
        nodeId: uuid,
        content: 'Yêu cầu',
        position: maxPosition,
      }).success,
    ).toBe(true);

    for (const position of [0, maxPosition + 1]) {
      expect(subjectCreateSchema.safeParse({ name: 'Toán', slug: 'toan', position }).success).toBe(
        false,
      );
      expect(
        curriculumNodeCreateSchema.safeParse({ curriculumId: uuid, title: 'Số', position }).success,
      ).toBe(false);
      expect(
        learningOutcomeCreateSchema.safeParse({ nodeId: uuid, content: 'Yêu cầu', position })
          .success,
      ).toBe(false);
    }
  });

  it('accepts a minimal learning outcome', () => {
    expect(
      learningOutcomeCreateSchema.parse({
        nodeId: uuid,
        content: '  Nhận biết được số tự nhiên.  ',
      }),
    ).toEqual({ nodeId: uuid, content: 'Nhận biết được số tự nhiên.' });
  });
});
