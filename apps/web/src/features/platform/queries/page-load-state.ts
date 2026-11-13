/**
 * Trạng thái tải/lỗi dùng chung của các route platform đọc bằng một query
 * (S21 của rà soát code style): đang tải khi query đang chờ hoặc đang tải
 * lại sau lỗi; lỗi chỉ hiện khi lần tải đã kết thúc — đúng ngữ nghĩa mà
 * 5 route platform lặp nguyên văn trước đây.
 */
export interface PageLoadQuery {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
}

export function pageLoadState(
  query: PageLoadQuery,
  errorMessage: string | null,
): { loading: boolean; loadError: string | null } {
  const loading = query.isPending || (query.isError && query.isFetching);
  const loadError = query.isError && !query.isFetching ? errorMessage : null;
  return { loading, loadError };
}
