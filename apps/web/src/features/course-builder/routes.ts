import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('courses/:id/builder', 'routes/course-builder.tsx'),
] satisfies RouteConfig;
