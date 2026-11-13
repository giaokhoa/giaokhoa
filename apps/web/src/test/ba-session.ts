export function isGetSessionUrl(url: unknown): boolean {
  return String(url).endsWith('/api/v1/auth/get-session');
}

export function baSessionBody(user: { id: string; username?: string; email?: string; name?: string }) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    session: {
      id: '01900000-0000-7000-8000-000000000101',
      userId: user.id,
      token: 'session-token',
      expiresAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    user: {
      id: user.id,
      username: user.username ?? 'user',
      name: user.name ?? 'Test User',
      email: user.email ?? 'user@example.com',
      emailVerified: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  };
}

export function baSessionResponse(user: { id: string; username?: string; email?: string; name?: string }): Response {
  return new Response(JSON.stringify(baSessionBody(user)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function baNoSessionResponse(): Response {
  return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
}
