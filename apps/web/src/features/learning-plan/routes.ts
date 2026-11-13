import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('learning-plan', 'routes/learning-plan.tsx'),
] satisfies RouteConfig;
