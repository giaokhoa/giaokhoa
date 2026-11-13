




export const MCP_OAUTH_SCOPES = [
  'giaokhoa.questions.read',
  'giaokhoa.questions.draft',
  'giaokhoa.questions.write',
  'giaokhoa.banks.contribute',
] as const;

export const MCP_BRIDGE_SCOPES: readonly string[] =
  MCP_OAUTH_SCOPES.filter((scope) => scope !== 'giaokhoa.questions.write');
