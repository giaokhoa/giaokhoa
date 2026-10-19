import { redirect } from 'react-router';
import { createApiClient, isSuccessStatus } from '#lib/http/api.server.js';

export type SessionPayload = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  session: {
    id: string;
  };
};

export async function requireSession(request: Request): Promise<SessionPayload> {
  const response = await createApiClient(request).get<unknown>('/api/auth/get-session');

  if (response.status === 401 || response.status === 403) {
    const url = new URL(request.url);
    const returnTo = `${url.pathname}${url.search}`;
    throw redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
  }

  if (!isSuccessStatus(response.status)) {
    throw new Error('Không thể kiểm tra phiên đăng nhập.');
  }

  const value = response.data;
  if (
    !value ||
    typeof value !== 'object' ||
    !('user' in value) ||
    !value.user ||
    typeof value.user !== 'object' ||
    !('id' in value.user) ||
    typeof value.user.id !== 'string' ||
    !('name' in value.user) ||
    typeof value.user.name !== 'string' ||
    !('email' in value.user) ||
    typeof value.user.email !== 'string' ||
    !('session' in value) ||
    !value.session ||
    typeof value.session !== 'object' ||
    !('id' in value.session) ||
    typeof value.session.id !== 'string'
  ) {
    throw redirect('/login');
  }

  return value as SessionPayload;
}
