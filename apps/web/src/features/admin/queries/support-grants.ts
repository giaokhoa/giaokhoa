import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { CreateSupportGrant } from "@giaokhoa/contracts";
import {
  createSupportGrant,
  fetchSupportAudit,
  fetchSupportGrants,
  revokeSupportGrant,
} from "../api/support-grants";

const grantKey = ["admin", "support-grants"] as const;
const auditKey = ["admin", "support-grants", "audit"] as const;

export function supportGrantsQueryOptions() {
  return queryOptions({
    queryKey: grantKey,
    queryFn: fetchSupportGrants,
    staleTime: 0,
  });
}

export function supportAuditQueryOptions() {
  return queryOptions({
    queryKey: auditKey,
    queryFn: fetchSupportAudit,
    staleTime: 0,
  });
}

export function useCreateSupportGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: CreateSupportGrant) => createSupportGrant(draft),
    onSuccess: () => client.invalidateQueries({ queryKey: grantKey }),
  });
}

export function useRevokeSupportGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => revokeSupportGrant(grantId),
    onSuccess: () => client.invalidateQueries({ queryKey: grantKey }),
  });
}
