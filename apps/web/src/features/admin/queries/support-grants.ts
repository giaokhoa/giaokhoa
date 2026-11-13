/**
 * React Query của grant hỗ trợ: chỉ làm mới khi API xác nhận,
 * không cập nhật lạc quan trạng thái quyền nhạy cảm.
 */
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

/** Cache danh sách grant theo phiên trung tâm hiện hành. */
export function supportGrantsQueryOptions() {
  return queryOptions({
    queryKey: grantKey,
    queryFn: fetchSupportGrants,
    staleTime: 0,
  });
}

/** Audit luôn có nguồn từ máy chủ, không tạo sự kiện ở UI. */
export function supportAuditQueryOptions() {
  return queryOptions({
    queryKey: auditKey,
    queryFn: fetchSupportAudit,
    staleTime: 0,
  });
}

/** Tạo grant và làm mới cả trạng thái lẫn audit sau khi xác nhận. */
export function useCreateSupportGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: CreateSupportGrant) => createSupportGrant(draft),
    onSuccess: () => client.invalidateQueries({ queryKey: grantKey }),
  });
}

/** Thu hồi grant và làm mới ngay danh sách, audit. */
export function useRevokeSupportGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => revokeSupportGrant(grantId),
    onSuccess: () => client.invalidateQueries({ queryKey: grantKey }),
  });
}
