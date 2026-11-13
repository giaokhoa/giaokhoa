
export function tenantRealtimeSegment(tenantId: string | null | undefined, spaceId?: string | null): string {
  const tenant = tenantId ?? 'platform';
  return spaceId ? `s:${spaceId}:t:${tenant}` : tenant;
}

export function conversationRoom(tenantId: string | null | undefined, conversationId: string, spaceId?: string | null): string {
  return `t:${tenantRealtimeSegment(tenantId, spaceId)}:conv:${conversationId}`;
}

export function userRoom(tenantId: string | null | undefined, userId: string, spaceId?: string | null): string {
  return `t:${tenantRealtimeSegment(tenantId, spaceId)}:user:${userId}`;
}
