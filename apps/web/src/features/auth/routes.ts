import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('login', 'routes/login.tsx'),
  route('register', 'routes/register.tsx'),
  route('oauth/callback', 'routes/oauth-callback.tsx'),
] satisfies RouteConfig;

export const standaloneRoutes = [
  route('mcp-login', 'routes/mcp-login.tsx'),
  route('mcp-consent', 'routes/mcp-consent.tsx'),
] satisfies RouteConfig;
