import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('courses/:id/learn/:cmId', 'routes/player.tsx'),
] satisfies RouteConfig;
