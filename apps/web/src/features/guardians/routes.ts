import { type RouteConfig, relative } from '@react-router/dev/routes';

const { index, prefix, route } = relative(import.meta.dirname);

export default prefix('guardian', [
  index('routes/guardian.tsx'),
  route('students/:studentId', 'routes/guardian-student.tsx'),
]) satisfies RouteConfig;

export const adminGuardianLinksRoutes = [
  route('admin/guardian-links', 'routes/admin-guardian-links.tsx'),
] satisfies RouteConfig;
