import { AdminUsersPage } from '../components/admin-users';
import { adminUsersPageClientLoader } from '../queries/admin-users';


export async function clientLoader() {
  return adminUsersPageClientLoader();
}

export default AdminUsersPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navUsers');
}
