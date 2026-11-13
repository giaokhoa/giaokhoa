export { MatrixNewPage as default } from './question-matrix';

import { matrixBanksQueryOptions } from '../queries/matrix';
import { curriculumSubjectsQueryOptions } from '#lib/curriculum';
import { queryClient } from '#lib/query-client';

export async function clientLoader() {
  await Promise.all([
    queryClient.prefetchQuery(matrixBanksQueryOptions()),
    queryClient.prefetchQuery(curriculumSubjectsQueryOptions()),
  ]);
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tạo ma trận');
}
