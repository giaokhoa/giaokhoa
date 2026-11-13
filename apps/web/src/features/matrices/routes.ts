import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('matrices/new', 'routes/question-matrix-new.tsx'),
  route('matrices/import', 'routes/matrix-import.tsx'),
  route('matrices/:matrixId/edit', 'routes/question-matrix-edit.tsx'),
  route('questions/matrices/new', 'routes/legacy-matrix-new.tsx'),
  route('questions/matrices/:matrixId/edit', 'routes/legacy-matrix-edit.tsx'),
] satisfies RouteConfig;
