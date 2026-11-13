import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('messages', 'routes/messages.tsx'),
] satisfies RouteConfig;
