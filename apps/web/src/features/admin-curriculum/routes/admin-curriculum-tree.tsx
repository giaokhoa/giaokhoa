export {
  AdminCurriculumTreePage as default,
  adminCurriculumTreePageClientLoader as clientLoader,
} from '../components/tree-page';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navCurriculum');
}
