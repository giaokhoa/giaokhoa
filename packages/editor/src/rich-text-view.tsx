import { renderToReactElement } from '@tiptap/static-renderer/pm/react';
import { Fragment, type ReactNode } from 'react';
import {
  richTextBlocksHaveContent,
  type RichTextBlockNode,
  type RichTextDocument,
} from '@giaokhoa/contracts';
import { plainTextExtensions } from './extensions.js';
import { renderMathHtml } from './math.js';

/**
 * Trình xem tĩnh chỉ-đọc một tài liệu rich text — không tạo instance
 * trình soạn thảo, chỉ render đúng nội dung đã lưu để hiển thị.
 *
 * Flow tổng thể của file này (tài liệu vào là `RichTextDocument` của
 * hợp đồng hoặc `null`, hiển thị ra là React element hoặc `null`):
 *
 * 1. Tài liệu `null` hoặc không có block nào mang nội dung thật
 *    (`richTextBlocksHaveContent` của `@giaokhoa/contracts`: chữ khác
 *    rỗng, công thức có mã LaTeX, ảnh, hoặc danh sách/mệnh đề chứa
 *    nội dung) thì không render gì.
 * 2. Tài liệu thuần (không có `statementList`) render bằng static
 *    renderer của Tiptap (`renderPlainDocument`) theo đúng bộ extension
 *    của hợp đồng; hai node công thức được ánh xạ thủ công sang KaTeX
 *    vì static renderer mặc định chỉ cho ra thẻ chứa `data-latex`.
 * 3. Tài liệu thân câu đúng/sai chùm (TF-A) mang `statementList` —
 *    node này không thuộc bộ extension hiển thị thuần — nên tài liệu
 *    được tách tại các `statementList`: các block thường render như
 *    bước 2, mỗi danh sách mệnh đề render thành một `<ol>` mà từng
 *    mệnh đề là một {@link RichTextView} đệ quy trên nội dung của
 *    chính mệnh đề đó.
 *
 * Bất biến: phía xem chỉ render lát hợp đồng — nội dung ngoài hợp đồng
 * không bao giờ xuất hiện ở đây; tài liệu thống nhất phía soạn của
 * trắc nghiệm (mang node `choice`/`choiceList`) không đi qua trình xem
 * này mà phải tách về hợp đồng trước.
 */

/**
 * Thuộc tính của {@link RichTextView}.
 */
export interface RichTextViewProps {
  /** Tài liệu rich text cần hiển thị; `null` hoặc rỗng thì không hiển thị gì. */
  value: RichTextDocument | null;
}

/**
 * Kiểm tra tài liệu có nội dung nào để hiển thị hay không — dùng chung
 * `richTextBlocksHaveContent` của `@giaokhoa/contracts` để ngữ nghĩa
 * "có nội dung" (chữ khác rỗng, công thức có mã LaTeX, ảnh, danh
 * sách/mệnh đề chứa nội dung) là một nguồn sự thật duy nhất cho cả
 * phía xem lẫn phía kiểm tra hoàn chỉnh của các loại câu hỏi.
 *
 * @param value - Tài liệu cần kiểm tra.
 * @returns `true` nếu tài liệu rỗng và không nên render gì.
 */
function isEmptyDocument(value: RichTextDocument): boolean {
  return !richTextBlocksHaveContent(value.content);
}

/**
 * Render một tài liệu KHÔNG chứa `statementList` bằng static renderer
 * của Tiptap theo bộ extension của hợp đồng; hai node công thức được
 * ánh xạ thủ công sang KaTeX (xem {@link RichTextView}).
 *
 * @param value - Tài liệu thuần cần render.
 * @returns React element của tài liệu.
 */
function renderPlainDocument(value: RichTextDocument): ReactNode {
  return renderToReactElement({
    extensions: plainTextExtensions,
    content: value,
    options: {
      nodeMapping: {
        inlineMath: ({ node }) => {
          const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
          return (
            <span
              data-type="inline-math"
              data-latex={latex}
              dangerouslySetInnerHTML={{ __html: renderMathHtml(latex, false) }}
            />
          );
        },
        blockMath: ({ node }) => {
          const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
          return (
            <div
              data-type="block-math"
              data-latex={latex}
              dangerouslySetInnerHTML={{ __html: renderMathHtml(latex, true) }}
            />
          );
        },
      },
    },
  });
}

/**
 * Hiển thị chỉ-đọc một tài liệu rich text mà không tạo instance trình soạn
 * thảo: dùng static renderer của Tiptap (`renderToReactElement` từ
 * `@tiptap/static-renderer/pm/react`) theo đúng bộ extension của hợp đồng.
 *
 * Riêng hai node công thức được ánh xạ thủ công: static renderer mặc định
 * chỉ cho ra thẻ chứa `data-latex` mà không có hình công thức, nên ở đây
 * render thẳng bằng KaTeX (`trust: false`, một công thức lỗi không làm
 * sập cả trang). Ảnh và danh sách đi qua `renderHTML` của extension.
 *
 * Tài liệu thân câu đúng/sai chùm (TF-A) mang node `statementList` —
 * node này KHÔNG thuộc bộ extension hiển thị thuần, nên tài liệu được
 * tách tại các `statementList`: các block thường render bằng static
 * renderer như trên, mỗi danh sách mệnh đề render thành một `<ol>` mà
 * từng mệnh đề là một {@link RichTextView} đệ quy trên nội dung của
 * chính mệnh đề đó (hiển thị đủ thân câu + 4 mệnh đề cho bề mặt xem
 * tĩnh chung; bề mặt làm bài/xem lại có trình bày riêng theo mệnh đề).
 *
 * @param props - Thuộc tính: tài liệu cần hiển thị.
 * @returns React element của tài liệu, hoặc `null` khi tài liệu rỗng.
 */
export function RichTextView({ value }: RichTextViewProps): ReactNode {
  if (!value || isEmptyDocument(value)) {
    return null;
  }
  if (!value.content.some((block) => block.type === 'statementList')) {
    return renderPlainDocument(value);
  }
  const segments: ReactNode[] = [];
  let buffer: RichTextBlockNode[] = [];
  const flush = (key: string) => {
    if (buffer.length > 0) {
      const blocks = buffer;
      buffer = [];
      segments.push(
        <Fragment key={key}>{renderPlainDocument({ type: 'doc', content: blocks })}</Fragment>,
      );
    }
  };
  value.content.forEach((block, index) => {
    if (block.type !== 'statementList') {
      buffer.push(block);
      return;
    }
    flush(`stem-${index}`);
    segments.push(
      <ol key={`statements-${index}`} className="giaokhoa-statement-list">
        {block.content.map((statement) => (
          <li key={statement.attrs.id} data-statement={statement.attrs.id}>
            <RichTextView value={{ type: 'doc', content: statement.content }} />
          </li>
        ))}
      </ol>,
    );
  });
  flush('tail');
  return <>{segments}</>;
}
