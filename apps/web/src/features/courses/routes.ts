import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('courses', 'routes/courses.tsx'),
  route('courses/new', 'routes/course-new.tsx'),
  route('courses/:id', 'routes/course.tsx'),
  route('courses/:id/admin', 'routes/course-admin.tsx'),
] satisfies RouteConfig;
