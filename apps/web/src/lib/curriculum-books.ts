/**
 * Tầng SGK "Kết nối tri thức với cuộc sống" (K0b) của tầng dữ liệu
 * chương trình — tách từ `lib/curriculum.ts` (S30): kiểu + lời gọi API
 * sách (danh sách sách, cây sách, trạng thái dataset SGK) và đơn vị
 * khung SGK chọn được cho panel nạp khung sách. Trang quản trị chương
 * trình và panel nạp khung SGK đọc qua các hook ở đây.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiJson } from '#lib/api';
import { queryKeys } from '#lib/query-keys';

/** Trạng thái nạp của một dataset SGK trong manifest phía máy chủ. */
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

/** Một cuốn SGK đã nạp. */
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

/** Một đích ánh xạ của một bài SGK (mã bản ghi chương trình để truy vết). */
export interface BookMappingView {
  curriculumNodeId: string | null;
  learningOutcomeId: string | null;
  programRecordId: string | null;
  targetTitle: string | null;
}

/** Một bài SGK trong cây sách, kèm ánh xạ và YCCĐ suy qua ánh xạ. */
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

/** Cây đầy đủ của một cuốn SGK: chủ đề → bài. */
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

/** Trạng thái nạp của mọi dataset SGK (bề mặt quản trị — cần curriculum:view hệ thống). */
export async function fetchBookDatasetStatus(): Promise<BookDatasetStatus[]> {
  return apiJson<BookDatasetStatus[]>('/api/v1/books/dataset-import');
}

/** Danh sách SGK đã nạp; kèm subjectId lọc theo môn, forCourseId mở nhánh chọn khung cho khoá. */
export async function fetchBooks(subjectId?: string, forCourseId?: string): Promise<Book[]> {
  const params = new URLSearchParams();
  if (subjectId) params.set('subjectId', subjectId);
  if (forCourseId) params.set('forCourseId', forCourseId);
  const query = params.toString();
  return apiJson<Book[]>(`/api/v1/books${query ? `?${query}` : ''}`);
}

/** Cây sách đầy đủ của một cuốn SGK. */
export async function fetchBookTree(bookId: string, forCourseId?: string): Promise<BookTree> {
  const frame = forCourseId ? `?forCourseId=${forCourseId}` : '';
  return apiJson<BookTree>(`/api/v1/books/${bookId}/tree${frame}`);
}

/** Một đơn vị khung SGK chọn được: một chủ đề + số bài + số YCCĐ suy qua ánh xạ của cả chủ đề. */
export interface BookFrameChapter {
  nodeId: string;
  title: string;
  lessonCount: number;
  outcomeCount: number;
}


/** Tuỳ chọn truy vấn trạng thái dataset SGK (GET /books/dataset-import). */
export function bookDatasetStatusQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.bookDatasetStatus,
    queryFn: () => fetchBookDatasetStatus(),
  });
}

/** Hook đọc trạng thái dataset SGK cho trang quản trị. */
export function useBookDatasetStatus() {
  return useQuery(bookDatasetStatusQueryOptions());
}

/** Tuỳ chọn truy vấn danh sách SGK đã nạp (GET /books). */
export function booksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.books,
    queryFn: () => fetchBooks(),
  });
}

/** Hook đọc danh sách SGK cho trang quản trị. */
export function useBooks() {
  return useQuery(booksQueryOptions());
}

/** Tuỳ chọn truy vấn cây của một cuốn SGK (GET /books/:id/tree). */
export function bookTreeQueryOptions(bookId: string) {
  return queryOptions({
    queryKey: queryKeys.bookTree(bookId),
    queryFn: () => fetchBookTree(bookId),
  });
}

/** Hook đọc cây sách — chỉ tải khi bề mặt cần (mở một cuốn sách). */
export function useBookTree(bookId: string, enabled: boolean) {
  return useQuery({ ...bookTreeQueryOptions(bookId), enabled });
}


/**
 * Đơn vị khung SGK của cặp (môn, khối): không có cuốn sách nào cho
 * khối đó thì trả bookId null + danh sách rỗng.
 */
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

/** Tuỳ chọn truy vấn đơn vị khung SGK của cặp (môn, khối) kèm ngữ cảnh khoá. */
export function bookFrameChaptersQueryOptions(subjectId: string, grade: number | null, forCourseId?: string) {
  return queryOptions({
    queryKey: queryKeys.bookFrameChapters(subjectId, grade, forCourseId ?? null),
    // Chưa chọn khối thì không có chương cho khối đó — trả rỗng như khi
    // không có cuốn sách cho khối đó (hook cũng tắt query lúc này).
    queryFn: () => grade === null
      ? Promise.resolve({ bookId: null as string | null, chapters: [] as BookFrameChapter[] })
      : fetchBookFrameChaptersFor(subjectId, grade, forCourseId),
  });
}

/**
 * Hook đọc đơn vị khung SGK cho panel nạp khung sách: chưa đủ (môn,
 * khối) thì chưa gọi API và coi như chưa có sách nào để chọn.
 */
export function useBookFrameChapters(subjectId: string, grade: number | null, forCourseId?: string) {
  return useQuery({
    ...bookFrameChaptersQueryOptions(subjectId, grade, forCourseId),
    enabled: subjectId !== '' && grade !== null,
  });
}