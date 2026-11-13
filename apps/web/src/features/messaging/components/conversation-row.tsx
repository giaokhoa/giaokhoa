/**
 * Một hàng hội thoại ở khung trái màn Tin nhắn.
 *
 * Vai trò: vỏ hàng dùng chung cho tab Tất cả/Chưa đọc/Lưu trữ (`conversation-sidebar.tsx`) và tab Nhóm (`group-list-nav.tsx`) — trước đây
 * hai nơi tự dựng lại cùng một khung hàng (nút nguyên khối, avatar + tên + giờ, xem trước tin cuối + cụm biểu tượng cuối hàng).
 *
 * Flow tổng thể: hàng là MỘT nút nguyên khối như bản demo (điểm C16) — hàng đang chọn mang nền `bg-muted` kèm ring 1px `ring-border`
 * khảm trong (`ring-inset`) ngay trên nút, `overflow-hidden` như lớp nền của chuỗi demo để nội dung hàng bị cắt theo góc bo tròn; hàng chưa
 * chọn chỉ mang `hover:bg-muted/75`. Bấm hàng là mở chat của hàng đó qua `onOpen` (trang chứa xử lý ensure khi cần).
 *
 * Các điểm hai tab khác nhau được tham số hoá, không gộp bằng cách đổi hành vi: giờ hiển thị (`time`) và xem trước tin cuối (`preview`) do
 * nơi gọi dựng sẵn theo luật riêng của nó (định dạng giờ và tiền tố người gửi khác nhau giữa hai tab); cụm chưa đọc (`unread`) do nơi gọi
 * dựng sẵn theo luật riêng; hàng nhóm thụt trái theo cấp lồng (`depth`) còn hàng phẳng thì không; chấm hiện diện chỉ có ở tab Tất cả;
 * icon ghim chỉ có ở tab Tất cả (tab Nhóm phân mục ghim bằng section, không gắn icon trên hàng).
 */
import type { ReactNode } from 'react';
import { BellOff, Pin } from 'lucide-react';

import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { cn } from '@giaokhoa/ui/lib/utils';
import { initialsOf, PRESENCE_DOT_CLASS } from '../utils/utils';
import type { PresenceStatus } from '../types/types';

/**
 * Một hàng hội thoại dùng chung cho hai tab danh sách.
 *
 * @param label - Tiêu đề hàng (tên hội thoại/nhóm/lớp/khoá).
 * @param avatarLabel - Nhãn dùng để lấy chữ cái avatar (ở hàng 1–1 là tên đối tác, khác tiêu đề khi hội thoại chưa đặt tên).
 * @param titleClassName - Class độ đậm/màu của tiêu đề (nhóm đậm 600, 1–1 vừa 500 — giữ đúng chuỗi class của từng nơi gọi).
 * @param isActive - Hàng đang mở ở khung phải (tô nền + ring).
 * @param onOpen - Mở chat của hàng.
 * @param time - Nút giờ đã dựng sẵn (định dạng + testid theo luật của nơi gọi), hoặc null khi không có tin cuối.
 * @param preview - Xem trước tin cuối / phụ đề vai / khoảng trống đã dựng sẵn theo luật của nơi gọi.
 * @param conversationId - Id hội thoại để gắn testid cho icon ghim/tắt tiếng; vắng mặt thì không gắn testid.
 * @param pinned - Hiện icon ghim (chỉ tab Tất cả).
 * @param muted - Hiện icon tắt tiếng.
 * @param presenceSlot - Giữ ô chấm hiện diện quanh avatar (chỉ tab Tất cả; hàng nhóm không có ô này).
 * @param presenceStatus - Trạng thái hiện diện đã phân giải — có trị thì hiện chấm, chưa biết thì không chấm (không gộp chưa biết thành ngoại tuyến).
 * @param depth - Cấp lồng trong cây nhóm → thụt trái hàng; vắng mặt là hàng phẳng không thụt.
 * @param unread - Cụm chưa đọc đã dựng sẵn theo luật của nơi gọi.
 * @param unreadPosition - Vị trí cụm chưa đọc: `row` là trong dòng phụ đề (tab Tất cả), `end` là con trực tiếp cuối nút (tab Nhóm).
 * @returns Hàng hội thoại theo khuôn demo.
 */
export function ConversationRow({
  label,
  avatarLabel,
  titleClassName,
  isActive,
  onOpen,
  time,
  preview,
  conversationId,
  pinned,
  muted,
  presenceSlot,
  presenceStatus,
  depth,
  unread,
  unreadPosition,
}: {
  label: string;
  avatarLabel: string;
  titleClassName: string;
  isActive: boolean;
  onOpen: () => void;
  time: ReactNode;
  preview: ReactNode;
  conversationId?: string;
  pinned?: boolean;
  muted?: boolean;
  presenceSlot?: boolean;
  presenceStatus?: PresenceStatus;
  depth?: number;
  unread: ReactNode;
  unreadPosition: 'row' | 'end';
}) {
  return (
    <button
      type="button"
      aria-current={isActive || undefined}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg py-2.5 text-left transition-colors',
        depth === undefined ? 'px-2.5' : 'pr-2.5 ring-inset',
        isActive
          ? (depth === undefined ? 'bg-muted ring-1 ring-border ring-inset' : 'bg-muted ring-1 ring-border')
          : 'hover:bg-muted/75',
      )}
      style={depth === undefined ? undefined : { paddingLeft: `${0.625 + depth * 1.25}rem` }}
      onClick={onOpen}
    >
      {presenceSlot ? (
        <span className="relative shrink-0">
          <Avatar size="lg">
            <AvatarFallback className={cn(isActive && 'bg-background/50')}>{initialsOf(avatarLabel)}</AvatarFallback>
          </Avatar>
          {presenceStatus !== undefined ? (
            <span
              className={cn(
                'absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-background',
                PRESENCE_DOT_CLASS[presenceStatus],
              )}
            />
          ) : null}
        </span>
      ) : (
        <Avatar size="lg">
          <AvatarFallback className={cn(isActive && 'bg-background/50')}>{initialsOf(avatarLabel)}</AvatarFallback>
        </Avatar>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-sm', titleClassName)}>
            {label}
          </span>
          {time}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {preview}
          {/*
            Cụm biểu tượng cuối hàng theo đúng khuôn demo (issue #608, trích từ SSR và chunk của demo):
            mỗi biểu tượng nằm trong ô lưới 20px căn giữa; ghim là icon 12px tô đặc mờ 70%, tắt tiếng là icon 12px màu muted.
          */}
          {pinned ? (
            <span data-testid={conversationId ? `conversation-pinned-${conversationId}` : undefined} className="grid size-5 shrink-0 place-items-center">
              <Pin className="size-3 fill-current opacity-70" aria-hidden />
            </span>
          ) : null}
          {muted ? (
            <span data-testid={conversationId ? `conversation-muted-${conversationId}` : undefined} className="grid size-5 shrink-0 place-items-center">
              <BellOff className="size-3 text-muted-foreground" aria-hidden />
            </span>
          ) : null}
          {unreadPosition === 'row' ? unread : null}
        </span>
      </span>
      {unreadPosition === 'end' ? unread : null}
    </button>
  );
}
