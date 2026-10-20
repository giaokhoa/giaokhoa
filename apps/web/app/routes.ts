import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  layout('routes/dashboard/layout.tsx', [
    index('routes/home.tsx'),
    route('curricula', 'routes/curricula.tsx'),
    route('subjects', 'routes/subjects.tsx'),
    route('questions/new', 'routes/questions/new.tsx'),
    route('questions/:id', 'routes/questions/edit.tsx'),
  ]),
  layout('routes/auth/layout.tsx', [
    route('login', 'routes/auth/login.tsx'),
    route('register', 'routes/auth/register.tsx'),
    route('verify-email', 'routes/auth/verify-email.tsx'),
    route('forgot-password', 'routes/auth/forgot-password.tsx'),
    route('onboarding', 'routes/auth/onboarding.tsx'),
  ]),
  route('files', 'routes/files/upload.ts'),
  route('files/discard', 'routes/files/discard.ts'),
  route('files/:id', 'routes/files/download.ts'),
  route('files/:id/source', 'routes/files/source.ts'),
  route('files/:id/variants', 'routes/files/create-variant.ts'),
  route('files/:id/variants/:variantId', 'routes/files/download-variant.ts'),
] satisfies RouteConfig;
