import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../support/identity-access-helpers';

const EXPECTED_ROUTES: string[] = [

      'DELETE /exam-matrices/{id}',
      'DELETE /exam-matrices/{id}/cells/{cellId}',
      'DELETE /exam-papers/dossiers/{dossierId}',
      'DELETE /exam-papers/{id}',
      'DELETE /exams/dossiers/{dossierId}',
      'DELETE /exams/{id}',
      'GET /exam-matrices/by-subject/{subjectId}',
      'GET /exam-matrices/template',
      'GET /exam-matrices/{id}',
      'GET /exam-matrices/{id}/attribution',
      'GET /exam-matrices/{id}/availability',
      'GET /exam-matrices/{id}/generated-exams',
      'GET /exam-matrices/{id}/specification',
      'GET /exam-matrices/{id}/specification/export',
      'GET /exam-matrices/{id}/versions/{version}',
      'GET /exam-papers/banks/{bankId}/contributions',
      'GET /exam-papers/banks/{bankId}/dossiers',
      'GET /exam-papers/banks/{bankId}/exams',
      'GET /exam-papers/dossiers/mine',
      'GET /exam-papers/dossiers/{dossierId}',
      'GET /exam-papers/dossiers/{dossierId}/specification',
      'GET /exam-papers/dossiers/{dossierId}/specification/export',
      'GET /exam-papers/{id}',
      'GET /exam-papers/{id}/pins',
      'GET /exam-papers/{id}/print',
      'GET /exam-papers/{id}/specification',
      'GET /exam-papers/{id}/specification/export',
      'GET /exams/banks/{bankId}/contributions',
      'GET /exams/banks/{bankId}/dossiers',
      'GET /exams/banks/{bankId}/exams',
      'GET /exams/dossiers/mine',
      'GET /exams/dossiers/{dossierId}',
      'GET /exams/dossiers/{dossierId}/specification',
      'GET /exams/dossiers/{dossierId}/specification/export',
      'GET /exams/{id}',
      'GET /exams/{id}/pins',
      'GET /exams/{id}/print',
      'GET /exams/{id}/specification',
      'GET /exams/{id}/specification/export',
      'GET /question-banks',
      'GET /question-banks/matrix-contributions/mine',
      'GET /question-banks/{bankId}/matrices',
      'GET /question-banks/{bankId}/matrix-contributions',
      'GET /question-banks/{id}',
      'GET /question-banks/{id}/contributions',
      'PATCH /exam-matrices/{id}',
      'PATCH /exam-matrices/{id}/cells/{cellId}',
      'PATCH /exam-papers/{id}',
      'PATCH /exams/{id}',
      'POST /exam-matrices',
      'POST /exam-matrices/import',
      'POST /exam-matrices/import/preview',
      'POST /exam-matrices/{id}/cells',
      'POST /exam-matrices/{id}/contributions',
      'POST /exam-matrices/{id}/copy',
      'POST /exam-matrices/{id}/generate',
      'POST /exam-matrices/{id}/restore',
      'POST /exam-matrices/{id}/withdraw',
      'POST /exam-papers/banks/{bankId}/contributions',
      'POST /exam-papers/banks/{bankId}/contributions/{contributionId}/approve',
      'POST /exam-papers/banks/{bankId}/contributions/{contributionId}/board-approve',
      'POST /exam-papers/banks/{bankId}/contributions/{contributionId}/board-reject',
      'POST /exam-papers/banks/{bankId}/contributions/{contributionId}/reject',
      'POST /exam-papers/banks/{bankId}/exams',
      'POST /exam-papers/dossiers/{dossierId}/approve',
      'POST /exam-papers/dossiers/{dossierId}/board-approve',
      'POST /exam-papers/dossiers/{dossierId}/board-reject',
      'POST /exam-papers/dossiers/{dossierId}/reject',
      'POST /exam-papers/dossiers/{dossierId}/submit',
      'POST /exam-papers/{id}/copy',
      'POST /exam-papers/{id}/dossiers',
      'POST /exam-papers/{id}/restore',
      'POST /exam-papers/{id}/status',
      'POST /exam-papers/{id}/swap',
      'POST /exam-papers/{id}/withdraw',
      'POST /exams/banks/{bankId}/contributions',
      'POST /exams/banks/{bankId}/contributions/{contributionId}/approve',
      'POST /exams/banks/{bankId}/contributions/{contributionId}/board-approve',
      'POST /exams/banks/{bankId}/contributions/{contributionId}/board-reject',
      'POST /exams/banks/{bankId}/contributions/{contributionId}/reject',
      'POST /exams/banks/{bankId}/exams',
      'POST /exams/dossiers/{dossierId}/approve',
      'POST /exams/dossiers/{dossierId}/board-approve',
      'POST /exams/dossiers/{dossierId}/board-reject',
      'POST /exams/dossiers/{dossierId}/reject',
      'POST /exams/dossiers/{dossierId}/submit',
      'POST /exams/{id}/copy',
      'POST /exams/{id}/dossiers',
      'POST /exams/{id}/restore',
      'POST /exams/{id}/status',
      'POST /exams/{id}/swap',
      'POST /exams/{id}/withdraw',
      'POST /question-banks',
      'POST /question-banks/{bankId}/matrix-contributions/{contributionId}/approve',
      'POST /question-banks/{bankId}/matrix-contributions/{contributionId}/reject',
      'POST /question-banks/{id}/contributions',
      'POST /question-banks/{id}/contributions/{contributionId}/approve',
      'POST /question-banks/{id}/contributions/{contributionId}/reject',
      'PUT /exam-papers/{id}/slots',
      'PUT /exams/{id}/slots'

];

const EXPECTED_OWNERS: Record<string, string> = {
  'exam-matrices': 'ExamMatricesController',
  'question-banks': 'QuestionBanksController',
  exams: 'ExamsController',
  'exam-papers': 'ExamPapersAliasController',
};

function scanControllers(): { routes: string[]; owners: Map<string, Set<string>> } {
  const modulesDir = join(process.cwd(), 'src', 'modules');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.controller.ts')) files.push(path);
    }
  };
  walk(modulesDir);

  const parsePathSpec = (spec: string): string[] => {
    const trimmed = spec.trim();
    if (trimmed.startsWith('[')) return [...trimmed.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
    const single = trimmed.match(/^'([^']*)'$/);
    if (single) return [single[1] ?? ''];
    const obj = trimmed.match(/path:\s*(\[[^\]]*\]|'[^']*')/);
    return obj ? parsePathSpec(obj[1] ?? '') : [];
  };

  const routes: string[] = [];
  const owners = new Map<string, Set<string>>();
  const ctrlRe = /@Controller\((\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|'[^']*')\)(?:\s|\/\*[\s\S]*?\*\/|@\w+(?:\([^)]*\))?)*export class (\w+)/g;
  const methodRe = /@(Get|Post|Patch|Put|Delete|Options|Head)\(\s*(?:'([^']*)')?\s*\)/g;

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const classes: { spec: string; cls: string; start: number; bodyStart: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = ctrlRe.exec(text)) !== null) {
      classes.push({ spec: m[1] ?? '', cls: m[2] ?? '', start: m.index, bodyStart: ctrlRe.lastIndex });
    }
    for (let i = 0; i < classes.length; i++) {
      const current = classes[i];
      if (!current) continue;
      const end = i + 1 < classes.length ? classes[i + 1]?.start : text.length;
      const body = text.slice(current.bodyStart, end);
      const prefixes = parsePathSpec(current.spec);
      for (const prefix of prefixes) {
        if (!owners.has(prefix)) owners.set(prefix, new Set());
        owners.get(prefix)?.add(current.cls);
      }
      let mm: RegExpExecArray | null;
      methodRe.lastIndex = 0;
      while ((mm = methodRe.exec(body)) !== null) {
        const method = (mm[1] ?? '').toUpperCase();
        const sub = (mm[2] ?? '').replace(/^\/+|\/+$/g, '');
        for (const prefix of prefixes) {
          const raw = sub ? `${prefix}/${sub}` : prefix;
          const path = '/' + raw.split('/').map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s)).join('/');
          routes.push(`${method} ${path}`);
        }
      }
    }
  }
  return { routes, owners };
}

describe('Hợp đồng bảng route tĩnh (issue #345, #342, #343)', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    app = await createTestApp();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Giáo khoa API').setDescription('route table contract probe').setVersion('1.0').build(),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('bảng route các bề mặt đổi tên (issue #345): đúng 8 route canonical và 8 route alias', () => {
    const expected = [
      'POST /badges/{id}/copy',
      'POST /competencies/frameworks/{id}/copy',
      'POST /courses/{id}/copy',
      'POST /courses/{id}/sections/{sectionId}/copy',
      'POST /courses/{id}/modules/{cmId}/copy',
      'POST /users/{id}/reactivate',
      'GET /calendar/exports',
      'GET /courses/{courseId}/progress/reports',
      'POST /badges/{id}/duplicate',
      'POST /competencies/frameworks/{id}/duplicate',
      'POST /courses/{id}/duplicate',
      'POST /courses/{id}/sections/{sectionId}/duplicate',
      'POST /courses/{id}/modules/{cmId}/duplicate',
      'POST /users/{id}/unsuspend',
      'GET /calendar/export.ics',
      'GET /courses/{courseId}/progress/report.csv',
    ];

    const surfacePatterns = [
      /^\/badges\/\{[^}]+\}\/(copy|duplicate)$/,
      /^\/competencies\/frameworks\/\{[^}]+\}\/(copy|duplicate)$/,
      /^\/courses\/\{[^}]+\}\/(copy|duplicate)$/,
      /^\/courses\/\{[^}]+\}\/sections\/\{[^}]+\}\/(copy|duplicate)$/,
      /^\/courses\/\{[^}]+\}\/modules\/\{[^}]+\}\/(copy|duplicate)$/,
      /^\/users\/\{[^}]+\}\/(reactivate|unsuspend)$/,
      /^\/calendar\/(exports|export\.ics)$/,
      /^\/courses\/\{[^}]+\}\/progress\/(reports|report\.csv)$/,
    ];
    const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
    const actual: string[] = [];
    for (const [rawPath, pathItem] of Object.entries(document.paths ?? {})) {
      const path = rawPath.startsWith('/api/v1/') ? rawPath.slice('/api/v1'.length) : rawPath;
      if (!surfacePatterns.some((pattern) => pattern.test(path))) continue;
      for (const method of Object.keys(pathItem ?? {})) {
        if (httpMethods.has(method)) actual.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(actual.sort()).toEqual([...expected].sort());
  });

  it('bảng route bề mặt điểm (issue #342): đúng 13 route canonical và 12 route alias', () => {
    const expected = [
      'POST /courses/{courseId}/grade-items',
      'GET /courses/{courseId}/grade-items',
      'GET /courses/{courseId}/gradebook',
      'GET /courses/{courseId}/gradebook/report',
      'POST /courses/{courseId}/grade-exports',
      'PATCH /grade-items/{itemId}',
      'DELETE /grade-items/{itemId}',
      'POST /grade-items/{itemId}/grades',
      'PUT /grade-items/{itemId}/posting-policy',
      'POST /grade-items/{itemId}/publish',
      'POST /grade-items/{itemId}/unpublish',
      'GET /grade-items/{itemId}/users/{userId}/history',
      'PATCH /grades/{gradeId}',
      'POST /courses/{courseId}/grades/items',
      'GET /courses/{courseId}/grades/items',
      'GET /courses/{courseId}/grades/report',
      'POST /courses/{courseId}/grades/export/vnedu',
      'PATCH /courses/grades/items/{itemId}',
      'DELETE /courses/grades/items/{itemId}',
      'POST /courses/grades/items/{itemId}/grades',
      'PATCH /courses/grades/grades/{gradeId}',
      'PUT /courses/grades/items/{itemId}/posting-policy',
      'POST /courses/grades/items/{itemId}/publish',
      'POST /courses/grades/items/{itemId}/unpublish',
      'GET /courses/grades/items/{itemId}/users/{userId}/history',
    ];

    const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
    const actual: string[] = [];
    for (const [rawPath, pathItem] of Object.entries(document.paths ?? {})) {
      const path = rawPath.startsWith('/api/v1/') ? rawPath.slice('/api/v1'.length) : rawPath;
      const segments = path.split('/').filter(Boolean);
      const isGradesSurface = (path.startsWith('/courses/') || path.startsWith('/grade-items/') || path.startsWith('/grades/'))
        && (segments.some((segment) => ['grade-items', 'gradebook', 'grade-exports', 'grades'].includes(segment)) || path.includes('/grades/'));
      if (!isGradesSurface) continue;
      for (const method of Object.keys(pathItem ?? {})) {
        if (httpMethods.has(method)) actual.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(actual.sort()).toEqual([...expected].sort());
  });

  it('bảng route qua tài liệu OpenAPI của ba họ ngân hàng bằng đúng bảng trước khi hợp nhất (issue #343)', () => {
    const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
    const actual: string[] = [];
    for (const [rawPath, pathItem] of Object.entries(document.paths ?? {})) {
      const path = rawPath.startsWith('/api/v1/') ? rawPath.slice('/api/v1'.length) : rawPath;
      const first = path.split('/').filter(Boolean)[0] ?? '';
      if (!Object.hasOwn(EXPECTED_OWNERS, first)) continue;
      for (const method of Object.keys(pathItem ?? {})) {
        if (httpMethods.has(method)) actual.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(actual.sort()).toEqual([...EXPECTED_ROUTES].sort());
  });

  it('bảng route bề mặt duyệt đóng góp và bộ hồ sơ (issue #345, giai đoạn 2): đúng 4 canonical, 4 alias board-* và 8 route gương exam-papers', () => {
    const expected = [
      'POST /exams/banks/{bankId}/contributions/{contributionId}/approve',
      'POST /exams/banks/{bankId}/contributions/{contributionId}/reject',
      'POST /exams/dossiers/{dossierId}/approve',
      'POST /exams/dossiers/{dossierId}/reject',
      'POST /exams/banks/{bankId}/contributions/{contributionId}/board-approve',
      'POST /exams/banks/{bankId}/contributions/{contributionId}/board-reject',
      'POST /exams/dossiers/{dossierId}/board-approve',
      'POST /exams/dossiers/{dossierId}/board-reject',
      'POST /exam-papers/banks/{bankId}/contributions/{contributionId}/approve',
      'POST /exam-papers/banks/{bankId}/contributions/{contributionId}/reject',
      'POST /exam-papers/banks/{bankId}/contributions/{contributionId}/board-approve',
      'POST /exam-papers/banks/{bankId}/contributions/{contributionId}/board-reject',
      'POST /exam-papers/dossiers/{dossierId}/approve',
      'POST /exam-papers/dossiers/{dossierId}/reject',
      'POST /exam-papers/dossiers/{dossierId}/board-approve',
      'POST /exam-papers/dossiers/{dossierId}/board-reject',
    ];

    const surfacePatterns = [
      /^\/(exams|exam-papers)\/banks\/\{[^}]+\}\/contributions\/\{[^}]+\}\/(approve|reject|board-approve|board-reject)$/,
      /^\/(exams|exam-papers)\/dossiers\/\{[^}]+\}\/(approve|reject|board-approve|board-reject)$/,
    ];
    const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
    const actual: string[] = [];
    for (const [rawPath, pathItem] of Object.entries(document.paths ?? {})) {
      const path = rawPath.startsWith('/api/v1/') ? rawPath.slice('/api/v1'.length) : rawPath;
      if (!surfacePatterns.some((pattern) => pattern.test(path))) continue;
      for (const method of Object.keys(pathItem ?? {})) {
        if (httpMethods.has(method)) actual.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(actual.sort()).toEqual([...expected].sort());
  });
});

describe('Hợp đồng bảng route tĩnh — phép quét tĩnh cây nguồn (issue #343)', () => {
  it('mỗi tiền tố của ba họ ngân hàng có đúng một lớp controller sở hữu (issue #343)', () => {
    const { owners } = scanControllers();
    for (const [prefix, expectedClass] of Object.entries(EXPECTED_OWNERS)) {
      expect([...(owners.get(prefix) ?? [])]).toEqual([expectedClass]);
    }
  });

  it('bảng route quét tĩnh từ khai báo controller của ba họ ngân hàng bằng đúng bảng trước khi hợp nhất (issue #343)', () => {
    const { routes } = scanControllers();
    const familyRoutes = routes.filter((r) => {
      const first = r.split(' ')[1]?.split('/')[1] ?? '';
      return Object.hasOwn(EXPECTED_OWNERS, first);
    });
    expect(familyRoutes.sort()).toEqual([...EXPECTED_ROUTES].sort());
  });
});
