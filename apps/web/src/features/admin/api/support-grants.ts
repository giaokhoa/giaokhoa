/**
 * API quản lý quyền hỗ trợ của trung tâm hiệu lực (issue #19).
 * Không truyền tenantId từ client; server quyết định phạm vi từ phiên.
 */
import type {
  CreateSupportGrant,
  SupportAuditEntry,
  SupportGrant,
} from "@giaokhoa/contracts";
import { apiJson } from "#lib/api";

/** Lấy grant, bao gồm quyền hết hạn/đã thu hồi. */
export function fetchSupportGrants(): Promise<SupportGrant[]> {
  return apiJson("/api/v1/support-grants");
}

/** Đọc nhật ký grant và từng quyết định được phép/từ chối. */
export function fetchSupportAudit(): Promise<SupportAuditEntry[]> {
  return apiJson("/api/v1/support-grants/audit");
}

/** Tạo grant hữu hạn cho đúng một nhân sự platform. */
export function createSupportGrant(
  input: CreateSupportGrant,
): Promise<SupportGrant> {
  return apiJson("/api/v1/support-grants", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Thu hồi grant; lần request hỗ trợ kế tiếp sẽ không qua cổng. */
export function revokeSupportGrant(id: string): Promise<SupportGrant> {
  return apiJson(`/api/v1/support-grants/${id}/revoke`, { method: "POST" });
}
