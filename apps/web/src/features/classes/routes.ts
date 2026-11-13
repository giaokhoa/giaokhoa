import { type RouteConfig, relative } from '@react-router/dev/routes';

const { index, prefix, route } = relative(import.meta.dirname);

export default prefix('classes', [
  index('routes/classes.tsx'),
  route('new', 'routes/class-new.tsx'),
  route('join', 'routes/class-join.tsx'),
  route(':id', 'routes/class-detail.tsx'),
  route(':id/edit', 'routes/class-edit.tsx'),
  route(':id/public', 'routes/class-public.tsx'),
]) satisfies RouteConfig;
