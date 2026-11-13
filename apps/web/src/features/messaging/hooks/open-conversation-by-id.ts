/**
 * Mở một conversation theo id — "lấy chi tiết → dựng summary → chèn vào danh sách → mở".
 *
 * Vai trò: bản duy nhất dùng chung của luồng mở conversation khi chỉ biết id — trước đây ba nơi tự viết lại giống nhau: deep-link và khôi phục
 * ngữ cảnh trong `use-conversation-restore.ts`, và `openConversationById` trong `use-group-actions.ts`.
 *
 * Flow tổng thể: có sẵn trong một trong các tập danh sách đã cho thì mở như cú bấm thường; chưa có thì lấy chi tiết thẳng theo id bằng đúng
 * endpoint trang vẫn dùng để mở, bóc phần chi tiết khỏi dữ kiện chi tiết (rest-destructuring giữ đủ mọi trường của `ConversationView` —
 * bản deep-link cũ dựng summary từng trường nên lặng lẽ rớt các trường như `pinnedAt`/`muted` khi `ConversationView` thêm trường), chèn
 * vào đầu danh sách rồi mở. Server là nơi thực thi quyền thành viên: không phải thành viên hoặc conversation không tồn tại thì bỏ qua êm.
 */
import type { QueryClient } from '@tanstack/react-query';

import { conversationDetailQueryOptions } from '../queries/messaging';
import type { ConversationView } from '../types/types';

/**
 * Mở một conversation theo id.
 *
 * @param queryClient - QueryClient để lấy chi tiết khi conversation chưa có trong danh sách.
 * @param sources - Các tập danh sách để tìm conversation đã có, theo thứ tự ưu tiên (ví dụ danh sách chính rồi tập đã lưu).
 * @param setConversations - Ghi danh sách conversation (chèn hội thoại lấy theo id vào đầu danh sách).
 * @param open - Mở conversation (trang nối qua callback dùng-chung).
 * @param conversationId - Id conversation cần mở.
 */
export async function openConversationById(
  queryClient: QueryClient,
  sources: ConversationView[][],
  setConversations: (conversations: ConversationView[] | ((prev: ConversationView[]) => ConversationView[])) => void,
  open: (conv: ConversationView) => Promise<void> | void,
  conversationId: string,
): Promise<void> {
  for (const source of sources) {
    const found = source.find((c) => c.id === conversationId);
    if (found) {
      await open(found);
      return;
    }
  }
  try {
    const detail = await queryClient.fetchQuery(conversationDetailQueryOptions(conversationId));
    const { messages: _detailMessages, hasMoreBefore: _hasMore, memberReadMarkers: _markers, ...summary } = detail;
    setConversations((prev) => (prev.some((c) => c.id === summary.id) ? prev : [summary, ...prev]));
    await open(summary);
  } catch {
    // Không phải thành viên hoặc conversation không tồn tại: giữ nguyên màn hiện tại.
  }
}
