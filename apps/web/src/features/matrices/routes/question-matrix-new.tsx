/**
 * Route module của màn tạo ma trận (`/matrices/new`): chỉ tái xuất `MatrixNewPage` từ `./question-matrix` làm component mặc định của route.
 * `clientLoader` prefetch bank ma trận và danh sách môn vào QueryClient trước khi component mount, đúng khoá trang sẽ đọc.
 * File này không chứa form hay logic tạo nào; tiêu đề và biên lỗi theo route nằm ở `meta` và `ErrorBoundary` cuối file.
 */

export { MatrixNewPage as default } from './question-matrix';
import { appKeyMeta } from '#lib/route-meta';

import { matrixBanksQueryOptions } from '../queries/matrix';
import { curriculumSubjectsQueryOptions } from '#lib/curriculum';
import { queryClient } from '#lib/query-client';

/**
 * clientLoader (F-01 đợt 1 + bổ sung clientLoader, rà soát #133):
 * prefetch bank ma trận + danh sách môn vào QueryClient singleton
 * (đúng khoá factory) trước khi component mount; component vẫn đọc
 * bằng useQuery cùng khoá và tự xử lý khi tải hỏng.
 */
export async function clientLoader() {
  await Promise.all([
    queryClient.prefetchQuery(matrixBanksQueryOptions()),
    queryClient.prefetchQuery(curriculumSubjectsQueryOptions()),
  ]);
  return null;
}

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
export function meta() {
  return appKeyMeta('matrixCreate');
}
