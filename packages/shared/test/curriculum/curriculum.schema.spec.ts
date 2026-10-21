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

describe('Các lược đồ chương trình học', () => {
  it('chấp nhận dữ liệu môn học tối thiểu và chuẩn hóa văn bản', () => {
    expect(subjectCreateSchema.parse({ name: '  Toán  ', slug: 'toan' })).toEqual({
      name: 'Toán',
      slug: 'toan',
    });
  });

  it('từ chối mã đường dẫn môn học không ổn định', () => {
    expect(subjectCreateSchema.safeParse({ name: 'Toán', slug: 'Toán 6' }).success).toBe(false);
  });

  it('lưu khối lớp ở chương trình thay vì tại từng nút nội dung', () => {
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

  it('yêu cầu nội dung cập nhật không được rỗng', () => {
    expect(subjectPatchSchema.safeParse({}).success).toBe(false);
    expect(curriculumPatchSchema.safeParse({}).success).toBe(false);
    expect(curriculumNodePatchSchema.safeParse({}).success).toBe(false);
  });

  it('chấp nhận một nút chương trình học tối thiểu', () => {
    expect(
      curriculumNodeCreateSchema.parse({
        curriculumId: uuid,
        title: '  Số và Đại số  ',
      }),
    ).toEqual({ curriculumId: uuid, title: 'Số và Đại số' });
  });

  it('yêu cầu vị trí nằm trong giới hạn số nguyên dương PostgreSQL', () => {
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

  it('chấp nhận một yêu cầu cần đạt tối thiểu', () => {
    expect(
      learningOutcomeCreateSchema.parse({
        nodeId: uuid,
        content: '  Nhận biết được số tự nhiên.  ',
      }),
    ).toEqual({ nodeId: uuid, content: 'Nhận biết được số tự nhiên.' });
  });
});
