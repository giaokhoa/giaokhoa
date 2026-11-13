import { describe, expect, it, vi } from 'vitest';
import { CurriculumService, toCurriculumOutcomeView } from './curriculum.service';
import type {
  CurriculumRepository, LearningOutcomeRow, SubjectRow,
} from '@giaokhoa/db/repositories/curriculum';
import type { ContextRow } from '@giaokhoa/db/repositories/access';
import type { ContextsService } from '../access/contexts.service';
import type { PermissionEvaluator } from '../access/permission-evaluator.service';
import type { CoursesService } from '../courses/courses.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';

/** Một dòng context đầy đủ hình dạng để mock ContextsService có kiểm tra kiểu (mock chỉ cần id thì không đủ kiểu ContextRow). */
function contextRow(id: string): ContextRow {
  return {
    id,
    contextLevel: CONTEXT_LEVELS.SYSTEM,
    instanceId: null,
    path: `/${id}`,
    depth: 1,
    locked: false,
    version: 1,
  };
}

/**
 * Liệt kê môn học khi `contextId` thành tùy chọn (điểm nghẽn D-3 của issue #233):
 *
 * - Vắng `contextId` thì service mặc định về context hệ thống qua
 *   `contextOrSystem`, thay vì để controller chặn 400 như trước.
 * - Cổng đọc giữ nguyên: vẫn phải có `curriculum:view` tại context đã
 *   phân giải, hoặc `course:update` tại khoá `forCourseId` — không nới quyền cho bất kỳ nhánh nào.
 * - Kèm `contextId` tường minh thì vẫn liệt kê đúng context đó, không
 *   bị mặc định hệ thống đè lên.
 */
describe('CurriculumService.listSubjects — contextId tùy chọn', () => {
  const SYSTEM_CTX = 'ctx-system';
  const COURSE_CTX = 'ctx-course';
  const OTHER_CTX = 'ctx-other';
  const SUBJECTS: SubjectRow[] = [
    {
      id: 'subject-1',
      contextId: SYSTEM_CTX,
      name: 'Toán',
      slug: 'toan',
      position: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];

  function buildService(options: { canViewSystem: boolean; canUpdateCourse: boolean; canViewOther?: boolean }) {
    // Mock từng phần có kiểm tra kiểu (satisfies): hình dạng mock sai thì vỡ lúc biên dịch, không đợi chạy test. Chỗ tiêm vào constructor vẫn cần ép kiểu vì service nhận dependency đầy đủ, còn mock chỉ phủ đúng method test dùng.
    const repo = {
      listSubjects: vi.fn(async (contextId: string) =>
        contextId === SYSTEM_CTX || contextId === OTHER_CTX ? SUBJECTS : [],
      ),
    } satisfies Pick<CurriculumRepository, 'listSubjects'>;
    const contexts = {
      getContext: vi.fn(async (id: string) => contextRow(id)),
      ensureSystemContext: vi.fn(async () => contextRow(SYSTEM_CTX)),
    } satisfies Pick<ContextsService, 'getContext' | 'ensureSystemContext'>;
    const evaluator = {
      hasCapability: vi.fn(async (_actorId: string, capability: string, contextId: string) => {
        if (capability === 'curriculum:view' && contextId === SYSTEM_CTX) return options.canViewSystem;
        if (capability === 'curriculum:view' && contextId === OTHER_CTX) return options.canViewOther ?? false;
        if (capability === 'course:update' && contextId === COURSE_CTX) return options.canUpdateCourse;
        return false;
      }),
      requireCapability: vi.fn(async () => {
        throw new Error('access.capability_denied');
      }),
    } satisfies Pick<PermissionEvaluator, 'hasCapability' | 'requireCapability'>;
    const courses = {
      courseContextId: vi.fn(async () => COURSE_CTX),
      registerCurriculumFrameProvider: vi.fn(),
    } satisfies Pick<CoursesService, 'courseContextId' | 'registerCurriculumFrameProvider'>;
    const service = new CurriculumService(
      repo as unknown as CurriculumRepository,
      contexts as unknown as ContextsService,
      evaluator as unknown as PermissionEvaluator,
      courses as unknown as CoursesService,
    );
    return { service, repo, contexts };
  }

  it('vắng contextId và có curriculum:view tại hệ thống thì liệt kê môn của context hệ thống', async () => {
    const { service, repo, contexts } = buildService({ canViewSystem: true, canUpdateCourse: false });
    await expect(service.listSubjects('teacher-1', undefined)).resolves.toEqual(SUBJECTS);
    expect(contexts.ensureSystemContext).toHaveBeenCalled();
    expect(repo.listSubjects).toHaveBeenCalledWith(SYSTEM_CTX);
  });

  it('vắng contextId nhưng có course:update tại khoá forCourseId thì vẫn đọc được qua nhánh khoá', async () => {
    const { service, repo } = buildService({ canViewSystem: false, canUpdateCourse: true });
    await expect(service.listSubjects('teacher-1', undefined, 'course-demo101')).resolves.toEqual(SUBJECTS);
    expect(repo.listSubjects).toHaveBeenCalledWith(SYSTEM_CTX);
  });

  it('vắng contextId và không có quyền nào thì vẫn bị chặn, không nới cổng', async () => {
    const { service, repo } = buildService({ canViewSystem: false, canUpdateCourse: false });
    await expect(service.listSubjects('teacher-1', undefined)).rejects.toThrow('access.capability_denied');
    expect(repo.listSubjects).not.toHaveBeenCalled();
  });

  it('kèm contextId tường minh thì liệt kê đúng context đó, không về hệ thống', async () => {
    const { service, repo } = buildService({ canViewSystem: false, canUpdateCourse: false, canViewOther: true });
    await expect(service.listSubjects('teacher-1', OTHER_CTX)).resolves.toEqual(SUBJECTS);
    expect(repo.listSubjects).toHaveBeenCalledWith(OTHER_CTX);
  });
});

/**
 * Lưu trữ YCCĐ dạng tài liệu Tiptap (jsonb) — hình dạng trả ra của tầng service: `content` luôn là text canonical trích từ tài liệu
 * (hợp đồng cũ cho mọi bề mặt), `contentDoc` là tài liệu gốc cho
 * bảng chương trình render phân cấp cha–con. Đường ghi tay qua API nhận text thuần phải gói thành tài liệu trước khi ghi — DB không bao giờ nhận text trần ở cột jsonb.
 */
describe('toCurriculumOutcomeView — text canonical + tài liệu gốc', () => {
  const docRow: LearningOutcomeRow = {
    id: 'outcome-1',
    tenantId: null,
    nodeId: 'node-1',
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Nêu được:' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ý con một.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ý con hai.' }] }] },
          ],
        },
      ],
    },
    position: 1,
    sourceKind: 'program',
    sourceRef: 'nguồn mẫu',
    derivedFromId: null,
    retiredAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('trả text canonical nối các dòng bằng xuống dòng, kèm nguyên tài liệu', () => {
    const view = toCurriculumOutcomeView(docRow);
    expect(view.content).toBe('Nêu được:\nÝ con một.\nÝ con hai.');
    expect(view.contentDoc).toEqual(docRow.content);
    expect(view.id).toBe('outcome-1');
  });

  it('tài liệu một đoạn văn cho đúng text của đoạn đó', () => {
    const view = toCurriculumOutcomeView({
      ...docRow,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Một ý duy nhất.' }] }] },
    });
    expect(view.content).toBe('Một ý duy nhất.');
  });
});

describe('CurriculumService.createOutcome — ghi tay gói text thành tài liệu', () => {
  it('repo nhận tài liệu (không nhận text trần) và trả về view có text canonical', async () => {
    const inserted: LearningOutcomeRow = {
      id: 'outcome-new', tenantId: null, nodeId: 'node-1',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dòng một.' }] }] },
      position: 1, sourceKind: 'program', sourceRef: null, derivedFromId: null, retiredAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    // Mock từng phần có kiểm tra kiểu (satisfies) như buildService ở trên — các dòng trả về phải đủ hình dạng dòng thật.
    const repo = {
      getNode: vi.fn(async () => ({
        id: 'node-1',
        curriculumId: 'curr-1',
        parentId: null,
        title: 'Node 1',
        kind: 'topic',
        position: 1,
        durationPeriods: null,
        durationPercent: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
      getCurriculum: vi.fn(async () => ({
        id: 'curr-1', subjectId: 'subj-1', grade: 1,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
      getSubject: vi.fn(async () => ({
        id: 'subj-1',
        contextId: 'ctx-sys',
        name: 'Toán',
        slug: 'toan',
        position: 1,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
      insertOutcome: vi.fn(async (_v: unknown) => inserted),
    } satisfies Pick<CurriculumRepository, 'getNode' | 'getCurriculum' | 'getSubject' | 'insertOutcome'>;
    const contexts = {
      getContext: vi.fn(async (id: string) => contextRow(id)),
      ensureSystemContext: vi.fn(async () => contextRow('ctx-sys')),
    } satisfies Pick<ContextsService, 'getContext' | 'ensureSystemContext'>;
    const evaluator = { requireCapability: vi.fn(async () => undefined) } satisfies Pick<PermissionEvaluator, 'requireCapability'>;
    const courses = { registerCurriculumFrameProvider: vi.fn() } satisfies Pick<CoursesService, 'registerCurriculumFrameProvider'>;
    const service = new CurriculumService(
      repo as unknown as CurriculumRepository,
      contexts as unknown as ContextsService,
      evaluator as unknown as PermissionEvaluator,
      courses as unknown as CoursesService,
    );
    const view = await service.createOutcome('admin-1', { nodeId: 'node-1', content: 'Dòng một.\nDòng hai.' });
    expect(repo.insertOutcome).toHaveBeenCalledTimes(1);
    const written = repo.insertOutcome.mock.calls[0][0] as { content: unknown };
    expect(written.content).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Dòng một.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Dòng hai.' }] },
      ],
    });
    expect(view.content).toBe('Dòng một.');
    expect(view.contentDoc).toEqual(inserted.content);
  });
});
