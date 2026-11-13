/**
 * Một mục thu gọn của danh sách hội thoại ở khung trái màn Tin nhắn.
 *
 * Vai trò: vỏ mục dùng chung cho tab Tất cả/Chưa đọc/Lưu trữ (`conversation-sidebar.tsx`) và tab Nhóm (`group-list-nav.tsx`) — trước đây
 * hai nơi tự định nghĩa lại cùng một khối Collapsible giống hệt nhau.
 *
 * Flow tổng thể: tiêu đề phẳng + chevron 12px, không số đếm, đúng khuôn nhãn mục của bản demo (điểm B16), dựng trên primitive Collapsible
 * của @giaokhoa/ui với đúng kiểu trình bày của các mục trong tab Tất cả ở khung trái — không tự chế kiểu thu/mở riêng. Nội dung chỉ render
 * khi mục mở: mục đóng thì các dòng trong đó biến khỏi cây hoàn toàn (không chỉ ẩn bằng CSS), để hội thoại đã ghim không còn tính là
 * "đang hiện" ở danh sách khi mục đóng.
 */
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@giaokhoa/ui/components/collapsible';
import { cn } from '@giaokhoa/ui/lib/utils';

/**
 * Một mục thu gọn của danh sách hội thoại.
 *
 * @param title - Tiêu đề mục (ví dụ "Đã ghim", "Nhóm").
 * @param open - Mục đang mở hay không.
 * @param onOpenChange - Đổi trạng thái mở/đóng của mục.
 * @param children - Các hàng trong mục; chỉ render khi mục mở.
 * @returns Mục thu gọn theo khuôn nhãn mục của bản demo.
 */
export function ConversationSection({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 pb-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        <span>{title}</span>
        <ChevronDown aria-hidden className={cn('ml-auto size-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>{open ? children : null}</CollapsibleContent>
    </Collapsible>
  );
}
