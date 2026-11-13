import type { McpRateBucket } from './mcp-rate-limit';

/**
 * Đăng ký duy nhất của các tool MCP: tên tool → scope OAuth riêng + xô
 * rate-limit. Dùng chung cho mount (cổng scope, `TOOL_REQUIRED_SCOPES`)
 * và rate limiter (`bucketForTool`) — thêm một tool thì thêm một dòng ở
 * đây (đăng ký handler vẫn ở `registerMcpTools`); scope chỉ là TRẦN của
 * token, quyền nghiệp vụ thật do capability tại context quyết ở tầng
 * tool như REST. `BRIDGE_SCOPES` ở mount KHÔNG suy từ đây: nó là trần
 * của kỷ nguyên cầu auth, cố tình thiếu `questions.write` (issue #48).
 */
export const MCP_TOOL_REGISTRY: Record<string, { scope: string; bucket: McpRateBucket }> = {
  list_my_banks: { scope: 'giaokhoa.questions.read', bucket: 'read' },
  list_categories: { scope: 'giaokhoa.questions.read', bucket: 'read' },
  get_question: { scope: 'giaokhoa.questions.read', bucket: 'read' },
  search_questions: { scope: 'giaokhoa.questions.read', bucket: 'read' },
  check_duplicates: { scope: 'giaokhoa.questions.read', bucket: 'read' },
  search_curriculum_outcomes: { scope: 'giaokhoa.questions.read', bucket: 'read' },
  create_question: { scope: 'giaokhoa.questions.draft', bucket: 'create' },
  create_questions_batch: { scope: 'giaokhoa.questions.draft', bucket: 'create' },
  create_stimulus_with_questions: { scope: 'giaokhoa.questions.draft', bucket: 'create' },
  publish_questions: { scope: 'giaokhoa.questions.write', bucket: 'publish' },
  submit_contribution: { scope: 'giaokhoa.banks.contribute', bucket: 'create' },
};
