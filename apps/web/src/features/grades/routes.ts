import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('courses/:id/grades', 'routes/grades.tsx'),
] satisfies RouteConfig;
