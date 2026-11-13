import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('questions/new', 'routes/question-new.tsx'),
  route('questions/:questionId/edit', 'routes/question-edit.tsx'),
] satisfies RouteConfig;
