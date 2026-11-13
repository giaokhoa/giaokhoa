/** Bất biến của gói học liệu tự đủ và yêu cầu ghim phiên bản, dùng chung cho API/web. */
import { describe, expect, it } from 'vitest';
import { systemMaterialPackageSchema, useSystemMaterialSchema } from './system-material.js';

const id = '01961300-0000-7000-8000-000000000123';
const pkg = {
  name: 'Bài học', resourceType: 'reference', description: null, language: 'vi',
  subjectId: null, grade: null, level: null, curriculumNodeId: null, outcomeIds: [],
  file: null, externalUrl: 'https://example.org/lesson',
  source: { centreSlug: 'centre-a', contentId: id, originalAuthor: 'Tác giả A', sourceKind: 'self', sourceCitation: null, license: 'CC BY' },
};

describe('Gói học liệu và bản tiếp nhận phiên bản', () => {
  it('bắt buộc tác giả/giấy phép và nguồn trích dẫn khi học liệu không tự soạn', () => {
    expect(systemMaterialPackageSchema.safeParse(pkg).success).toBe(true);
    for (const source of [
      { ...pkg.source, originalAuthor: ' ' }, { ...pkg.source, license: '' },
      { ...pkg.source, sourceKind: 'cited' }, { ...pkg.source, sourceKind: 'derived' },
    ]) expect(systemMaterialPackageSchema.safeParse({ ...pkg, source }).success).toBe(false);
  });

  it('chỉ cho một nguồn hợp lệ, không mang fileId riêng, category câu hỏi hoặc dữ liệu khoá', () => {
    expect(systemMaterialPackageSchema.safeParse({ ...pkg, externalUrl: null }).success).toBe(false);
    expect(systemMaterialPackageSchema.safeParse({ ...pkg, externalUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(systemMaterialPackageSchema.safeParse({ ...pkg, file: { contentHash: 'a'.repeat(64), fileName: 'lesson.pdf', mimeType: 'application/pdf', fileSize: 12 } }).success).toBe(false);
    for (const key of ['fileId', 'questionCategoryId', 'courseId', 'studentId']) {
      expect(systemMaterialPackageSchema.safeParse({ ...pkg, [key]: id }).success).toBe(false);
    }
  });

  it('giáo viên phải chọn rõ phiên bản dương và khoá/section, không tự lấy bản mới nhất', () => {
    const input = { materialId: id, courseId: id, sectionId: id };
    expect(useSystemMaterialSchema.safeParse(input).success).toBe(false);
    expect(useSystemMaterialSchema.safeParse({ ...input, version: 0 }).success).toBe(false);
    expect(useSystemMaterialSchema.safeParse({ ...input, version: 1 }).success).toBe(true);
  });
});
