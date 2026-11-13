export interface McpActor {
  userId: string;
  username: string;
  tenantId: string | null;
  clientId: string;
  ip: string | null;
  era: 'legacy' | 'modern';
  scopes: string[];
}
