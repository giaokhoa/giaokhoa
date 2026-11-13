/**
 * Nguồn sự thật duy nhất về scope của OAuth AS và metadata PRM.
 * Cầu auth kỷ nguyên cũ giữ quyền HẸP hơn: không được tự publish.
 * Quyền thực tế còn phụ thuộc capability trong ngữ cảnh bank/tenant.
 */
export const MCP_OAUTH_SCOPES = [
  'giaokhoa.questions.read',
  'giaokhoa.questions.draft',
  'giaokhoa.questions.write',
  'giaokhoa.banks.contribute',
] as const;

export const MCP_BRIDGE_SCOPES: readonly string[] =
  MCP_OAUTH_SCOPES.filter((scope) => scope !== 'giaokhoa.questions.write');
