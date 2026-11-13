import { describe, expect, it } from 'vitest';
import routesConfig from './routes';


const ALL_ROUTES: Array<{ path: string; file: string; index?: boolean }> = (() => {
  const collected: Array<{ path: string; file: string; index?: boolean }> = [];
  const walk = (entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries as Array<{ path?: string; file?: string; index?: boolean; children?: unknown }>) {
      if (typeof entry.path === 'string') collected.push({ path: entry.path, file: entry.file ?? '', index: entry.index });
      walk(entry.children);
    }
  };
  walk(routesConfig);
  return collected;
})();

const ALL_PATHS: string[] = ALL_ROUTES.map((route) => route.path);

const RESOURCE_PARAM: Record<string, string> = {
  subjects: ':subjectId',
  curricula: ':curriculumId',
  nodes: ':nodeId',
  outcomes: ':outcomeId',
};

const EXPECTED_CURRICULUM_PATHS = [
  'admin/curriculum',
  'admin/curriculum/curricula/:curriculumId',
  'admin/curriculum/curricula/:curriculumId/edit',
  'admin/curriculum/curricula/:curriculumId/nodes/new',
  'admin/curriculum/nodes/:nodeId/edit',
  'admin/curriculum/nodes/:nodeId/outcomes/new',
  'admin/curriculum/outcomes/:outcomeId/edit',
  'admin/curriculum/subjects/:subjectId/curricula/new',
  'admin/curriculum/subjects/:subjectId/edit',
  'admin/curriculum/subjects/new',
];

describe('Bản đồ route của lát R2–R4 (chuẩn đường dẫn #221)', () => {
  it('trang gốc của các nhóm prefix là index route, URL gốc không bị đổi', () => {
    for (const path of ['admin/curriculum', 'classes', 'content-bank', 'contentbank', 'guardian', 'settings']) {
      const matched = ALL_ROUTES.filter((route) => route.path === path);
      expect(matched).toHaveLength(1);
      expect(matched[0]?.index, `${path} phải được khai bằng index()`).toBe(true);
    }
  });

  it('R2: khu vực phụ huynh có gốc và path theo từng con', () => {
    expect(ALL_PATHS).toContain('guardian');
    expect(ALL_PATHS).toContain('guardian/students/:studentId');
  });

  it('R3: Kho học liệu có cây chính viết tách và giữ đủ ba path cũ làm lớp tương thích', () => {
    for (const path of ['content-bank', 'content-bank/new', 'content-bank/:id/edit']) {
      expect(ALL_PATHS).toContain(path);
    }
    for (const path of ['contentbank', 'contentbank/new', 'contentbank/:id/edit']) {
      expect(ALL_PATHS).toContain(path);
    }
  });

  it('không có hai path nào dùng chung một route module (id route suy ra từ file, trùng là lỗi cấu hình khi build)', () => {
    const byFile = new Map<string, string[]>();
    for (const route of ALL_ROUTES) {
      if (!route.file) continue;
      byFile.set(route.file, [...(byFile.get(route.file) ?? []), route.path]);
    }
    const duplicated = [...byFile.entries()].filter(([, paths]) => paths.length > 1);
    expect(duplicated).toEqual([]);
  });

  it('R4: họ admin/curriculum khớp đúng bản đồ rà soát đã duyệt', () => {
    const family = ALL_PATHS.filter((path) => path === 'admin/curriculum' || path.startsWith('admin/curriculum/'));
    expect([...family].sort()).toEqual([...EXPECTED_CURRICULUM_PATHS].sort());
  });

  it('R4: mọi path trong họ thuộc đúng một trong hai hình dạng chuẩn, không có hình dạng thứ ba', () => {
    const family = EXPECTED_CURRICULUM_PATHS.filter((path) => path !== 'admin/curriculum');
    for (const path of family) {
      const segments = path.replace('admin/curriculum/', '').split('/');
      const paramSegments = segments.filter((segment) => segment.startsWith(':'));
      const invalidParams = segments.flatMap((segment, index) =>
        segment.startsWith(':') && RESOURCE_PARAM[segments[index - 1]!] !== segment
          ? [segment]
          : [],
      );
      expect(invalidParams).toEqual([]);
      const creating = segments[segments.length - 1] === 'new';
      expect(creating ? paramSegments.length <= 1 : paramSegments.length === 1).toBe(true);
      expect(!creating || Object.keys(RESOURCE_PARAM).includes(segments[segments.length - 2]!)).toBe(true);
    }
  });
});
