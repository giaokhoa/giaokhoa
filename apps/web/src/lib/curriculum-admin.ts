/**
 * Tầng quản trị chương trình (F-01 của rà soát #133) — tách từ
 * `lib/curriculum.ts` (S30): trang quản trị chương trình + các màn
 * riêng (môn, chương trình, node, YCCĐ, cây) đọc/ghi qua các hook
 * dưới đây. Mọi đột biến làm mới đúng cụm khoá bị ảnh hưởng: danh
 * sách môn/cây theo tiền tố có phạm vi, trạng thái dataset và danh
 * sách sách theo khoá của chúng.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiJson } from '#lib/api';
import { queryKeys } from '#lib/query-keys';
import { fetchSystemContextId, type Curriculum, type CurriculumSubject } from './curriculum-core';

/** Trạng thái nạp của một dataset chương trình chuẩn trong manifest phía máy chủ. */
export interface ProgramDatasetStatus {
  datasetKey: string;
  subjectName: string;
  slug: string;
  grades: number[];
  totalRecords: number;
  importedRecords: number;
  subjectId: string | null;
  lastImportedAt: string | null;
}

/** Trạng thái các dataset chương trình chuẩn (GET /curriculum/program-import). */
export async function fetchProgramDatasetStatus(): Promise<ProgramDatasetStatus[]> {
  return apiJson<ProgramDatasetStatus[]>('/api/v1/curriculum/program-import');
}

/** Tuỳ chọn truy vấn trạng thái dataset chương trình chuẩn. */
export function programDatasetStatusQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.programDatasetStatus,
    queryFn: () => fetchProgramDatasetStatus(),
  });
}

/** Hook đọc trạng thái dataset chương trình cho trang quản trị. */
export function useProgramDatasetStatus() {
  return useQuery(programDatasetStatusQueryOptions());
}

/** Tuỳ chọn truy vấn một môn theo id (GET /curriculum/subjects/:id). */
export function curriculumSubjectRowQueryOptions(subjectId: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumSubjectRow(subjectId),
    queryFn: () => apiJson<CurriculumSubject>(`/api/v1/curriculum/subjects/${subjectId}`),
  });
}

/** Hook đọc một môn cho màn sửa môn; lỗi tải nổi lên query (màn giữ trạng thái đang tải như trước). */
export function useCurriculumSubjectRow(subjectId: string | undefined) {
  return useQuery({
    ...curriculumSubjectRowQueryOptions(subjectId ?? ''),
    enabled: subjectId !== undefined,
  });
}

/** Tuỳ chọn truy vấn một chương trình theo id (GET /curriculum/curricula/:id). */
export function curriculumRowQueryOptions(curriculumId: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumRow(curriculumId),
    queryFn: () => apiJson<Curriculum>(`/api/v1/curriculum/curricula/${curriculumId}`),
  });
}

/** Hook đọc một chương trình cho màn sửa chương trình. */
export function useCurriculumRow(curriculumId: string | undefined) {
  return useQuery({
    ...curriculumRowQueryOptions(curriculumId ?? ''),
    enabled: curriculumId !== undefined,
  });
}

/** Một node chương trình theo hình dạng các màn node/YCCĐ tiêu thụ (GET /curriculum/nodes/:id). */
export interface CurriculumNodeRow {
  id: string;
  curriculumId: string;
  parentId: string | null;
  title: string;
  kind: string;
  position: number;
  durationPeriods: number | null;
  durationPercent: number | null;
}

/** Tuỳ chọn truy vấn một node theo id. */
export function curriculumNodeQueryOptions(nodeId: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumNode(nodeId),
    queryFn: () => apiJson<CurriculumNodeRow>(`/api/v1/curriculum/nodes/${nodeId}`),
  });
}

/** Hook đọc một node cho các màn sửa node và tạo/sửa YCCĐ. */
export function useCurriculumNode(nodeId: string | undefined) {
  return useQuery({
    ...curriculumNodeQueryOptions(nodeId ?? ''),
    enabled: nodeId !== undefined,
  });
}

/** Một YCCĐ theo hình dạng màn sửa YCCĐ tiêu thụ (GET /curriculum/outcomes/:id). */
export interface CurriculumOutcomeRow {
  id: string;
  nodeId: string;
  content: string;
  position: number;
  sourceKind: string;
  sourceRef: string | null;
  derivedFromId: string | null;
}

/** Tuỳ chọn truy vấn một YCCĐ theo id. */
export function curriculumOutcomeQueryOptions(outcomeId: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumOutcome(outcomeId),
    queryFn: () => apiJson<CurriculumOutcomeRow>(`/api/v1/curriculum/outcomes/${outcomeId}`),
  });
}

/** Hook đọc một YCCĐ cho màn sửa YCCĐ. */
export function useCurriculumOutcome(outcomeId: string | undefined) {
  return useQuery({
    ...curriculumOutcomeQueryOptions(outcomeId ?? ''),
    enabled: outcomeId !== undefined,
  });
}

/** Tiền tố khoá của mọi danh sách môn theo ngữ cảnh (để làm mới sau đột biến quản trị). */
const SUBJECTS_SCOPED_PREFIX = ['curriculum', 'subjects', 'scoped'] as const;
/** Tiền tố khoá của mọi danh sách chương trình theo môn (để làm mới sau đột biến quản trị). */
const CURRICULA_SCOPED_PREFIX = ['curriculum', 'curricula', 'scoped'] as const;
/** Tiền tố khoá của mọi cây chương trình (để làm mới sau đột biến quản trị). */
const TREE_SCOPED_PREFIX = ['curriculum', 'tree', 'scoped'] as const;

/** Kết quả một lượt đồng bộ dataset chương trình (POST /curriculum/program-import). */
export interface ProgramImportResult {
  created: number;
  updated: number;
  skipped: number;
  outcomesWritten: number;
  totalRecords: number;
  orphanedNodes: number;
  retiredOutcomes: number;
  changeCounts: { textChanged: number; added: number; removed: number; moved: number; revived: number; shiftSuspected: number };
  changes: {
    recordId: string;
    position: number;
    kind: 'text-changed' | 'added' | 'removed' | 'moved' | 'revived';
    oldText?: string;
    newText?: string;
    shiftSuspected?: boolean;
    identicalTextAmbiguous?: boolean;
    linkedQuestions?: number;
    linkedBookMappings?: number;
  }[];
  changesOmitted: number;
}

/** Đột biến chỉ làm mới cache của tầng curriculum — theo mẫu `useGradeMutation` ở grades: thành công thì invalidate đúng các khoá truyền vào (khoá cố định, hoặc dựng từ đáp ứng/biến khi khoá phụ thuộc chúng, ví dụ cây chứa node vừa sửa). */
function useCurriculumMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  keysToInvalidate: readonly unknown[][] | ((data: TData, vars: TVars) => readonly unknown[][]),
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data, vars) => {
      const keys = typeof keysToInvalidate === 'function' ? keysToInvalidate(data, vars) : keysToInvalidate;
      for (const key of keys) void client.invalidateQueries({ queryKey: key as readonly unknown[] });
    },
  });
}

/**
 * Đột biến đồng bộ một dataset chương trình chuẩn vào cây (POST
 * /curriculum/program-import, idempotent phía API) — thành công thì
 * làm mới trạng thái dataset, danh sách môn và mọi cây.
 */
export function useImportProgramDataset() {
  return useCurriculumMutation(
    (datasetKey: string) =>
      apiJson<ProgramImportResult>('/api/v1/curriculum/program-import', {
        method: 'POST',
        body: JSON.stringify({ datasetKey }),
      }),
    [queryKeys.programDatasetStatus, SUBJECTS_SCOPED_PREFIX, TREE_SCOPED_PREFIX],
  );
}

/** Kết quả một lượt đồng bộ dataset SGK (POST /books/dataset-import). */
export interface BookImportResult {
  created: number;
  updated: number;
  skipped: number;
  mappingsWritten: number;
  totalRecords: number;
}

/**
 * Đột biến đồng bộ một dataset SGK vào cây sách + ánh xạ (POST
 * /books/dataset-import, idempotent phía API) — thành công thì làm
 * mới trạng thái dataset sách và danh sách sách.
 */
export function useImportBookDataset() {
  return useCurriculumMutation(
    (datasetKey: string) =>
      apiJson<BookImportResult>('/api/v1/books/dataset-import', {
        method: 'POST',
        body: JSON.stringify({ datasetKey }),
      }),
    [queryKeys.bookDatasetStatus, queryKeys.books, queryKeys.booksRoot],
  );
}

/** Đột biến xoá một môn (DELETE /curriculum/subjects/:id, cascade toàn bộ chương trình của môn). */
export function useDeleteCurriculumSubject() {
  return useCurriculumMutation(
    (subjectId: string) => apiJson(`/api/v1/curriculum/subjects/${subjectId}`, { method: 'DELETE' }),
    [SUBJECTS_SCOPED_PREFIX, queryKeys.curriculumSubjects],
  );
}

/** Đột biến xoá một chương trình (DELETE /curriculum/curricula/:id, cascade cây node + YCCĐ của khối đó). */
export function useDeleteCurriculumRow() {
  return useCurriculumMutation(
    (curriculumId: string) => apiJson(`/api/v1/curriculum/curricula/${curriculumId}`, { method: 'DELETE' }),
    [CURRICULA_SCOPED_PREFIX, queryKeys.curriculaRoot],
  );
}

/**
 * Đột biến tạo môn mới (POST /curriculum/subjects): môn neo ở context
 * hệ thống nên trước hết tra id context đó qua tầng contexts — giữ
 * nguyên hai bước như bản thủ công của form môn.
 */
export function useCreateCurriculumSubject() {
  return useCurriculumMutation(
    async (body: { name: string; slug: string; position: number }) => {
      const contextId = await fetchSystemContextId();
      if (!contextId) throw new Error('no system context');
      return apiJson<CurriculumSubject>('/api/v1/curriculum/subjects', {
        method: 'POST',
        body: JSON.stringify({ contextId, ...body }),
      });
    },
    [SUBJECTS_SCOPED_PREFIX, queryKeys.curriculumSubjects],
  );
}

/** Đột biến sửa môn (PATCH /curriculum/subjects/:id). */
export function useUpdateCurriculumSubject() {
  return useCurriculumMutation(
    ({ subjectId, body }: { subjectId: string; body: { name: string; slug: string; position: number } }) =>
      apiJson<CurriculumSubject>(`/api/v1/curriculum/subjects/${subjectId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    (_data, vars) => [SUBJECTS_SCOPED_PREFIX, queryKeys.curriculumSubjects, queryKeys.curriculumSubjectRow(vars.subjectId)],
  );
}

/** Đột biến tạo chương trình cho một môn (POST /curriculum/curricula). */
export function useCreateCurriculumRow() {
  return useCurriculumMutation(
    (body: { subjectId: string | undefined; grade: number }) =>
      apiJson<Curriculum>('/api/v1/curriculum/curricula', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    [CURRICULA_SCOPED_PREFIX, queryKeys.curriculaRoot],
  );
}

/** Đột biến sửa khối của một chương trình (PATCH /curriculum/curricula/:id). */
export function useUpdateCurriculumRow() {
  return useCurriculumMutation(
    ({ curriculumId, grade }: { curriculumId: string; grade: number }) =>
      apiJson<Curriculum>(`/api/v1/curriculum/curricula/${curriculumId}`, {
        method: 'PATCH',
        body: JSON.stringify({ grade }),
      }),
    (_data, vars) => [CURRICULA_SCOPED_PREFIX, queryKeys.curriculaRoot, queryKeys.curriculumRow(vars.curriculumId)],
  );
}

/** Thân ghi của một node chương trình (tạo/sửa dùng chung một hình dạng). */
export interface CurriculumNodePayload {
  title: string;
  kind: string;
  parentId: string | null;
  position: number;
  durationPeriods: number | null;
  durationPercent: number | null;
}

/** Đột biến tạo node (POST /curriculum/nodes) — thành công thì làm mới cây chứa node. */
export function useCreateCurriculumNode() {
  return useCurriculumMutation(
    ({ curriculumId, payload }: { curriculumId: string; payload: CurriculumNodePayload }) =>
      apiJson<CurriculumNodeRow>('/api/v1/curriculum/nodes', {
        method: 'POST',
        body: JSON.stringify({ curriculumId, ...payload }),
      }),
    (_data, vars) => [queryKeys.curriculumTreeScoped(vars.curriculumId, null), queryKeys.curriculumTreeRoot],
  );
}

/** Đột biến sửa node (PATCH /curriculum/nodes/:id) — thành công thì làm mới cây chứa node và chính node. */
export function useUpdateCurriculumNode() {
  return useCurriculumMutation(
    ({ nodeId, payload }: { nodeId: string; payload: CurriculumNodePayload }) =>
      apiJson<CurriculumNodeRow>(`/api/v1/curriculum/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    (data, vars) => [
      queryKeys.curriculumTreeScoped(data.curriculumId, null),
      queryKeys.curriculumTreeRoot,
      queryKeys.curriculumNode(vars.nodeId),
    ],
  );
}

/** Đột biến xoá node (DELETE /curriculum/nodes/:id) ở trang cây — thành công thì làm mới cây đó. */
export function useDeleteCurriculumNode() {
  return useCurriculumMutation(
    (nodeId: string) => apiJson(`/api/v1/curriculum/nodes/${nodeId}`, { method: 'DELETE' }),
    [TREE_SCOPED_PREFIX, queryKeys.curriculumTreeRoot],
  );
}

/** Thân ghi của một YCCĐ (tạo/sửa dùng chung một hình dạng). */
export interface CurriculumOutcomePayload {
  content: string;
  position: number;
  sourceKind: string;
  sourceRef: string | null;
  derivedFromId: string | null;
}

/** Đột biến tạo YCCĐ cho một node (POST /curriculum/outcomes) — YCCĐ hiện trong cây nên làm mới mọi cây. */
export function useCreateCurriculumOutcome() {
  return useCurriculumMutation(
    ({ nodeId, payload }: { nodeId: string; payload: CurriculumOutcomePayload }) =>
      apiJson<CurriculumOutcomeRow>('/api/v1/curriculum/outcomes', {
        method: 'POST',
        body: JSON.stringify({ nodeId, ...payload }),
      }),
    [TREE_SCOPED_PREFIX, queryKeys.curriculumTreeRoot],
  );
}

/** Đột biến sửa YCCĐ (PATCH /curriculum/outcomes/:id). */
export function useUpdateCurriculumOutcome() {
  return useCurriculumMutation(
    ({ outcomeId, payload }: { outcomeId: string; payload: CurriculumOutcomePayload }) =>
      apiJson<CurriculumOutcomeRow>(`/api/v1/curriculum/outcomes/${outcomeId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    (_data, vars) => [TREE_SCOPED_PREFIX, queryKeys.curriculumTreeRoot, queryKeys.curriculumOutcome(vars.outcomeId)],
  );
}

/** Đột biến xoá YCCĐ (DELETE /curriculum/outcomes/:id) ở trang cây — thành công thì làm mới mọi cây. */
export function useDeleteCurriculumOutcome() {
  return useCurriculumMutation(
    (outcomeId: string) => apiJson(`/api/v1/curriculum/outcomes/${outcomeId}`, { method: 'DELETE' }),
    [TREE_SCOPED_PREFIX, queryKeys.curriculumTreeRoot],
  );
}
