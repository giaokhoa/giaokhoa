/**
 * Route module của màn sửa ma trận (`/matrices/:matrixId/edit`): chỉ tái xuất `MatrixEditPage` từ `./question-matrix` làm component mặc định của route.
 * `clientLoader` prefetch chi tiết ma trận theo `matrixId` rồi prefetch tiếp cây chương trình và khả dụng kho câu vào QueryClient, đúng khoá trang sẽ đọc.
 * File này không chứa form hay logic sửa nào; tiêu đề và biên lỗi theo route nằm ở `meta` và `ErrorBoundary` cuối file.
 */

export { MatrixEditPage as default } from './question-matrix';
import { appKeyMeta } from '#lib/route-meta';

import { curriculumTreeQueryOptions, matrixAvailabilityQueryOptions, matrixDetailQueryOptions } from '../queries/matrix';
import { queryClient } from '#lib/query-client';

/**
 * clientLoader (F-01 đợt 1 + bổ sung clientLoader, rà soát #133):
 * prefetch chi tiết ma trận vào QueryClient singleton (đúng khoá factory) rồi prefetch tiếp cây chương trình + khả dụng như nhịp loadMatrix thủ công trước đây; component vẫn đọc bằng useQuery cùng khoá và tự xử lý khi tải hỏng.
 */
export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.matrixId) {
    const row = await queryClient
      .ensureQueryData(matrixDetailQueryOptions(params.matrixId))
      .catch(() => null);
    await Promise.all([
      row ? queryClient.prefetchQuery(curriculumTreeQueryOptions(row.curriculumId)) : Promise.resolve(),
      queryClient.prefetchQuery(matrixAvailabilityQueryOptions(params.matrixId)),
    ]);
  }
  return null;
}

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
export function meta() {
  return appKeyMeta('matrixEditTitle');
}
