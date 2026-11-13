export { GuardianPage as default } from './guardian';

import { guardianStudentPageClientLoader } from '../queries/guardians';

export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.studentId) {
    await guardianStudentPageClientLoader(params.studentId);
  }
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { guardianKeyMeta } from '#lib/route-meta';
export function meta() {
  return guardianKeyMeta('title');
}
