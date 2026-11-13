import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('badges', 'routes/badges.tsx'),
] satisfies RouteConfig;
