/**
 * Kiểu + lời gọi API dùng chung cho chương trình GDPT 2018 (K0a):
 * trang quản trị chương trình, khối chọn khung khi tạo khoá và panel nạp khung trong quản trị khoá cùng đọc một hình dạng cây. Chương trình quốc gia neo ở context hệ thống (contextLevel 10) — cùng cách khối Chương trình trong editor câu hỏi đang đọc.
 *
 * Phần cuối module là tầng TanStack Query (F-01 của rà soát #133) bọc đúng các lời gọi ở đây: các trang đọc chương trình qua hook với khoá theo (context/khoá) — ngữ cảnh khoá là một phần của khoá vì cùng một môn có thể đọc được hay bị 403 tuỳ khoá đang neo quyền.
 */

import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiJson } from '#lib/api';
import { CONTEXT_LEVEL } from '#lib/permissions';
import { queryKeys } from '#lib/query-keys';

export interface CurriculumSubject {
  id: string;
  contextId: string;
  name: string;
  slug: string;
  position: number;
}

/** Môn tối giản dùng cho các ô lọc, danh sách ma trận và ngân hàng câu hỏi. */
export type SubjectLite = Pick<CurriculumSubject, 'id' | 'name'>;

export interface Curriculum {
  id: string;
  subjectId: string;
  grade: number;
}

/**
 * Một node trong tài liệu Tiptap của một YCCĐ, đúng hình dạng tài liệu mà API lưu trong cột jsonb: đoạn văn mang text, danh sách gạch đầu dòng lồng mang các ý con. Marks trên node text được giữ nguyên khi lưu nhưng bị bỏ qua khi trích text canonical.
 */
export interface CurriculumOutcomeDocNode {
  type: string;
  text?: string;
  marks?: unknown[];
  content?: CurriculumOutcomeDocNode[];
}

/** Tài liệu Tiptap của một YCCĐ, API trả kèm text canonical ở `content`. */
export interface CurriculumOutcomeDoc {
  type: 'doc';
  content?: CurriculumOutcomeDocNode[];
}

export interface CurriculumOutcome {
  id: string;
  content: string;
  /** Tài liệu gốc để bảng chương trình render phân cấp cha–con; vắng khi bề mặt cũ chưa trả trường này. */
  contentDoc?: CurriculumOutcomeDoc;
  position: number;
  sourceKind: string;
  sourceRef: string | null;
  derivedFromId: string | null;
}

export interface CurriculumTreeNode {
  id: string;
  curriculumId: string;
  parentId: string | null;
  title: string;
  kind: string;
  position: number;
  durationPeriods: number | null;
  durationPercent: number | null;
  outcomes: CurriculumOutcome[];
  children: CurriculumTreeNode[];
}

export interface CurriculumTree {
  curriculum: Curriculum;
  subject: CurriculumSubject;
  nodes: CurriculumTreeNode[];
}

/** Id của context hệ thống (nơi neo cây chương trình quốc gia). */
export async function fetchSystemContextId(): Promise<string | null> {
  const contexts = await apiJson<{ id: string; contextLevel: number }[]>('/api/v1/access/contexts');
  return contexts.find((c) => c.contextLevel === CONTEXT_LEVEL.SYSTEM)?.id ?? null;
}

/**
 * Môn học trong context hệ thống. Kèm `forCourseId` (bề mặt chọn khung trong quản trị khoá): API còn chấp nhận nhánh course:update tại chính khoá đó cho giáo viên cấp khoá không có curriculum:view hệ thống. `contextId` vắng thì không kèm tham số — API mặc định về context hệ thống (điểm nghẽn D-3 của issue #233: trang /curriculum không còn bắt buộc đọc được `/access/contexts` mới xem được chương trình).
 */
export async function fetchSubjects(contextId?: string, forCourseId?: string): Promise<CurriculumSubject[]> {
  const params = new URLSearchParams();
  if (contextId) params.set('contextId', contextId);
  if (forCourseId) params.set('forCourseId', forCourseId);
  const query = params.toString();
  return apiJson<CurriculumSubject[]>(`/api/v1/curriculum/subjects${query ? `?${query}` : ''}`);
}

/**
 * Tuỳ chọn query môn dùng chung giữa ngân hàng câu hỏi và màn ma trận.
 * Giữ nguyên cache key không kèm context, thêm id khoá khi đọc theo quyền khoá.
 *
 * @param forCourseId - Khoá mở nhánh quyền đọc chương trình nếu có.
 * @returns Tuỳ chọn query theo key có sẵn của hệ thống.
 */
export function curriculumSubjectsQueryOptions(forCourseId?: string) {
  return queryOptions({
    queryKey: forCourseId ? [...queryKeys.curriculumSubjects, forCourseId] : queryKeys.curriculumSubjects,
    queryFn: (): Promise<SubjectLite[]> => fetchSubjects(undefined, forCourseId),
  });
}

/** Danh sách môn chỉ tải khi được phép; lỗi tải nổi lên query như trước. */
export function useCurriculumSubjects(enabled: boolean, forCourseId?: string) {
  return useQuery({ ...curriculumSubjectsQueryOptions(forCourseId), enabled });
}

/** Các chương trình (theo khối) của một môn. */
export async function fetchCurricula(subjectId: string, forCourseId?: string): Promise<Curriculum[]> {
  const params = new URLSearchParams({ subjectId });
  if (forCourseId) params.set('forCourseId', forCourseId);
  return apiJson<Curriculum[]>(`/api/v1/curriculum/curricula?${params}`);
}

/** Cây nội dung trọn vẹn của một chương trình. */
export async function fetchTree(curriculumId: string, forCourseId?: string): Promise<CurriculumTree> {
  const params = new URLSearchParams();
  if (forCourseId) params.set('forCourseId', forCourseId);
  const query = params.size > 0 ? `?${params}` : '';
  return apiJson<CurriculumTree>(`/api/v1/curriculum/curricula/${curriculumId}/tree${query}`);
}

/** Tuỳ chọn truy vấn môn chương trình trong context hệ thống kèm ngữ cảnh khoá. */
export function curriculumSubjectsScopedQueryOptions(contextId: string, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumSubjectsScoped(contextId, forCourseId ?? null),
    queryFn: () => fetchSubjects(contextId, forCourseId),
  });
}

/**
 * Hook đọc môn chương trình cho các bề mặt xem/nạp khung: chưa có
 * context hệ thống VÀ chưa có khoá thì chưa gọi API (trang tự suy
 * trạng thái rỗng); có khoá thì gọi ngay cả khi chưa đọc được context
 * hệ thống — API mặc định về hệ thống và mở nhánh theo khoá (trang
 * /curriculum không còn tắc vì 403 ở `/access/contexts`).
 * Lỗi (kể cả 403 thiếu quyền đọc) nổi lên query để trang xử lý.
 * `enabled` cho phép trang chờ thêm điều kiện riêng (ví dụ danh sách
 * khoá neo quyền xem phải về trước).
 */
export function useCurriculumSubjectsScoped(contextId: string | null, forCourseId?: string, enabled = true) {
  return useQuery({
    ...curriculumSubjectsScopedQueryOptions(contextId ?? '', forCourseId),
    enabled: enabled && (contextId !== null || forCourseId !== undefined),
  });
}

/** Tuỳ chọn truy vấn các chương trình của một môn kèm ngữ cảnh khoá. */
export function curriculumCurriculaScopedQueryOptions(subjectId: string, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumCurriculaScoped(subjectId, forCourseId ?? null),
    queryFn: () => fetchCurricula(subjectId, forCourseId),
  });
}

/** Hook đọc các chương trình (theo khối) của môn đang chọn; chưa chọn môn thì chưa gọi API. */
export function useCurriculumCurriculaScoped(subjectId: string, forCourseId?: string, enabled = true) {
  return useQuery({
    ...curriculumCurriculaScopedQueryOptions(subjectId, forCourseId),
    enabled: enabled && subjectId !== '',
  });
}

/** Tuỳ chọn truy vấn cây chương trình kèm ngữ cảnh khoá. */
export function curriculumTreeScopedQueryOptions(curriculumId: string, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumTreeScoped(curriculumId, forCourseId ?? null),
    queryFn: () => fetchTree(curriculumId, forCourseId),
  });
}

/** Hook đọc cây chương trình của chương trình đang chọn; chưa chọn thì chưa gọi API. */
export function useCurriculumTreeScoped(curriculumId: string, forCourseId?: string, enabled = true) {
  return useQuery({
    ...curriculumTreeScopedQueryOptions(curriculumId, forCourseId),
    enabled: enabled && curriculumId !== '',
  });
}

/** Tuỳ chọn truy vấn đơn vị khung chọn được của cặp (môn, khối) kèm ngữ cảnh khoá. */
export function curriculumFrameUnitsQueryOptions(subjectId: string, grade: number | null, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumFrameUnits(subjectId, grade, forCourseId ?? null),
    // Chưa chọn khối thì không có khung để chọn — trả rỗng như khi
    // không có chương trình cho khối đó (hook cũng tắt query lúc này).
    queryFn: () => grade === null
      ? Promise.resolve({ curriculumId: null as string | null, units: [] as FrameUnit[] })
      : fetchFrameUnitsFor(subjectId, grade, forCourseId),
  });
}

/**
 * Hook đọc đơn vị khung cho các bộ chọn khung (wizard tạo khoá, panel
 * nạp khung): chưa đủ (môn, khối) thì chưa gọi API và coi như chưa có
 * khung nào để chọn.
 */
export function useCurriculumFrameUnits(subjectId: string, grade: number | null, forCourseId?: string) {
  return useQuery({
    ...curriculumFrameUnitsQueryOptions(subjectId, grade, forCourseId),
    enabled: subjectId !== '' && grade !== null,
  });
}

/** Một đơn vị khung chọn được khi nạp khung vào khoá: node không phải `lesson` + số YCCĐ trong subtree. */
export interface FrameUnit {
  nodeId: string;
  title: string;
  kind: string;
  depth: number;
  outcomeCount: number;
  /**
   * YCCĐ của các bài (lesson) mà đơn vị này là tổ tiên-không-phải-lesson
   * gần nhất — để bề mặt chọn khung trình bày theo mẫu Bộ (Nội dung |
   * Yêu cầu cần đạt) mà không nhân bản một YCCĐ lên nhiều đơn vị tổ tiên.
   */
  outcomeTexts: { lesson: string; texts: string[] }[];
}

function countOutcomes(node: CurriculumTreeNode): number {
  return node.outcomes.length + node.children.reduce((n, c) => n + countOutcomes(c), 0);
}

/** Một đơn vị khung từ một node không phải `lesson` (dùng chung cho nút gốc và nút con khi làm phẳng cây). */
function makeFrameUnit(node: CurriculumTreeNode, depth: number): FrameUnit {
  return {
    nodeId: node.id, title: node.title, kind: node.kind, depth,
    outcomeCount: countOutcomes(node), outcomeTexts: [],
  };
}

/** Làm phẳng cây thành danh sách đơn vị khung theo thứ tự duyệt cây (cha trước con). */
export function flattenFrameUnits(nodes: CurriculumTreeNode[], depth = 0, out: FrameUnit[] = []): FrameUnit[] {
  for (const node of nodes) {
    let unit: FrameUnit | null = null;
    if (node.kind !== 'lesson') {
      unit = makeFrameUnit(node, depth);
      out.push(unit);
    }
    collectFrameUnits(node, depth, out, unit);
  }
  return out;
}

function collectFrameUnits(
  node: CurriculumTreeNode,
  depth: number,
  out: FrameUnit[],
  currentUnit: FrameUnit | null,
): void {
  for (const child of node.children) {
    if (child.kind === 'lesson') {
      if (currentUnit && child.outcomes.length > 0) {
        currentUnit.outcomeTexts.push({ lesson: child.title, texts: child.outcomes.map((o) => o.content) });
      }
      collectFrameUnits(child, depth + 1, out, currentUnit);
      continue;
    }
    const unit = makeFrameUnit(child, depth + 1);
    out.push(unit);
    collectFrameUnits(child, depth + 1, out, unit);
  }
}

/**
 * Đơn vị khung của cặp (môn, khối): không có chương trình cho khối đó
 * thì trả curriculumId null + danh sách rỗng (khoá vẫn tạo/nạp bình
 * thường, chỉ là chưa có khung để chọn).
 */
export async function fetchFrameUnitsFor(
  subjectId: string,
  grade: number,
  forCourseId?: string,
): Promise<{ curriculumId: string | null; units: FrameUnit[] }> {
  const curricula = await fetchCurricula(subjectId, forCourseId);
  const curriculum = curricula.find((c) => c.grade === grade);
  if (!curriculum) return { curriculumId: null, units: [] };
  const tree = await fetchTree(curriculum.id, forCourseId);
  return { curriculumId: curriculum.id, units: flattenFrameUnits(tree.nodes) };
}
