/**
 * Ô soạn tin dùng chung của feature messaging.
 *
 * Vai trò: một component soạn duy nhất phục vụ cả hai tab của khung tin nhắn — tab Trả lời và tab Ghi chú nội bộ — thay cho hai form soạn
 * chép lại nhau gần như nguyên vẹn trước đây trong `chat-panel.tsx`.
 *
 * Flow tổng thể: bên gọi (`ChatPanel`) truyền nháp hiện tại, ref tới ô nhập và các handler tác động lên nháp của tab đó (Bold bọc/bỏ bọc `**`,
 * emoji chèn tại con trỏ, link hỏi URL qua hộp thoại rồi bọc `[văn bản](url)`); component giữ phần hiển thị dùng chung — ô nhập nhiều dòng
 * (Enter gửi, Shift+Enter xuống dòng) và hàng công cụ (Bold → Emoji → Attach → Link ở nhóm trái, nút Gửi ở phía phải) — rồi gọi lại handler
 * của bên gọi khi người dùng thao tác. Không gọi API, không ghi cache: gửi tin đi qua `onSubmit` của bên gọi, ghi chú chỉ xử lý cục bộ.
 */
import type { FormEvent, RefObject } from 'react';
import { Link2, Paperclip, Send, Smile } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@giaokhoa/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@giaokhoa/ui/components/popover';
import { Textarea } from '@giaokhoa/ui/components/textarea';

/**
 * Lưới emoji của bộ chọn ở ô soạn (issue #591; tập và thứ tự căn đúng theo bản demo ở issue #608 — trích nguyên mảng emoji từ chunk JS của demo): dựng trên component Popover của `@giaokhoa/ui` (vòng sửa PR #593 — bản trước dùng DropdownMenu đã bị cả hai lớp review bác vì khác component và khác ngữ nghĩa), dạng lưới 5 cột × 4 hàng. Chọn emoji chèn ký tự TẠI VỊ TRÍ CON TRỎ trong ô soạn (đúng hành vi bản demo; nối cuối nháp như trước là điểm lệch đã sửa ở giai đoạn 2 của vòng sửa PR #610); không thêm thư viện picker.
 */
const EMOJI_GRID_OPTIONS = [
  '😀', '😂', '😊', '😍', '🥳',
  '👍', '👏', '🙏', '❤️', '🔥',
  '✅', '👋', '🎉', '💯', '🤔',
  '😅', '🙌', '💪', '✨', '🚀',
];

/**
 * Ô soạn tin dùng chung cho cả hai tab của khung tin nhắn (trước đây hai form soạn — Trả lời và Ghi chú nội bộ — chép lại nhau gần như nguyên vẹn).
 *
 * Hàng công cụ soạn theo đúng thứ tự và khuôn phía demo (issue #608): hàng tách hai phía — nhóm trái khoảng 4px gồm Bold (nút ghost chứa chữ "B" như demo), Emoji, Attach, Link; nút Send ở phía phải với glyph Send. Bold và Link hoạt động thật (giai đoạn 2 của vòng sửa PR #610), Attach vẫn là hình dạng vô hiệu (điểm chưa có phán quyết); bộ chọn emoji dùng khuôn đã trích từ demo: PopoverContent `w-64 p-2`, lưới 5 cột khoảng 4px, nút emoji đệm 8px.
 *
 * Phía demo dùng chung một component soạn cho cả hai tab nên hai tab chỉ khác nhau ở dữ liệu truyền vào: nháp và handler của tab nào thì tác động lên nháp của tab đó (xem các handler `*Note*` ở `chat-panel.tsx`).
 */
export function MessageComposer({
  textareaRef,
  ariaLabel,
  placeholder,
  value,
  onValueChange,
  onSubmit,
  onBold,
  onInsertEmoji,
  onInsertLink,
  emojiOpen,
  onEmojiOpenChange,
  emojiPickerTestId,
  sendDisabled,
  canSubmitOnEnter,
}: {
  /** Ref tới ô nhập (bên gọi giữ để khôi phục vùng chọn sau thao tác định dạng). */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Nhãn truy cập của ô nhập. */
  ariaLabel: string;
  /** Placeholder của ô nhập. */
  placeholder: string;
  /** Nội dung nháp hiện tại. */
  value: string;
  /** Nháp đổi (bên gọi ghi theo conversation đang mở). */
  onValueChange: (value: string) => void;
  /** Gửi form. */
  onSubmit: (event: FormEvent) => void;
  /** Bọc/bỏ bọc `**` quanh vùng chọn. */
  onBold: () => void;
  /** Chèn emoji tại con trỏ. */
  onInsertEmoji: (emoji: string) => void;
  /** Chèn liên kết từ URL hỏi qua hộp thoại. */
  onInsertLink: () => void;
  /** Bộ chọn emoji đang mở hay không. */
  emojiOpen: boolean;
  /** Đổi trạng thái mở của bộ chọn emoji. */
  onEmojiOpenChange: (open: boolean) => void;
  /** `data-testid` của popover chọn emoji (mỗi tab một trị riêng để test phân biệt). */
  emojiPickerTestId: string;
  /** Nút Gửi vô hiệu (nháp rỗng hoặc đang có lượt gửi bay). */
  sendDisabled: boolean;
  /** Enter có được gửi không — tab Trả lời chặn khi đang có lượt gửi bay (fix nhân đôi tin, issue #33). */
  canSubmitOnEnter: boolean;
}) {
  const { t } = useTranslation('app');
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 px-3 pb-2">
      <Textarea
        ref={textareaRef}
        aria-label={ariaLabel}
        placeholder={placeholder}
        rows={1}
        className="max-h-32 min-h-10 min-w-0 resize-none rounded-none border-0 px-0 py-2 text-sm shadow-none focus-visible:ring-0"
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
        }}
        onKeyDown={(e) => {
          // Enter gửi, Shift+Enter xuống dòng (lát M1, issue #204) — ngữ nghĩa chuẩn app nhắn tin cho composer nhiều dòng.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSubmitOnEnter) e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('boldLabel')}
            onClick={onBold}
          >
            <span className="text-base leading-none font-medium">B</span>
          </Button>
          <Popover open={emojiOpen} onOpenChange={onEmojiOpenChange}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('emojiPickerLabel')}
                />
              }
            >
              <Smile aria-hidden />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={4}
              data-testid={emojiPickerTestId}
              className="w-64 p-2"
            >
              <div className="grid grid-cols-5 gap-1">
                {EMOJI_GRID_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="rounded-md p-2 text-lg transition-colors hover:bg-muted"
                    onClick={() => onInsertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('attachFileLabel')}
            disabled
          >
            <Paperclip aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('insertLinkLabel')}
            onClick={onInsertLink}
          >
            <Link2 aria-hidden />
          </Button>
        </div>
        <Button
          type="submit"
          size="icon-sm"
          aria-label={t('send')}
          disabled={sendDisabled}
        >
          <Send aria-hidden />
        </Button>
      </div>
    </form>
  );
}
