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
  route('images', 'routes/images/upload.ts'),
  route('images/discard', 'routes/images/discard.ts'),
  route('images/:id', 'routes/images/download.ts'),
  route('images/:id/source', 'routes/images/source.ts'),
  route('images/:id/variants', 'routes/images/create-variant.ts'),
  route('images/:id/variants/:imageVariantId', 'routes/images/download-variant.ts'),
] satisfies RouteConfig;
