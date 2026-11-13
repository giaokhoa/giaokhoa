import { type RouteConfig, relative } from '@react-router/dev/routes';

const { prefix, route } = relative(import.meta.dirname);

export default [
  ...prefix('admin', [
    route('users', 'routes/admin-users.tsx'),
    route('users/new', 'routes/admin-user-new.tsx'),
    route('users/:userId/edit', 'routes/admin-user-edit.tsx'),
    route('tenants', 'routes/admin-tenants.tsx'),
    route('support-grants', 'routes/admin-support-grants.tsx'),
    route('roles', 'routes/admin-roles.tsx'),
    route('permissions', 'routes/admin-permissions.tsx'),
  ]),
] satisfies RouteConfig;

export const siteConfigRoutes = [
  route('admin/site-config', 'routes/admin-site-config.tsx'),
] satisfies RouteConfig;
