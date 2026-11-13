/**
 * Vá trạng thái quan hệ của một dòng roster trong cache TanStack Query.
 *
 * Vai trò: bản duy nhất dùng chung của thao tác "vá relationship trên mọi trang roster đang có ở cache" — trước đây `patchRosterRelationship`
 * (hook `use-contacts`) và `patchPanelRelationship` (hook `use-member-panel-data`) định nghĩa lại giống hệt nhau: cùng lời gọi `setQueriesData`
 * với prefix `['messages', 'roster']` và cùng updater vá relationship trên mọi trang roster trong cache.
 *
 * Flow tổng thể: nhận `QueryClient` của hook gọi + user + relationship mới, rồi `setQueriesData` với prefix khóa roster (`queryKeys.messagingRoster`)
 * để mọi trang roster đang có trong cache đều được vá ngay tại chỗ, không chờ tải lại.
 */
import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './keys';
import type { ContactRelationship, RosterMember } from '../types/types';

/**
 * Cập nhật trạng thái quan hệ của một dòng roster trong MỌI trang roster đang có ở cache ngay tại chỗ (không chờ tải lại).
 *
 * @param queryClient - QueryClient của hook gọi.
 * @param userId - User cần vá relationship.
 * @param relationship - Trạng thái quan hệ mới.
 */
export function patchRosterRelationship(
  queryClient: QueryClient,
  userId: string,
  relationship: ContactRelationship,
): void {
  queryClient.setQueriesData<{ members: RosterMember[]; nextCursor: string | null }>(
    { queryKey: queryKeys.messagingRoster },
    (old) =>
      old ? { ...old, members: old.members.map((m) => (m.userId === userId ? { ...m, relationship } : m)) } : old,
  );
}
