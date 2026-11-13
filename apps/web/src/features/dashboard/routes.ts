import { type RouteConfig, relative } from '@react-router/dev/routes';

const { index } = relative(import.meta.dirname);

export default [
  index('routes/home-index.tsx'),
] satisfies RouteConfig;
