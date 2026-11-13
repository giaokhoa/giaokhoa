import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiJson } from '#lib/api';
import { queryKeys } from '#lib/query-keys';


export interface CurriculumSubject {
  id: string;
  contextId: string;
  name: string;
  slug: string;
  position: number;
}

export type SubjectLite = Pick<CurriculumSubject, 'id' | 'name'>;

export interface Curriculum {
  id: string;
  subjectId: string;
  grade: number;
}

export interface CurriculumOutcomeDocNode {
  type: string;
  text?: string;
  marks?: unknown[];
  content?: CurriculumOutcomeDocNode[];
}

export interface CurriculumOutcomeDoc {
  type: 'doc';
  content?: CurriculumOutcomeDocNode[];
}

export interface CurriculumOutcome {
  id: string;
  content: string;
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

export async function fetchSystemContextId(): Promise<string | null> {
  const contexts = await apiJson<{ id: string; contextLevel: number }[]>('/api/v1/access/contexts');
  return contexts.find((c) => c.contextLevel === 10)?.id ?? null;
}

export async function fetchSubjects(contextId?: string, forCourseId?: string): Promise<CurriculumSubject[]> {
  const params = new URLSearchParams();
  if (contextId) params.set('contextId', contextId);
  if (forCourseId) params.set('forCourseId', forCourseId);
  const query = params.toString();
  return apiJson<CurriculumSubject[]>(`/api/v1/curriculum/subjects${query ? `?${query}` : ''}`);
}

export function curriculumSubjectsQueryOptions(forCourseId?: string) {
  return queryOptions({
    queryKey: forCourseId ? [...queryKeys.curriculumSubjects, forCourseId] : queryKeys.curriculumSubjects,
    queryFn: (): Promise<SubjectLite[]> => fetchSubjects(undefined, forCourseId),
  });
}

export function useCurriculumSubjects(enabled: boolean, forCourseId?: string) {
  return useQuery({ ...curriculumSubjectsQueryOptions(forCourseId), enabled });
}

export async function fetchCurricula(subjectId: string, forCourseId?: string): Promise<Curriculum[]> {
  const frame = forCourseId ? `&forCourseId=${forCourseId}` : '';
  return apiJson<Curriculum[]>(`/api/v1/curriculum/curricula?subjectId=${subjectId}${frame}`);
}

export async function fetchTree(curriculumId: string, forCourseId?: string): Promise<CurriculumTree> {
  const frame = forCourseId ? `?forCourseId=${forCourseId}` : '';
  return apiJson<CurriculumTree>(`/api/v1/curriculum/curricula/${curriculumId}/tree${frame}`);
}

export function curriculumSubjectsScopedQueryOptions(contextId: string, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumSubjectsScoped(contextId, forCourseId ?? null),
    queryFn: () => fetchSubjects(contextId, forCourseId),
  });
}

export function useCurriculumSubjectsScoped(contextId: string | null, forCourseId?: string, enabled = true) {
  return useQuery({
    ...curriculumSubjectsScopedQueryOptions(contextId ?? '', forCourseId),
    enabled: enabled && (contextId !== null || forCourseId !== undefined),
  });
}

export function curriculumCurriculaScopedQueryOptions(subjectId: string, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumCurriculaScoped(subjectId, forCourseId ?? null),
    queryFn: () => fetchCurricula(subjectId, forCourseId),
  });
}

export function useCurriculumCurriculaScoped(subjectId: string, forCourseId?: string, enabled = true) {
  return useQuery({
    ...curriculumCurriculaScopedQueryOptions(subjectId, forCourseId),
    enabled: enabled && subjectId !== '',
  });
}

export function curriculumTreeScopedQueryOptions(curriculumId: string, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumTreeScoped(curriculumId, forCourseId ?? null),
    queryFn: () => fetchTree(curriculumId, forCourseId),
  });
}

export function useCurriculumTreeScoped(curriculumId: string, forCourseId?: string, enabled = true) {
  return useQuery({
    ...curriculumTreeScopedQueryOptions(curriculumId, forCourseId),
    enabled: enabled && curriculumId !== '',
  });
}

export function curriculumFrameUnitsQueryOptions(subjectId: string, grade: number, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumFrameUnits(subjectId, grade, forCourseId ?? null),
    queryFn: () => fetchFrameUnitsFor(subjectId, grade, forCourseId),
  });
}

export function useCurriculumFrameUnits(subjectId: string, grade: number | null, forCourseId?: string) {
  return useQuery({
    ...curriculumFrameUnitsQueryOptions(subjectId, grade ?? 0, forCourseId),
    enabled: subjectId !== '' && grade !== null,
  });
}

export interface FrameUnit {
  nodeId: string;
  title: string;
  kind: string;
  depth: number;
  outcomeCount: number;
  outcomeTexts: { lesson: string; texts: string[] }[];
}

function countOutcomes(node: CurriculumTreeNode): number {
  return node.outcomes.length + node.children.reduce((n, c) => n + countOutcomes(c), 0);
}

export function flattenFrameUnits(nodes: CurriculumTreeNode[], depth = 0, out: FrameUnit[] = []): FrameUnit[] {
  for (const node of nodes) {
    let unit: FrameUnit | null = null;
    if (node.kind !== 'lesson') {
      unit = {
        nodeId: node.id, title: node.title, kind: node.kind, depth,
        outcomeCount: countOutcomes(node), outcomeTexts: [],
      };
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
    const unit: FrameUnit = {
      nodeId: child.id, title: child.title, kind: child.kind, depth: depth + 1,
      outcomeCount: countOutcomes(child), outcomeTexts: [],
    };
    out.push(unit);
    collectFrameUnits(child, depth + 1, out, unit);
  }
}

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


export interface BookDatasetStatus {
  datasetKey: string;
  subjectName: string;
  slug: string;
  bookTitle: string;
  grade: number;
  totalRecords: number;
  importedRecords: number;
  mappedRecords: number;
  bookId: string | null;
  subjectId: string | null;
  lastImportedAt: string | null;
}

export interface Book {
  id: string;
  kind: string;
  title: string;
  subjectId: string | null;
  grade: number | null;
  series: string | null;
  author: string | null;
  publisher: string | null;
  publishedYear: number | null;
  isbn: string | null;
  attributionPublic: boolean;
  position: number;
}

export interface BookMappingView {
  curriculumNodeId: string | null;
  learningOutcomeId: string | null;
  programRecordId: string | null;
  targetTitle: string | null;
}

export interface BookLessonView {
  id: string;
  title: string;
  volume: number | null;
  lessonNumber: number | null;
  position: number;
  recordId: string | null;
  mappings: BookMappingView[];
  outcomes: { outcomeId: string; content: string }[];
}

export interface BookTree {
  book: Book;
  subject: { id: string; name: string; slug: string } | null;
  chapters: {
    id: string;
    title: string;
    volume: number | null;
    position: number;
    lessons: BookLessonView[];
  }[];
}

export async function fetchBookDatasetStatus(): Promise<BookDatasetStatus[]> {
  return apiJson<BookDatasetStatus[]>('/api/v1/books/dataset-import');
}

export async function fetchBooks(subjectId?: string, forCourseId?: string): Promise<Book[]> {
  const params = new URLSearchParams();
  if (subjectId) params.set('subjectId', subjectId);
  if (forCourseId) params.set('forCourseId', forCourseId);
  const query = params.toString();
  return apiJson<Book[]>(`/api/v1/books${query ? `?${query}` : ''}`);
}

export async function fetchBookTree(bookId: string, forCourseId?: string): Promise<BookTree> {
  const frame = forCourseId ? `?forCourseId=${forCourseId}` : '';
  return apiJson<BookTree>(`/api/v1/books/${bookId}/tree${frame}`);
}

export interface BookFrameChapter {
  nodeId: string;
  title: string;
  lessonCount: number;
  outcomeCount: number;
}


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

export async function fetchProgramDatasetStatus(): Promise<ProgramDatasetStatus[]> {
  return apiJson<ProgramDatasetStatus[]>('/api/v1/curriculum/program-import');
}

export function programDatasetStatusQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.programDatasetStatus,
    queryFn: () => fetchProgramDatasetStatus(),
  });
}

export function useProgramDatasetStatus() {
  return useQuery(programDatasetStatusQueryOptions());
}

export function bookDatasetStatusQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.bookDatasetStatus,
    queryFn: () => fetchBookDatasetStatus(),
  });
}

export function useBookDatasetStatus() {
  return useQuery(bookDatasetStatusQueryOptions());
}

export function booksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.books,
    queryFn: () => fetchBooks(),
  });
}

export function useBooks() {
  return useQuery(booksQueryOptions());
}

export function bookTreeQueryOptions(bookId: string) {
  return queryOptions({
    queryKey: queryKeys.bookTree(bookId),
    queryFn: () => fetchBookTree(bookId),
  });
}

export function useBookTree(bookId: string, enabled: boolean) {
  return useQuery({ ...bookTreeQueryOptions(bookId), enabled });
}

export function curriculumSubjectRowQueryOptions(subjectId: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumSubjectRow(subjectId),
    queryFn: () => apiJson<CurriculumSubject>(`/api/v1/curriculum/subjects/${subjectId}`),
  });
}

export function useCurriculumSubjectRow(subjectId: string | undefined) {
  return useQuery({
    ...curriculumSubjectRowQueryOptions(subjectId ?? ''),
    enabled: subjectId !== undefined,
  });
}

export function curriculumRowQueryOptions(curriculumId: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumRow(curriculumId),
    queryFn: () => apiJson<Curriculum>(`/api/v1/curriculum/curricula/${curriculumId}`),
  });
}

export function useCurriculumRow(curriculumId: string | undefined) {
  return useQuery({
    ...curriculumRowQueryOptions(curriculumId ?? ''),
    enabled: curriculumId !== undefined,
  });
}

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

export function curriculumNodeQueryOptions(nodeId: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumNode(nodeId),
    queryFn: () => apiJson<CurriculumNodeRow>(`/api/v1/curriculum/nodes/${nodeId}`),
  });
}

export function useCurriculumNode(nodeId: string | undefined) {
  return useQuery({
    ...curriculumNodeQueryOptions(nodeId ?? ''),
    enabled: nodeId !== undefined,
  });
}

export interface CurriculumOutcomeRow {
  id: string;
  nodeId: string;
  content: string;
  position: number;
  sourceKind: string;
  sourceRef: string | null;
  derivedFromId: string | null;
}

export function curriculumOutcomeQueryOptions(outcomeId: string) {
  return queryOptions({
    queryKey: queryKeys.curriculumOutcome(outcomeId),
    queryFn: () => apiJson<CurriculumOutcomeRow>(`/api/v1/curriculum/outcomes/${outcomeId}`),
  });
}

export function useCurriculumOutcome(outcomeId: string | undefined) {
  return useQuery({
    ...curriculumOutcomeQueryOptions(outcomeId ?? ''),
    enabled: outcomeId !== undefined,
  });
}

const SUBJECTS_SCOPED_PREFIX = ['curriculum', 'subjects', 'scoped'] as const;
const CURRICULA_SCOPED_PREFIX = ['curriculum', 'curricula', 'scoped'] as const;
const TREE_SCOPED_PREFIX = ['curriculum', 'tree', 'scoped'] as const;

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

export function useImportProgramDataset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (datasetKey: string) =>
      apiJson<ProgramImportResult>('/api/v1/curriculum/program-import', {
        method: 'POST',
        body: JSON.stringify({ datasetKey }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.programDatasetStatus });
      void client.invalidateQueries({ queryKey: SUBJECTS_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: TREE_SCOPED_PREFIX });
    },
  });
}

export interface BookImportResult {
  created: number;
  updated: number;
  skipped: number;
  mappingsWritten: number;
  totalRecords: number;
}

export function useImportBookDataset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (datasetKey: string) =>
      apiJson<BookImportResult>('/api/v1/books/dataset-import', {
        method: 'POST',
        body: JSON.stringify({ datasetKey }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.bookDatasetStatus });
      void client.invalidateQueries({ queryKey: queryKeys.books });
      void client.invalidateQueries({ queryKey: queryKeys.booksRoot });
    },
  });
}

export function useDeleteCurriculumSubject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (subjectId: string) =>
      apiJson(`/api/v1/curriculum/subjects/${subjectId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: SUBJECTS_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumSubjects });
    },
  });
}

export function useDeleteCurriculumRow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (curriculumId: string) =>
      apiJson(`/api/v1/curriculum/curricula/${curriculumId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CURRICULA_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculaRoot });
    },
  });
}

export function useCreateCurriculumSubject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; slug: string; position: number }) => {
      const contextId = await fetchSystemContextId();
      if (!contextId) throw new Error('no system context');
      return apiJson<CurriculumSubject>('/api/v1/curriculum/subjects', {
        method: 'POST',
        body: JSON.stringify({ contextId, ...body }),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: SUBJECTS_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumSubjects });
    },
  });
}

export function useUpdateCurriculumSubject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ subjectId, body }: { subjectId: string; body: { name: string; slug: string; position: number } }) =>
      apiJson<CurriculumSubject>(`/api/v1/curriculum/subjects/${subjectId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({ queryKey: SUBJECTS_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumSubjects });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumSubjectRow(vars.subjectId) });
    },
  });
}

export function useCreateCurriculumRow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { subjectId: string | undefined; grade: number }) =>
      apiJson<Curriculum>('/api/v1/curriculum/curricula', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CURRICULA_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculaRoot });
    },
  });
}

export function useUpdateCurriculumRow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ curriculumId, grade }: { curriculumId: string; grade: number }) =>
      apiJson<Curriculum>(`/api/v1/curriculum/curricula/${curriculumId}`, {
        method: 'PATCH',
        body: JSON.stringify({ grade }),
      }),
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({ queryKey: CURRICULA_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculaRoot });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumRow(vars.curriculumId) });
    },
  });
}

export interface CurriculumNodePayload {
  title: string;
  kind: string;
  parentId: string | null;
  position: number;
  durationPeriods: number | null;
  durationPercent: number | null;
}

export function useCreateCurriculumNode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ curriculumId, payload }: { curriculumId: string; payload: CurriculumNodePayload }) =>
      apiJson<CurriculumNodeRow>('/api/v1/curriculum/nodes', {
        method: 'POST',
        body: JSON.stringify({ curriculumId, ...payload }),
      }),
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({
        queryKey: queryKeys.curriculumTreeScoped(vars.curriculumId, null),
      });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumTreeRoot });
    },
  });
}

export function useUpdateCurriculumNode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, payload }: { nodeId: string; payload: CurriculumNodePayload }) =>
      apiJson<CurriculumNodeRow>(`/api/v1/curriculum/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data, vars) => {
      void client.invalidateQueries({
        queryKey: queryKeys.curriculumTreeScoped(data.curriculumId, null),
      });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumTreeRoot });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumNode(vars.nodeId) });
    },
  });
}

export function useDeleteCurriculumNode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) => apiJson(`/api/v1/curriculum/nodes/${nodeId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: TREE_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumTreeRoot });
    },
  });
}

export interface CurriculumOutcomePayload {
  content: string;
  position: number;
  sourceKind: string;
  sourceRef: string | null;
  derivedFromId: string | null;
}

export function useCreateCurriculumOutcome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, payload }: { nodeId: string; payload: CurriculumOutcomePayload }) =>
      apiJson<CurriculumOutcomeRow>('/api/v1/curriculum/outcomes', {
        method: 'POST',
        body: JSON.stringify({ nodeId, ...payload }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: TREE_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumTreeRoot });
    },
  });
}

export function useUpdateCurriculumOutcome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ outcomeId, payload }: { outcomeId: string; payload: CurriculumOutcomePayload }) =>
      apiJson<CurriculumOutcomeRow>(`/api/v1/curriculum/outcomes/${outcomeId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({ queryKey: TREE_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumTreeRoot });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumOutcome(vars.outcomeId) });
    },
  });
}

export function useDeleteCurriculumOutcome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (outcomeId: string) =>
      apiJson(`/api/v1/curriculum/outcomes/${outcomeId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: TREE_SCOPED_PREFIX });
      void client.invalidateQueries({ queryKey: queryKeys.curriculumTreeRoot });
    },
  });
}

export async function fetchBookFrameChaptersFor(
  subjectId: string,
  grade: number,
  forCourseId?: string,
): Promise<{ bookId: string | null; chapters: BookFrameChapter[] }> {
  const books = await fetchBooks(subjectId, forCourseId);
  const book = books.find((b) => b.grade === grade);
  if (!book) return { bookId: null, chapters: [] };
  const tree = await fetchBookTree(book.id, forCourseId);
  return {
    bookId: book.id,
    chapters: tree.chapters.map((chapter) => {
      const outcomeIds = new Set<string>();
      for (const lesson of chapter.lessons) {
        for (const outcome of lesson.outcomes) outcomeIds.add(outcome.outcomeId);
      }
      return {
        nodeId: chapter.id,
        title: chapter.title,
        lessonCount: chapter.lessons.length,
        outcomeCount: outcomeIds.size,
      };
    }),
  };
}

export function bookFrameChaptersQueryOptions(subjectId: string, grade: number, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.bookFrameChapters(subjectId, grade, forCourseId ?? null),
    queryFn: () => fetchBookFrameChaptersFor(subjectId, grade, forCourseId),
  });
}

export function useBookFrameChapters(subjectId: string, grade: number | null, forCourseId?: string) {
  return useQuery({
    ...bookFrameChaptersQueryOptions(subjectId, grade ?? 0, forCourseId),
    enabled: subjectId !== '' && grade !== null,
  });
}
