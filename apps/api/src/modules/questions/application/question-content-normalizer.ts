/**
 * Chuẩn hoá payload câu hỏi từ mọi bề mặt (REST, MCP, nhân bản) thành
 * answers/options/answer key để tầng service lưu trong một giao dịch.
 *
 * Các bất biến qtype được kiểm tại đây ngay cả khi caller không đi qua
 * ValidationPipe của Nest; không truy cập DB, không giữ trạng thái request.
 */
import { BadRequestException } from '@nestjs/common';
import {
  getTrueFalseStatements, richTextBlocksContainStatementList,
  richTextBlocksHaveContent, toRichTextDocument, TRUE_FALSE_STATEMENT_COUNT,
  type RichTextDocument, type RichTextInput,
} from '@giaokhoa/contracts';

/** Một đáp án trong payload cấu trúc theo qtype (đầu vào của API): cờ `correct` đúng/sai NHỊ PHÂN — tỉ trọng fraction đã bỏ hẳn (quyết 12:04 ngày 26/10/2026). */
export interface QuestionAnswerInput {
  text: RichTextInput;
  correct?: boolean;
  feedback?: RichTextInput;
}

/** Options trong payload theo qtype — mỗi qtype chỉ dùng phần trường của nó (service kiểm chứng). */
export interface QuestionOptionsInput {
  shuffleAnswers?: boolean;
  answerNumbering?: string;
  showStandardInstruction?: boolean;
  correctFeedback?: RichTextInput;
  incorrectFeedback?: RichTextInput;
  useCase?: boolean;
  numericAnswer?: boolean;
  numericMaxLength?: number | null;
  numericAllowSign?: boolean;
  numericAllowDecimal?: boolean;
  responseFormat?: string;
  responseRequired?: boolean;
  responseFieldLines?: number;
  minWordLimit?: number | null;
  maxWordLimit?: number | null;
  graderInfo?: RichTextInput;
  responseTemplate?: RichTextInput;
}

/** Payload tạo/sửa câu hỏi: một payload cấu trúc, service tự bung ra bảng khi lưu. */
export interface QuestionContentInput {
  questionText?: RichTextInput;
  generalFeedback?: RichTextInput;
  /** Hướng dẫn (guidance) — ghi vào bản ghi phía đáp án `question_answer_keys` của version, KHÔNG còn nằm trên dòng version (quyết 12:12 ngày 26/10/2026). */
  guidance?: RichTextInput;
  defaultMark?: number;
  penalty?: number;
  stimulusId?: string | null;
  answers?: QuestionAnswerInput[];
  options?: QuestionOptionsInput;
  /**
   * Phía đáp án do người soạn gửi lên, ghi vào `question_answer_keys.solution`:
   * essay gửi lời giải mẫu dạng `{answer}`; truefalse TF-A gửi đáp án từng mệnh đề dạng `{answers: [{statementId, value}]}`.
   */
  solution?: { answer: RichTextInput } | { answers: { statementId: string; value: boolean }[] };
}


export const SUPPORTED_QTYPES = ['multichoice', 'truefalse', 'shortanswer', 'essay'] as const;
export type SupportedQtype = (typeof SUPPORTED_QTYPES)[number];

/**
 * Hình dạng solution LƯU TRỮ ở `question_answer_keys.solution`: lời giải mẫu của essay (`{answer}`) hoặc đáp án Đúng/Sai từng mệnh đề của truefalse TF-A (`{answers}` bám theo statementId của thân câu).
 */
export type StoredSolution =
  | { answer: RichTextDocument }
  | { answers: { statementId: string; value: boolean }[] };

/** Nội dung đã chuẩn hoá, sẵn sàng ghi xuống question_answers + bảng options. */
export interface NormalisedContent {
  answers: { answer: RichTextDocument; isCorrect: boolean; feedback: RichTextDocument | null }[];
  multichoice?: { shuffleAnswers: boolean; answerNumbering: string; correctFeedback: RichTextDocument | null; incorrectFeedback: RichTextDocument | null; showStandardInstruction: boolean };
  shortanswer?: { useCase: boolean; numericAnswer: boolean; numericMaxLength: number | null; numericAllowSign: boolean; numericAllowDecimal: boolean };
  essay?: { responseFormat: string; responseRequired: boolean; responseFieldLines: number; minWordLimit: number | null; maxWordLimit: number | null; graderInfo: RichTextDocument | null; responseTemplate: RichTextDocument | null };
  /** Nội dung phía đáp án ghi vào `question_answer_keys` cùng giao dịch với version: guidance (mọi qtype) + solution (essay: lời giải mẫu; truefalse TF-A: đáp án từng mệnh đề). Cả hai null thì không chèn dòng nào. */
  answerKey: { guidance: RichTextDocument | null; solution: StoredSolution | null };
}


/** Mã lỗi bất biến khi dữ liệu đáp án không hợp lệ từ REST hay MCP. */
export function badAnswerData(message: string): BadRequestException {
  return new BadRequestException({ message, code: 'question.bad_answer_data' });
}

/** Từ chối qtype chưa được lõi hỗ trợ trước khi tạo question/version. */
export function assertSupportedQtype(qtype: string): asserts qtype is SupportedQtype {
  if (!(SUPPORTED_QTYPES as readonly string[]).includes(qtype)) {
    throw new BadRequestException({ message: `qtype ${qtype} is not one of the standard Moodle qtypes supported by the core (multichoice, truefalse, shortanswer, essay)`, code: 'question.qtype_not_supported' });
  }
}

/** Chuyển nội dung tùy chọn sang document nhất quán cho DB. */
export function docOrNull(input: RichTextInput | undefined): RichTextDocument | null {
  return input === undefined ? null : toRichTextDocument(input);
}


/**
 * Chuẩn hoá phần đáp án/options của payload thành nội dung ghi xuống
 * bảng, theo luật mô hình giaokhoa (quyết 12:04 + các điểm quyết D
 * ngày 26/10/2026 — cùng luật mà `createQuestionSchema` của contracts
 * kiểm ở cửa HTTP; service kiểm LẠI ở đây vì các đường nội bộ (MCP,
 * nhân bản) không đi qua schema HTTP):
 *  - multichoice: đúng 4 lựa chọn (D-3) và đúng MỘT đáp án đúng.
 *  - truefalse (TF-A, điểm quyết D-1): KHÔNG có dòng answers. Thân
 *    câu (`questionText`, hoặc thân câu đã lưu khi sửa mà không gửi
 *    thân mới) phải là tài liệu chốt đuôi bằng đúng 4 mệnh đề; đáp
 *    án từng mệnh đề đi qua `solution.answers` phủ đúng tập mệnh đề
 *    đó và được sắp lại theo đúng thứ tự mệnh đề trong thân câu khi
 *    ghi vào `question_answer_keys.solution`. Đường sửa chỉ gửi
 *    thân câu mới mà không gửi `solution` thì phía đáp án kế thừa
 *    của version trước do `updateQuestion` ghép sau bước này — NHƯNG
 *    chỉ khi tập statementId của thân mới == tập solution cũ phủ,
 *    khác thì `updateQuestion` từ chối 400 (bề mặt soạn luôn gửi kèm
 *    đáp án cùng thân câu nên không đi qua đường kế thừa này).
 *  - shortanswer: ít nhất 1 đáp án được chấp nhận; MỌI dòng liệt kê
 *    đều là đáp án được chấp nhận (dòng `correct: false` bị từ chối —
 *    đáp án sai không có chỗ trong danh sách này).
 *  - essay: không có dòng đáp án; options mang cấu hình trả lời +
 *    graderInfo + responseTemplate; giới hạn từ phải hợp lệ
 *    (min ≤ max). Lời giải mẫu đi qua `solution.answer`.
 * guidance đi vào `answerKey` (bản ghi phía đáp án) cho MỌI qtype.
 *
 * @param qtype - dạng câu đã qua `assertSupportedQtype`.
 * @param input - payload cấu trúc của người soạn.
 * @returns Nội dung đã chuẩn hoá, sẵn sàng cho `writeVersionContent`.
 * @throws BadRequestException `question.bad_answer_data` khi phần đáp
 *   án/options vi phạm luật của qtype.
 */
export function normaliseQuestionContent(qtype: SupportedQtype, input: QuestionContentInput, existingQuestionText?: RichTextDocument | null): NormalisedContent {
  const options = input.options ?? {};
  const answerKey: NormalisedContent['answerKey'] = {
    guidance: docOrNull(input.guidance),
    solution: qtype === 'essay' && input.solution !== undefined && 'answer' in input.solution
      ? { answer: toRichTextDocument(input.solution.answer) }
      : null,
  };
  if (qtype === 'truefalse') {
    if (input.answers && input.answers.length > 0) {
      throw badAnswerData('truefalse (TF-A) questions do not carry answer rows; per-statement answers go through solution.answers');
    }
    // Thân câu hiệu lực: payload gửi thân mới thì dùng thân mới; đường
    // sửa không gửi thân thì kiểm trên thân đã lưu của version trước.
    const doc = input.questionText !== undefined
      ? (typeof input.questionText === 'string' ? null : toRichTextDocument(input.questionText))
      : (existingQuestionText ?? null);
    const statements = doc ? getTrueFalseStatements(doc) : null;
    if (!doc || !statements) {
      throw badAnswerData('truefalse question text must be a document ending with a statement list (statementList)');
    }
    const stemBlocks = doc.content.slice(0, -1);
    if (!richTextBlocksHaveContent(stemBlocks) || richTextBlocksContainStatementList(stemBlocks)) {
      throw badAnswerData('truefalse stem must carry content before the statement list');
    }
    if (statements.length !== TRUE_FALSE_STATEMENT_COUNT) {
      throw badAnswerData(`truefalse requires exactly ${TRUE_FALSE_STATEMENT_COUNT} statements`);
    }
    if (new Set(statements.map((s) => s.id)).size !== statements.length) {
      throw badAnswerData('truefalse statements must have unique ids');
    }
    if (statements.some((s) => !richTextBlocksHaveContent(s.content) || richTextBlocksContainStatementList(s.content))) {
      throw badAnswerData('every truefalse statement must carry content');
    }
    const solutionAnswers = input.solution !== undefined && 'answers' in input.solution ? input.solution.answers : null;
    if (!solutionAnswers) {
      // Đường sửa không gửi solution: để null, updateQuestion kế thừa
      // phía đáp án của version trước. Đường tạo mới (không có thân
      // đã lưu) thì đáp án là bắt buộc — thiếu là payload lỗi.
      if (existingQuestionText === undefined || existingQuestionText === null) {
        throw badAnswerData('truefalse requires solution.answers with a Đúng/Sai value for every statement');
      }
      return { answers: [], answerKey };
    }
    const statementIds = new Set(statements.map((s) => s.id));
    const covered = new Set(solutionAnswers.map((a) => a.statementId));
    if (solutionAnswers.length !== statements.length || covered.size !== solutionAnswers.length
      || [...covered].some((id) => !statementIds.has(id))) {
      throw badAnswerData('truefalse solution.answers must cover exactly the statements of the question text');
    }
    return {
      answers: [],
      answerKey: {
        guidance: answerKey.guidance,
        // Ghi theo đúng thứ tự mệnh đề trong thân câu: phía đọc/chấm
        // bám statementId, thứ tự chỉ để trình bày nhất quán.
        solution: {
          answers: statements.map((s) => ({
            statementId: s.id,
            value: solutionAnswers.find((a) => a.statementId === s.id)!.value === true,
          })),
        },
      },
    };
  }
  if (qtype === 'essay') {
    if (input.answers && input.answers.length > 0) throw badAnswerData('essay questions do not carry answers; the response is graded manually');
    const min = options.minWordLimit ?? null;
    const max = options.maxWordLimit ?? null;
    if (min !== null && max !== null && min > max) throw badAnswerData('essay minWordLimit must not exceed maxWordLimit');
    return {
      answers: [],
      essay: {
        responseFormat: options.responseFormat ?? 'editor',
        responseRequired: options.responseRequired ?? true,
        responseFieldLines: options.responseFieldLines ?? 15,
        minWordLimit: min, maxWordLimit: max,
        graderInfo: docOrNull(options.graderInfo),
        responseTemplate: docOrNull(options.responseTemplate),
      },
      answerKey,
    };
  }
  const rawAnswers = input.answers;
  if (!rawAnswers || rawAnswers.length === 0) {
    throw badAnswerData(`${qtype} requires at least one answer in the structured answers list`);
  }
  const answers = rawAnswers.map((a) => ({
    answer: toRichTextDocument(a.text),
    isCorrect: a.correct === true,
    feedback: a.feedback === undefined ? null : toRichTextDocument(a.feedback),
  }));
  const correctCount = answers.filter((a) => a.isCorrect).length;
  if (qtype === 'shortanswer') {
    if (answers.some((a) => !a.isCorrect)) {
      throw badAnswerData('shortanswer answers are all accepted answers; a listed answer cannot be marked incorrect');
    }
    return {
      answers,
      shortanswer: {
        useCase: options.useCase ?? false,
        numericAnswer: options.numericAnswer ?? false,
        numericMaxLength: options.numericMaxLength ?? null,
        numericAllowSign: options.numericAllowSign ?? true,
        numericAllowDecimal: options.numericAllowDecimal ?? true,
      },
      answerKey,
    };
  }
  // multichoice
  if (answers.length !== 4) throw badAnswerData('multichoice requires exactly four choices');
  if (correctCount !== 1) throw badAnswerData('multichoice requires exactly one correct answer');
  return {
    answers,
    multichoice: {
      shuffleAnswers: options.shuffleAnswers ?? false,
      answerNumbering: options.answerNumbering ?? 'abc',
      correctFeedback: docOrNull(options.correctFeedback),
      incorrectFeedback: docOrNull(options.incorrectFeedback),
      showStandardInstruction: options.showStandardInstruction ?? true,
    },
    answerKey,
  };
}
