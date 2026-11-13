import type {
  CreateSupportGrant,
  SupportAuditEntry,
  SupportGrant,
} from "@giaokhoa/contracts";
import { apiJson } from "#lib/api";

export function fetchSupportGrants(): Promise<SupportGrant[]> {
  return apiJson("/api/v1/support-grants");
}

export function fetchSupportAudit(): Promise<SupportAuditEntry[]> {
  return apiJson("/api/v1/support-grants/audit");
}

export function createSupportGrant(
  input: CreateSupportGrant,
): Promise<SupportGrant> {
  return apiJson("/api/v1/support-grants", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeSupportGrant(id: string): Promise<SupportGrant> {
  return apiJson(`/api/v1/support-grants/${id}/revoke`, { method: "POST" });
}
