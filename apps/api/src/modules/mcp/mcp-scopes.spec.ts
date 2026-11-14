import { describe, expect, it } from 'vitest';
import { MCP_BRIDGE_SCOPES, MCP_OAUTH_SCOPES } from './mcp-scopes';

describe('Ranh giới scope OAuth và cầu MCP', () => {
  it('AS và PRM có cùng tập 4 scope được quảng bá', () => {
    expect(MCP_OAUTH_SCOPES).toEqual([
      'giaokhoa.questions.read',
      'giaokhoa.questions.draft',
      'giaokhoa.questions.write',
      'giaokhoa.banks.contribute',
    ]);
  });

  it('cầu MCP truyền thống không có quyền publish dù AS hỗ trợ', () => {
    expect(MCP_BRIDGE_SCOPES).toContain('giaokhoa.questions.draft');
    expect(MCP_BRIDGE_SCOPES).not.toContain('giaokhoa.questions.write');
    expect(MCP_BRIDGE_SCOPES.every((scope) => MCP_OAUTH_SCOPES.includes(scope as never))).toBe(true);
  });
});
