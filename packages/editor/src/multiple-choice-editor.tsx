import { useId } from 'react';
import type { RichTextDocument } from '@giaokhoa/contracts';
import { RichTextEditor } from './rich-text-editor.js';
import type { RichTextImagePick } from './rich-text-editor.js';
import { createAnswerDecoration, useAnswerEditorExtensions } from './item-list.js';
import {
  CHOICE_LIST_NODE_TYPE,
  CHOICE_NODE_TYPE,
  multipleChoiceExtensions,
  type MultipleChoiceDocumentJson,
} from './multiple-choice.js';

/**
 * Editor soạn câu trắc nghiệm trên TÀI LIỆU THỐNG NHẤT (port từ
 * `MultipleChoiceEditor` của giaokhoa — xem module
 * `multiple-choice.ts` để rõ flow tổng thể của mô hình).
 *
 * Component này là một lớp bọc quanh {@link RichTextEditor}: thay bộ
 * extension hợp đồng bằng {@link multipleChoiceExtensions} (thân câu
 * + danh sách lựa chọn trong cùng một tài liệu) và cộng extension
 * decoration vẽ radio "Đặt làm đáp án đúng" vào từng node `choice`.
 * Vỏ dùng chung lo phần còn lại: một toolbar cho editor đang active,
 * panel công thức, đường chèn ảnh, đồng bộ nội dung hai chiều.
 *
 * Đáp án đúng sống NGOÀI tài liệu (prop `correctChoiceId` +
 * `onCorrectChoiceChange`): radio chỉ là widget trang trí trỏ theo id
 * của choice; nghiêm cấm đưa thông tin đúng/sai vào nội dung tài liệu
 * của lựa chọn (không gõ chữ/công thức đánh dấu đáp án vào choice).
 * Thứ tự lựa chọn đổi bằng kéo-thả node choice trong tài liệu (xem
 * node `Choice`), và vì đáp án đúng bám theo id nên nó đi theo đúng
 * lựa chọn qua mọi lần đổi thứ tự.
 */

/**
 * Điều khiển radio đáp án đúng mà decoration đọc tại thời điểm vẽ widget: giữ trong một ref để widget luôn thấy giá trị mới nhất mà không phải dựng lại extension khi prop đổi.
 */
interface CorrectChoiceControl {
  /** Tên nhóm radio (duy nhất cho mỗi instance editor trên trang). */
  groupName: string;
  /** Id của choice đang là đáp án đúng; chưa chọn thì `undefined`. */
  correctChoiceId?: string;
  /** Báo ra ngoài khi người soạn chọn một choice làm đáp án đúng. */
  onCorrectChoiceChange: (choiceId: string) => void;
}

/**
 * Dựng radio đáp án đúng cho một lựa chọn: radio đọc lựa chọn hiện
 * tại từ điều khiển tại lúc tạo widget nên không cần dựng lại
 * decoration khi đáp án đúng đổi — bản thân các radio trong cùng một
 * nhóm tự loại trừ nhau theo hành vi gốc của trình duyệt khi người
 * soạn bấm chọn.
 *
 * @param choiceId - Id của lựa chọn mà widget gắn vào.
 * @param getControl - Hàm đọc điều khiển radio mới nhất.
 * @returns Mảng phần tử con của widget (một radio).
 */
function buildCorrectChoiceWidget(
  choiceId: string,
  getControl: () => CorrectChoiceControl,
): HTMLElement[] {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = getControl().groupName;
  input.className = 'giaokhoa-choice__correct-input';
  input.setAttribute('aria-label', 'Đặt làm đáp án đúng');
  input.checked = getControl().correctChoiceId === choiceId;
  input.addEventListener('change', () => {
    if (input.checked) {
      getControl().onCorrectChoiceChange(choiceId);
    }
  });
  return [input];
}

/**
 * Decoration hiển thị radio đáp án đúng bên cạnh lựa chọn mà không thay
 * đổi nội dung tài liệu — dùng chung factory `createAnswerDecoration`
 * của `item-list.ts` với node type `choice` (decoration chỉ dựng lại
 * khi tập id choice thay đổi).
 */
const createCorrectChoiceDecoration =
  createAnswerDecoration<CorrectChoiceControl>({
    name: 'correctChoiceDecoration',
    listNodeType: CHOICE_LIST_NODE_TYPE,
    itemNodeType: CHOICE_NODE_TYPE,
    widgetKeyPrefix: 'correct-choice',
    wrapperClassName: 'giaokhoa-choice__correct',
    buildWidget: buildCorrectChoiceWidget,
  });

/**
 * Thuộc tính của {@link MultipleChoiceEditor}.
 */
export interface MultipleChoiceEditorProps {
  /** Tài liệu thống nhất hiện tại do bề mặt chứa quản lý. */
  value: MultipleChoiceDocumentJson;
  /** Được gọi mỗi khi tài liệu thay đổi (đã ở dạng đem-lưu của vỏ editor). */
  onChange: (document: MultipleChoiceDocumentJson) => void;
  /** Id của choice là đáp án đúng; chưa chọn thì `undefined`. */
  correctChoiceId?: string;
  /** Được gọi khi người soạn chọn một choice làm đáp án đúng. */
  onCorrectChoiceChange: (choiceId: string) => void;
  /** Nhãn truy cập (aria-label) đặt trên vùng nhập liệu. */
  ariaLabel?: string;
  /**
   * Đường chèn ảnh do bề mặt chứa cung cấp — cùng giao ước với
   * {@link RichTextEditor}: editor gọi kèm tệp khi dán/kéo-thả ảnh,
   * không kèm tệp khi bấm nút ảnh; bề mặt chứa trả định danh bền để
   * chèn hoặc `null` để huỷ.
   */
  onRequestImage?: (
    file?: File,
  ) => Promise<RichTextImagePick | null> | RichTextImagePick | null;
}

/**
 * Trình soạn thảo câu trắc nghiệm thống nhất: thân câu và bốn lựa
 * chọn trong một tài liệu, radio đáp án đúng gắn tại từng lựa chọn,
 * kéo-thả đổi thứ tự lựa chọn trong danh sách.
 *
 * @param props - Thuộc tính: tài liệu thống nhất + điều khiển đáp án đúng.
 * @returns Phần tử editor trắc nghiệm.
 */
export function MultipleChoiceEditor({
  value,
  onChange,
  correctChoiceId,
  onCorrectChoiceChange,
  ariaLabel,
  onRequestImage,
}: MultipleChoiceEditorProps) {
  const groupName = useId();
  const extensions = useAnswerEditorExtensions({
    baseExtensions: multipleChoiceExtensions,
    createDecoration: createCorrectChoiceDecoration,
    controlValue: { groupName, correctChoiceId, onCorrectChoiceChange },
  });

  return (
    <RichTextEditor
      // Tài liệu thống nhất KHÔNG phải tài liệu hợp đồng (mang node
      // choice/choiceList chỉ sống phía soạn) — ép kiểu tại biên này
      // là có chủ đích và được module multiple-choice.ts mô tả: vỏ
      // editor chỉ vận hành trên JSON, hình dạng hợp đồng được khôi
      // phục bằng splitMultipleChoiceDocument trước khi lưu.
      value={value as unknown as RichTextDocument}
      onChange={(document) => onChange(document as unknown as MultipleChoiceDocumentJson)}
      extensions={extensions}
      ariaLabel={ariaLabel}
      onRequestImage={onRequestImage}
    />
  );
}
