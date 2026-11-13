import { type RouteConfig, relative } from '@react-router/dev/routes';

const { index, prefix, route } = relative(import.meta.dirname);

export default [
  ...prefix('content-bank', [
    index('routes/content-bank.tsx'),
    route('new', 'routes/content-bank-new.tsx'),
    route(':id/edit', 'routes/content-bank-edit.tsx'),
  ]),
  ...prefix('contentbank', [
    index('routes/legacy-contentbank.tsx'),
    route('new', 'routes/legacy-contentbank-new.tsx'),
    route(':id/edit', 'routes/legacy-contentbank-edit.tsx'),
  ]),
] satisfies RouteConfig;
