import { mergeAttributes, Node, type JSONContent } from '@tiptap/core';
import {
  TRUE_FALSE_STATEMENT_COUNT,
  getTrueFalseStatements,
  richTextBlocksHaveContent,
  type RichTextDocument,
} from '@giaokhoa/contracts';
import { plainTextExtensions } from './extensions.js';
import {
  completeItemList,
  createEmptyItemListDocument,
  createItemUniqueIdExtension,
  emptyParagraph,
  itemFromBlocks,
  newItemId,
  splitItemListDocument,
} from './item-list.js';

/**
 * Tài liệu phía soạn của câu đúng/sai chùm (TF-A) — port theo mô hình
 * editor giaokhoa (điểm quyết D-1 ngày 26/10/2026, lát P5 đợt #248).
 *
 * Flow tổng thể của module này:
 *
 * 1. Giáo viên soạn thân câu và cả bốn mệnh đề trong MỘT tài liệu
 *    Tiptap duy nhất: các block nội dung của thân câu (stem), chốt
 *    đuôi bằng đúng một node `statementList` chứa đúng
 *    {@link TRUE_FALSE_STATEMENT_COUNT} node `statement` (mỗi
 *    `statement` mang `attrs.id` ổn định trong vòng đời version).
 *    Khác với trắc nghiệm (lựa chọn phải TÁCH khỏi tài liệu khi lưu),
 *    ở đây tài liệu soạn THỐNG NHẤT với tài liệu lưu trữ: danh sách
 *    mệnh đề là một phần của thân câu theo hợp đồng (node
 *    `statementList` của `packages/contracts`), nên lúc lưu toàn bộ
 *    tài liệu đi thẳng vào `questionText`.
 * 2. Đáp án đúng/sai của từng mệnh đề KHÔNG nằm trong tài liệu: nó là
 *    metadata có cấu trúc ở ngoài — bản đồ `statementId → boolean` do
 *    `TrueFalseEditor` giữ qua cặp radio Đ/S vẽ cạnh từng statement;
 *    khi lưu, bản đồ này thành `solution.answers` của payload (tầng
 *    nghiệp vụ ghi vào `question_answer_keys.solution`).
 * 3. Khi nạp một câu có sẵn, {@link composeTrueFalseDocument} chuẩn
 *    hoá tài liệu thân câu đã lưu về đúng khuôn soạn (chốt đuôi bằng
 *    statementList đúng 4 mệnh đề); đáp án nạp riêng từ phía đáp án
 *    của version (`answerKey.solution`).
 *
 * Bất biến quan trọng: id của statement là neo của đáp án — sửa nội
 * dung một mệnh đề không đổi id của nó, nên đáp án Đ/S và đáp án học
 * sinh chọn luôn bám đúng mệnh đề qua mọi lần sửa nội dung; mệnh đề
 * mới sinh id mới và chưa có đáp án cho tới khi người soạn chọn Đ/S.
 */

export { TRUE_FALSE_STATEMENT_COUNT };

/** Tên node danh sách mệnh đề trong tài liệu (khớp hợp đồng contracts). */
export const STATEMENT_LIST_NODE_TYPE = 'statementList';

/** Tên node một mệnh đề trong tài liệu (khớp hợp đồng contracts). */
export const STATEMENT_NODE_TYPE = 'statement';

/**
 * Một mệnh đề trong tài liệu soạn: node `statement` với `attrs.id` là định danh ổn định và `content` là các block rich text của nội dung mệnh đề (cùng lát block với hợp đồng).
 */
export interface TrueFalseStatementJson {
  type: typeof STATEMENT_NODE_TYPE;
  attrs: { id: string };
  content?: JSONContent[];
}

/**
 * Tài liệu phía soạn của câu đúng/sai chùm: một `doc` mà phần tử cuối
 * là đúng một `statementList` chứa các {@link TrueFalseStatementJson};
 * mọi phần tử trước nó là block nội dung của thân câu. Hình dạng này
 * TRÙNG hình dạng lưu trữ trong hợp đồng (khác tài liệu trắc nghiệm
 * thống nhất vốn chỉ sống phía soạn).
 */
export interface TrueFalseDocumentJson {
  type: 'doc';
  content: JSONContent[];
}

/**
 * Sinh định danh cho một mệnh đề mới — dùng chung {@link newItemId}
 * với tiền tố `statement` (xem `item-list.ts`). Cùng kỷ luật với
 * `newChoiceId`: `crypto.randomUUID` của nền tảng; môi trường thiếu
 * API đó thì rơi về bộ đếm + thời gian — id chỉ cần duy nhất và ổn
 * định trong vòng đời của version.
 *
 * @returns Chuỗi định danh mới cho mệnh đề.
 */
export function newStatementId(): string {
  return newItemId('statement');
}

/**
 * Node gốc của tài liệu đúng/sai: thay node `doc` mặc định của Tiptap
 * bằng biến thể bắt buộc tài liệu kết thúc bằng đúng một
 * `statementList` (`block+ statementList`) — mệnh đề không thể bị xoá
 * khỏi tài liệu hay chèn nội dung sau danh sách mệnh đề.
 */
export const TrueFalseDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: `block+ ${STATEMENT_LIST_NODE_TYPE}`,
});

/**
 * Node danh sách mệnh đề: chứa đúng {@link TRUE_FALSE_STATEMENT_COUNT}
 * `statement`, `isolating` để thao tác soạn (xoá/gộp đoạn) không phá
 * vỡ biên của danh sách.
 */
export const StatementList = Node.create({
  name: STATEMENT_LIST_NODE_TYPE,
  content: `${STATEMENT_NODE_TYPE}{${TRUE_FALSE_STATEMENT_COUNT}}`,
  isolating: true,
  parseHTML: () => [{ tag: 'ol[data-statement-list]' }],
  renderHTML: () => ['ol', { 'data-statement-list': '', class: 'giaokhoa-statement-list' }, 0],
});

/**
 * Node một mệnh đề: nội dung là các block rich text (`block+`),
 * `defining` để định dạng không rò qua biên mệnh đề. Thuộc tính `id`
 * do {@link StatementUniqueId} bảo đảm luôn có — đáp án Đ/S bám theo
 * id này.
 */
export const Statement = Node.create({
  name: STATEMENT_NODE_TYPE,
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      id: { default: null },
    };
  },
  parseHTML: () => [{ tag: 'li[data-statement]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'li',
    mergeAttributes(HTMLAttributes, { 'data-statement': '', class: 'giaokhoa-statement' }),
    0,
  ],
});

/**
 * Plugin bảo đảm mọi node `statement` trong tài liệu luôn có
 * `attrs.id`: sau mỗi transaction, statement nào thiếu id (vừa được
 * tạo khi người soạn tách/gộp đoạn, hoặc tài liệu nạp vào chưa có)
 * được gán một id mới bằng `setNodeMarkup` trong một transaction nối
 * tiếp — dùng chung factory `createItemUniqueIdExtension` của
 * `item-list.ts` với node type `statement`. Cùng cơ chế với
 * `ChoiceUniqueId` của trắc nghiệm: id phải nằm TRONG tài liệu vì đáp
 * án bám theo nó qua mọi thao tác soạn.
 */
export const StatementUniqueId = createItemUniqueIdExtension({
  name: 'statementUniqueId',
  itemNodeType: STATEMENT_NODE_TYPE,
  newId: newStatementId,
});

/**
 * Bộ extension của editor đúng/sai chùm: toàn bộ lát soạn của hợp
 * đồng ({@link plainTextExtensions}) TRỪ node `doc` mặc định, cộng
 * node `doc` bắt buộc chốt đuôi bằng danh sách mệnh đề, hai node
 * mệnh đề và plugin định danh statement.
 */
export const trueFalseExtensions = [
  ...plainTextExtensions.filter((extension) => extension.name !== 'doc'),
  TrueFalseDocument,
  StatementList,
  Statement,
  StatementUniqueId,
];

/**
 * Tách tài liệu đúng/sai thành phần thân câu (stem) và danh sách mệnh
 * đề (mẫu `splitTrueFalseDocument` của giaokhoa). Phần stem là tài
 * liệu thuần KHÔNG còn node `statementList`; phần mệnh đề là các node
 * statement theo đúng thứ tự trong tài liệu — thứ tự này là thứ tự
 * trình bày mệnh đề (a, b, c, d) ở mọi bề mặt.
 *
 * @param content - Tài liệu đúng/sai (soạn hoặc đã lưu).
 * @returns `stem` là tài liệu thân câu và `statements` là các mệnh
 *   đề theo thứ tự; tài liệu không có `statementList` thì
 *   `statements` rỗng và `stem` là chính tài liệu.
 */
export function splitTrueFalseDocument(content: TrueFalseDocumentJson): {
  stem: JSONContent;
  statements: TrueFalseStatementJson[];
} {
  const { body, items } = splitItemListDocument(content, {
    listNodeType: STATEMENT_LIST_NODE_TYPE,
    itemNodeType: STATEMENT_NODE_TYPE,
    isItem: (statement): statement is TrueFalseStatementJson =>
      statement.type === STATEMENT_NODE_TYPE,
  });
  return { stem: body, statements: items };
}

/**
 * Các id mệnh đề của tài liệu theo thứ tự trình bày.
 *
 * @param content - Tài liệu đúng/sai.
 * @returns Mảng id của các statement trong `statementList` chốt đuôi.
 */
export function getTrueFalseStatementIds(content: TrueFalseDocumentJson): string[] {
  return splitTrueFalseDocument(content).statements.map((statement) => statement.attrs.id);
}

/**
 * Tài liệu đúng/sai rỗng cho một câu mới: một paragraph thân câu +
 * danh sách đúng {@link TRUE_FALSE_STATEMENT_COUNT} mệnh đề rỗng, mỗi
 * mệnh đề có id mới (chưa có đáp án Đ/S — người soạn chọn ở bước sau).
 *
 * @returns Tài liệu đúng/sai rỗng.
 */
export function createEmptyTrueFalseDocument(): TrueFalseDocumentJson {
  return createEmptyItemListDocument({
    listNodeType: STATEMENT_LIST_NODE_TYPE,
    itemNodeType: STATEMENT_NODE_TYPE,
    itemCount: TRUE_FALSE_STATEMENT_COUNT,
    newId: newStatementId,
  });
}

/**
 * Chuẩn hoá một thân câu đúng/sai ĐÃ LƯU thành tài liệu phía soạn
 * (chiều nạp lên editor): tài liệu hợp đồng vốn đã mang sẵn danh sách
 * mệnh đề — hàm này chỉ là lưới an toàn cho dữ liệu lạ/thiếu: tài
 * liệu chưa chốt đuôi bằng `statementList` thì gắn một danh sách
 * mệnh đề rỗng; danh sách thiếu mệnh đề thì đệm mệnh đề rỗng có id
 * mới; thừa thì giữ {@link TRUE_FALSE_STATEMENT_COUNT} mệnh đề đầu
 * theo thứ tự. Mệnh đề đã có giữ nguyên id và nội dung.
 *
 * @param questionText - Tài liệu thân câu của phiên bản (rỗng/`null`
 *   thì đệm một paragraph rỗng + danh sách mệnh đề rỗng).
 * @returns Tài liệu đúng/sai sẵn sàng nạp vào editor.
 */
export function composeTrueFalseDocument(
  questionText: RichTextDocument | null | undefined,
): TrueFalseDocumentJson {
  const source = (questionText?.content ?? []) as JSONContent[];
  const { stem, statements } = splitTrueFalseDocument({ type: 'doc', content: source });
  const normalised = completeItemList(
    statements.map((statement) =>
      itemFromBlocks(
        STATEMENT_NODE_TYPE,
        statement.attrs.id,
        statement.content,
      ),
    ),
    TRUE_FALSE_STATEMENT_COUNT,
    () => itemFromBlocks(STATEMENT_NODE_TYPE, newStatementId(), undefined),
  );
  const stemBlocks = stem.content ?? [];
  return {
    type: 'doc',
    content: [
      ...(stemBlocks.length > 0 ? stemBlocks : [emptyParagraph()]),
      { type: STATEMENT_LIST_NODE_TYPE, content: normalised },
    ],
  };
}

/**
 * Một tài liệu đúng/sai đã sẵn sàng để lưu hay chưa, theo đúng luật
 * hợp đồng phía API: thân câu có nội dung, đủ
 * {@link TRUE_FALSE_STATEMENT_COUNT} mệnh đề đều có nội dung, và MỌI
 * mệnh đề đều đã có đáp án Đúng/Sai trong bản đồ đáp án. Dùng để bề
 * mặt chứa quyết định trạng thái nút lưu/cảnh báo tại chỗ; cổng cứng
 * vẫn là kiểm tra ở contracts + tầng nghiệp vụ phía API.
 *
 * @param content - Tài liệu đúng/sai cần kiểm.
 * @param answers - Bản đồ đáp án theo id mệnh đề (`true` = Đúng,
 *   `false` = Sai; vắng mặt = chưa chọn).
 * @returns `true` khi tài liệu đủ điều kiện lưu thành câu sẵn sàng.
 */
export function isCompleteTrueFalse(
  content: TrueFalseDocumentJson,
  answers: Readonly<Record<string, boolean | undefined>>,
): boolean {
  const doc = content as unknown as RichTextDocument;
  const statements = getTrueFalseStatements(doc);
  if (!statements || statements.length !== TRUE_FALSE_STATEMENT_COUNT) {
    return false;
  }
  const stemBlocks = doc.content.slice(0, -1);
  if (!richTextBlocksHaveContent(stemBlocks)) {
    return false;
  }
  return statements.every(
    (statement) =>
      richTextBlocksHaveContent(statement.content) && typeof answers[statement.id] === 'boolean',
  );
}
