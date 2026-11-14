import { UnprocessableEntityException } from '@nestjs/common';
import { badRequest, unprocessableEntity } from '../../common/http-errors';
import type { PaperSlotLayout, RichTextDocument } from '@giaokhoa/contracts';
import { getTrueFalseStatements, TRUE_FALSE_STATEMENT_COUNT } from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { CurriculumService } from '../curriculum/curriculum.service';
import { QuestionsService, type QuestionView } from '../questions/questions.service';
import { QUIZ_PIN_ATTEMPTS_LIMIT, QuizRepository, type ExamMatrixCellRow, type ExamMatrixRow } from '@giaokhoa/db/repositories/quiz';
import { QuizSharedService } from './quiz-shared.service';
import { QuizAttemptsService } from './quiz-attempts.service';
import { QUIZ_COMPONENT } from './quiz-shared.service';
import { QUIZ_CAPABILITIES } from './quiz-shared.service';
import type { MatrixSpecification, SpecificationSlot, PinRow } from './quiz.service';

export const QTYPE_LABELS: Record<string, string> = {
  multichoice: 'Trắc nghiệm',
  truefalse: 'Đúng–Sai',
  shortanswer: 'Trả lời ngắn',
  essay: 'Tự luận',
};

export const LEVEL_LABELS: Record<string, string> = {
  biet: 'Biết',
  hieu: 'Hiểu',
  van_dung: 'Vận dụng',
  van_dung_cao: 'Vận dụng cao',
};

export function flattenSpecification(spec: MatrixSpecification): {
  index: number; topicTitle: string; nodeTitle: string; outcomeText: string;
  levelLabel: string; qtypeLabel: string; questionCount: number; cellScore: number; slotText: string;
}[] {
  const rows: {
    index: number; topicTitle: string; nodeTitle: string; outcomeText: string;
    levelLabel: string; qtypeLabel: string; questionCount: number; cellScore: number; slotText: string;
  }[] = [];
  let index = 0;
  for (const topic of spec.topics) {
    for (const node of topic.nodes) {
      const outcomeText = node.outcomes.map((outcome) => {
        const prefix = outcome.code ? `${outcome.code} ` : '';
        return outcome.derivedContent
          ? `${prefix}${outcome.programContent ?? ''}\n(Tách mức: ${outcome.derivedContent})`
          : `${prefix}${outcome.programContent ?? outcome.content}`;
      }).join('\n');
      for (const cell of node.cells) {
        index += 1;
        const slotText = cell.slotNumbers && cell.slotNumbers.length
          ? (cell.drawNote ? `${cell.drawNote} (vị trí ${cell.slotNumbers.join(', ')})` : cell.slotNumbers.join(', '))
          : (cell.drawNote ?? '');
        rows.push({
          index,
          topicTitle: topic.topicTitle,
          nodeTitle: node.nodeTitle,
          outcomeText,
          levelLabel: LEVEL_LABELS[cell.cognitiveLevel] ?? cell.cognitiveLevel,
          qtypeLabel: QTYPE_LABELS[cell.qtype] ?? cell.qtype,
          questionCount: cell.questionCount,
          cellScore: cell.cellScore,
          slotText,
        });
      }
    }
  }
  return rows;
}


export class QuizGenerationService {
  constructor(
    private readonly repo: QuizRepository,
    private readonly questions: QuestionsService,
    private readonly curriculum: CurriculumService,
    private readonly outbox: OutboxService,
    private readonly shared: QuizSharedService,
    private readonly attempts: QuizAttemptsService,
  ) {}

  private shuffled<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  private async matrixDeficits(actorId: string, cells: ExamMatrixCellRow[]): Promise<{
    deficits: { cellId: string; curriculumNodeId: string; cognitiveLevel: string; qtype: string; required: number; available: number; deficit: number }[];
    pools: Map<string, { candidates: QuestionView[] }>;
  }> {
    const deficits: { cellId: string; curriculumNodeId: string; cognitiveLevel: string; qtype: string; required: number; available: number; deficit: number }[] = [];
    const pools = new Map<string, { candidates: QuestionView[] }>();
    for (const cell of cells) {
      const candidates = await this.shared.cellCandidatesForUser(actorId, cell);
      pools.set(cell.id, { candidates });
      const available = candidates.length;
      if (available < cell.questionCount) {
        deficits.push({
          cellId: cell.id, curriculumNodeId: cell.curriculumNodeId,
          cognitiveLevel: cell.cognitiveLevel, qtype: cell.qtype,
          required: cell.questionCount, available, deficit: cell.questionCount - available,
        });
      }
    }
    return { deficits, pools };
  }


  async matrixForGeneration(actorId: string, matrixId: string): Promise<{ matrix: ExamMatrixRow; cells: ExamMatrixCellRow[] }> {
    const matrix = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, matrix, QUIZ_CAPABILITIES.manageMatrix);
    const cells = await this.repo.listMatrixCells(matrix.id);
    if (!cells.length) {
      badRequest('This matrix has no cells yet', 'quiz.matrix_empty');
    }
    return { matrix, cells };
  }

  async drawFixedSlots(actorId: string, cells: ExamMatrixCellRow[]): Promise<{
    questionId: string; matrixCellId: string; maxMark: number; page: number;
  }[]> {
    const { deficits, pools } = await this.matrixDeficits(actorId, cells);
    if (deficits.length) {
      throw new UnprocessableEntityException({
        message: deficits.map((d) => `cell ${d.cellId} (node ${d.curriculumNodeId}, ${d.cognitiveLevel}/${d.qtype}): required ${d.required}, available ${d.available}, deficit ${d.deficit}`),
        code: 'quiz.matrix_insufficient_questions',
      });
    }
    const chosen = new Set<string>();
    const out: { questionId: string; matrixCellId: string; maxMark: number; page: number }[] = [];
    let page = 0;
    for (const cell of cells) {
      page += 1;
      const pool = pools.get(cell.id)!;
      const perUnit = cell.cellScore / cell.questionCount;
      const fresh = this.shuffled(pool.candidates.filter((v) => !chosen.has(v.question.id)));
      let picked = fresh.slice(0, cell.questionCount);
      if (picked.length < cell.questionCount) {
        const rest = this.shuffled(pool.candidates.filter((v) => !picked.some((p) => p.question.id === v.question.id)));
        picked = [...picked, ...rest.slice(0, cell.questionCount - picked.length)];
      }
      for (const member of picked) {
        out.push({ questionId: member.question.id, matrixCellId: cell.id, maxMark: perUnit, page });
        chosen.add(member.question.id);
      }
    }
    return out;
  }

  async cellPoolContains(cellId: string, questionId: string): Promise<boolean> {
    const cell = await this.repo.getMatrixCell(cellId);
    if (!cell) return false;
    const candidates = await this.shared.cellCandidates(cell);
    return candidates.some((v) => v.question.id === questionId);
  }

  private async assertNoRealAttempts(quiz: PinRow): Promise<void> {
    const attempts = await this.repo.listAttempts(quiz.id, QUIZ_PIN_ATTEMPTS_LIMIT);
    if (attempts.some((a) => !a.preview)) {
      badRequest('This quiz already has real attempts; its slots are frozen', 'quiz.slots_frozen');
    }
  }

  async getMatrixSpecification(actorId: string, matrixId: string, pinId?: string): Promise<MatrixSpecification> {
    const matrix = await this.shared.getMatrixRow(matrixId);
    await this.shared.requireMatrixCap(actorId, matrix, QUIZ_CAPABILITIES.viewMatrix);
    let quiz: PinRow | null = null;
    let slots: SpecificationSlot[] | null = null;
    if (pinId) {
      quiz = await this.shared.getPin(pinId);
      if (quiz.matrixId !== matrix.id) {
        badRequest('The quiz was not generated from this matrix', 'quiz.spec_quiz_mismatch');
      }
      slots = (await this.shared.effectiveSlots(quiz)).map((s) => ({
        matrixCellId: s.matrixCellId, slot: s.slot, questionId: s.questionId,
      }));
    }
    return this.buildSpecification(actorId, matrix, {
      quiz: quiz ? { id: quiz.id, name: quiz.name } : null, slots,
    });
  }

  async buildSpecificationForPaper(actorId: string, matrixId: string, paperSlots: { matrixCellId: string | null; position: number; questionId: string | null }[]): Promise<MatrixSpecification> {
    const matrix = await this.shared.getMatrixRow(matrixId);
    return this.buildSpecification(actorId, matrix, {
      quiz: null,
      slots: paperSlots.map((s) => ({ matrixCellId: s.matrixCellId, slot: s.position, questionId: s.questionId })),
    });
  }

  private async buildSpecification(_actorId: string, matrix: ExamMatrixRow, opts: {
    quiz: { id: string; name: string } | null;
    slots: SpecificationSlot[] | null;
  }): Promise<MatrixSpecification> {
    const subject = await this.curriculum.getSubjectReference(matrix.subjectId);
    const curriculum = await this.curriculum.getCurriculumReference(matrix.curriculumId);
    const cells = await this.repo.listMatrixCells(matrix.id);
    const slots = opts.slots;
    const nodeCache = new Map<string, Awaited<ReturnType<CurriculumService['getNodeReference']>>>();
    const getNode = async (id: string) => {
      let node = nodeCache.get(id);
      if (!node) {
        node = await this.curriculum.getNodeReference(id);
        nodeCache.set(id, node);
      }
      return node;
    };
    type OutcomeAcc = MatrixSpecification['topics'][number]['nodes'][number]['outcomes'][number];
    const recordIdByNode = new Map<string, string | null>();
    const recordIdForNode = async (nodeId: string): Promise<string | null> => {
      let recordId = recordIdByNode.get(nodeId);
      if (recordId === undefined) {
        recordId = await this.curriculum.programRecordIdForNode(nodeId);
        recordIdByNode.set(nodeId, recordId);
      }
      return recordId;
    };
    const outcomeCode = (recordId: string | null, position: number): string | null =>
      (recordId ? `${recordId}.${String(position).padStart(2, '0')}` : null);
    type NodeCells = MatrixSpecification['topics'][number]['nodes'][number]['cells'];
    const topicMap = new Map<string, { topicId: string | null; topicTitle: string; nodes: Map<string, { nodeId: string; nodeTitle: string; outcomes: Map<string, OutcomeAcc>; cells: NodeCells }> }>();
    const byForm = new Map<string, { qtype: string; questionCount: number; score: number }>();
    let totalQuestions = 0;
    for (const cell of cells) {
      const node = await getNode(cell.curriculumNodeId);
      let topic = node;
      let cursor = node;
      while (cursor.parentId) {
        const parent = await getNode(cursor.parentId);
        if (parent.kind === 'topic' && topic.kind !== 'topic') topic = parent;
        cursor = parent;
      }
      if (topic.kind !== 'topic') topic = cursor;
      const topicKey = topic.id;
      let topicAcc = topicMap.get(topicKey);
      if (!topicAcc) {
        topicAcc = { topicId: topic.id, topicTitle: topic.title, nodes: new Map() };
        topicMap.set(topicKey, topicAcc);
      }
      let nodeAcc = topicAcc.nodes.get(node.id);
      if (!nodeAcc) {
        nodeAcc = { nodeId: node.id, nodeTitle: node.title, outcomes: new Map(), cells: [] };
        topicAcc.nodes.set(node.id, nodeAcc);
        const outcomes = await this.curriculum.listOutcomesReference(node.id);
        for (const outcome of outcomes) {
          let programContent: string;
          let derivedContent: string | null = null;
          let position: number | null = outcome.position;
          let code: string | null;
          if (outcome.sourceKind === 'derived' && outcome.derivedFromId) {
            const parent = await this.curriculum.getOutcomeReference(outcome.derivedFromId).catch(() => undefined);
            if (!parent || parent.retiredAt !== null) continue;
            programContent = parent.content;
            derivedContent = outcome.content;
            position = parent.position;
            code = outcomeCode(await recordIdForNode(parent.nodeId), parent.position);
          } else {
            programContent = outcome.content;
            code = outcomeCode(await recordIdForNode(node.id), outcome.position);
          }
          nodeAcc.outcomes.set(outcome.id, {
            outcomeId: outcome.id, content: outcome.content, sourceKind: outcome.sourceKind,
            sourceRef: outcome.sourceRef, programContent, derivedContent, position, code,
          });
        }
      }
      const cellSlots = slots ? slots.filter((s) => s.matrixCellId === cell.id) : [];
      const perStudent = cellSlots.length > 0 && cellSlots.every((s) => s.questionId === null);
      nodeAcc.cells.push({
        cellId: cell.id, cognitiveLevel: cell.cognitiveLevel, qtype: cell.qtype,
        questionCount: cell.questionCount, cellScore: cell.cellScore, minutes: cell.minutes,
        slotNumbers: slots ? cellSlots.map((s) => s.slot).sort((a, b) => a - b) : null,
        drawNote: slots && perStudent ? 'Rút ngẫu nhiên theo ô' : null,
        competencyRefs: [],
      });
      const formAcc = byForm.get(cell.qtype) ?? { qtype: cell.qtype, questionCount: 0, score: 0 };
      formAcc.questionCount += cell.questionCount;
      formAcc.score += cell.cellScore;
      byForm.set(cell.qtype, formAcc);
      totalQuestions += cell.questionCount;
    }
    const totalScore = cells.reduce((s, c) => s + c.cellScore, 0);
    const formTotals = [...byForm.values()].map((f) => ({
      ...f, percent: totalScore > 0 ? Math.round((f.score / totalScore) * 1000) / 10 : 0,
    }));
    const purpose = `Đề kiểm tra định kỳ môn ${subject.name} (lớp ${curriculum.grade}) xây dựng theo hướng dẫn của Công văn 7991/BGDĐT-GDTrH, bám sát yêu cầu cần đạt của Chương trình GDPT 2018.`;
    return {
      matrix: { id: matrix.id, name: matrix.name, presetKind: matrix.presetKind, totalScore: matrix.totalScore, levelSet: matrix.levelSet },
      subject: { id: subject.id, name: subject.name },
      curriculum: { id: curriculum.id, grade: curriculum.grade },
      purpose,
      structure: formTotals,
      topics: [...topicMap.values()].map((t) => ({
        topicId: t.topicId, topicTitle: t.topicTitle,
        nodes: [...t.nodes.values()].map((n) => ({
          nodeId: n.nodeId, nodeTitle: n.nodeTitle,
          outcomes: [...n.outcomes.values()],
          cells: n.cells,
        })),
      })),
      totals: { byForm: formTotals, totalScore, totalQuestions },
      quiz: opts.quiz,
    };
  }

  async exportMatrixSpecification(actorId: string, matrixId: string, format: string, pinId?: string): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    if (format !== 'xlsx' && format !== 'docx') {
      badRequest('Specification export format must be xlsx or docx', 'quiz.spec_export_format');
    }
    const spec = await this.getMatrixSpecification(actorId, matrixId, pinId);
    return this.renderSpecification(spec, format);
  }

  async renderSpecification(spec: MatrixSpecification, format: string): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    if (format !== 'xlsx' && format !== 'docx') {
      badRequest('Specification export format must be xlsx or docx', 'quiz.spec_export_format');
    }
    const flat = flattenSpecification(spec);
    if (format === 'xlsx') {
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Bản đặc tả');
      ws.columns = [
        { width: 6 }, { width: 24 }, { width: 28 }, { width: 46 },
        { width: 12 }, { width: 14 }, { width: 9 }, { width: 9 }, { width: 16 },
      ];
      ws.mergeCells('A1:I1');
      ws.getCell('A1').value = `BẢN ĐẶC TẢ ĐỀ KIỂM TRA — ${spec.subject.name.toUpperCase()} LỚP ${spec.curriculum.grade}`;
      ws.getCell('A1').font = { bold: true, size: 14 };
      ws.mergeCells('A2:I2');
      ws.getCell('A2').value = `Ma trận: ${spec.matrix.name}`;
      ws.mergeCells('A3:I3');
      ws.getCell('A3').value = spec.purpose;
      ws.getCell('A3').alignment = { wrapText: true, vertical: 'top' };
      ws.addRow([]);
      const header = ws.addRow(['STT', 'Chủ đề', 'Nội dung / Đơn vị kiến thức', 'Yêu cầu cần đạt', 'Mức', 'Dạng câu hỏi', 'Số câu', 'Điểm', 'Số thứ tự câu trong đề']);
      header.font = { bold: true };
      for (const row of flat) {
        ws.addRow([
          row.index, row.topicTitle, row.nodeTitle, row.outcomeText, row.levelLabel,
          row.qtypeLabel, row.questionCount, row.cellScore, row.slotText,
        ]);
      }
      ws.addRow([]);
      ws.addRow(['', '', '', 'Tổng theo dạng câu hỏi', '', '', '', '', '']);
      for (const f of spec.totals.byForm) {
        ws.addRow(['', '', '', QTYPE_LABELS[f.qtype] ?? f.qtype, '', '', f.questionCount, f.score, `${f.percent}%`]);
      }
      ws.addRow(['', '', '', 'Tổng cộng', '', '', spec.totals.totalQuestions, spec.totals.totalScore, '']);
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      return { filename: `ban-dac-ta-${spec.matrix.id.slice(0, 8)}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer };
    }
    const docx = await import('docx');
    const cellOf = (text: string) => new docx.TableCell({ children: [new docx.Paragraph(text)] });
    const table = new docx.Table({
      rows: [
        new docx.TableRow({
          children: ['STT', 'Chủ đề', 'Nội dung / Đơn vị kiến thức', 'Yêu cầu cần đạt', 'Mức', 'Dạng câu hỏi', 'Số câu', 'Điểm', 'Số thứ tự câu trong đề'].map(cellOf),
        }),
        ...flat.map((row) => new docx.TableRow({
          children: [
            String(row.index), row.topicTitle, row.nodeTitle, row.outcomeText, row.levelLabel,
            row.qtypeLabel, String(row.questionCount), String(row.cellScore), row.slotText,
          ].map(cellOf),
        })),
      ],
    });
    const doc = new docx.Document({
      sections: [{
        children: [
          new docx.Paragraph({ children: [new docx.TextRun({ text: `BẢN ĐẶC TẢ ĐỀ KIỂM TRA — ${spec.subject.name.toUpperCase()} LỚP ${spec.curriculum.grade}`, bold: true })] }),
          new docx.Paragraph(`Ma trận: ${spec.matrix.name}`),
          new docx.Paragraph(spec.purpose),
          table,
          new docx.Paragraph(`Tổng cộng: ${spec.totals.totalQuestions} câu — ${spec.totals.totalScore} điểm.`),
          ...spec.totals.byForm.map((f) => new docx.Paragraph(`${QTYPE_LABELS[f.qtype] ?? f.qtype}: ${f.questionCount} câu, ${f.score} điểm (${f.percent}%).`)),
        ],
      }],
    });
    const buffer = await docx.Packer.toBuffer(doc);
    return { filename: `ban-dac-ta-${spec.matrix.id.slice(0, 8)}.docx`, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer };
  }


  async resolvePaperLayout(actorId: string, pinId: string): Promise<{ quiz: PinRow; layout: PaperSlotLayout[] }> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.gradePaper);
    const slots = await this.shared.effectiveSlots(quiz);
    if (!slots.length) badRequest('This quiz has no questions yet', 'quiz.no_questions');
    if (slots.length > 60) {
      unprocessableEntity('A paper answer sheet supports at most 60 questions', 'paper.too_many_questions');
    }
    const layout: PaperSlotLayout[] = [];
    for (const slot of slots) {
      if (!slot.questionId) {
        unprocessableEntity('Paper sheets need a fixed paper: every slot must pin a specific question (no random category/matrix slots)', 'paper.requires_fixed_slots');
      }
      const snapshot = quiz.questionSnapshots?.[slot.slot - 1];
      const view = snapshot ? null : await this.questions.getQuestion(slot.questionId);
      const qtype = snapshot?.qtype ?? view!.question.qtype;
      if (qtype !== 'multichoice' && qtype !== 'truefalse') {
        unprocessableEntity(`Question type ${qtype} cannot be printed on an OMR answer sheet`, 'paper.unsupported_qtype');
      }
      const pinnedId = slot.versionMode === 'pinned' ? slot.pinnedVersionId : null;
      const content = snapshot ? {
        version: { id: snapshot.versionId, questionText: snapshot.package.questionText },
        answers: snapshot.answerIds.map((id) => ({ id })),
      } : pinnedId && pinnedId !== view!.latestVersion.id
        ? await this.questions.getVersionContent(slot.questionId, pinnedId)
        : { version: view!.latestVersion, answers: view!.answers };
      let answerIds: string[];
      let statementIds: string[] = [];
      if (qtype === 'truefalse') {
        const statements = getTrueFalseStatements(content.version.questionText as RichTextDocument);
        if (!statements || statements.length !== TRUE_FALSE_STATEMENT_COUNT) {
          unprocessableEntity('True/false question is missing its four statements', 'paper.bad_truefalse');
        }
        statementIds = statements.map((s) => s.id);
        answerIds = [];
      } else {
        if (content.answers.length < 2 || content.answers.length > 5) {
          unprocessableEntity('A printed multichoice question needs 2–5 answers', 'paper.bad_option_count');
        }
        answerIds = content.answers.map((a) => a.id);
      }
      layout.push({
        slot: slot.slot, questionId: slot.questionId, versionId: content.version.id,
        qtype, optionCount: qtype === 'truefalse' ? statementIds.length * 2 : answerIds.length,
        answerIds, statementIds, maxMark: slot.maxMark,
      });
    }
    return { quiz, layout };
  }

  async recordPaperAttempt(actorId: string, pinId: string, input: {
    studentId: string;
    layout: PaperSlotLayout[];
    responses: (string | null)[];
    scanId: string;
    batchId: string;
    variantCode: string;
  }): Promise<{ attemptId: string; state: string; sumGrades: number | null }> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.gradePaper);
    const existing = await this.repo.listAttemptsForUser(quiz.id, input.studentId, true);
    const attemptNumber = existing.length + 1;
    const now = new Date();
    const usage = await this.questions.createUsage(input.studentId, {
      component: QUIZ_COMPONENT, instanceId: quiz.id, contextId: await this.shared.cmContextId(quiz),
      slots: input.layout.map((s) => ({ questionId: s.questionId, maxMark: s.maxMark, pinnedVersionId: s.versionId,
        snapshot: quiz.questionSnapshots?.find((q) => q.questionId === s.questionId && q.versionId === s.versionId),
      })),
    });
    try {
      await this.questions.startUsage(input.studentId, usage.usage.id);
      const row = await this.repo.insertAttempt({
        pinId: quiz.id, userId: input.studentId, attemptNumber, usageId: usage.usage.id,
        state: 'inprogress', preview: false, timeStart: now, makeup: false,
        appliedSettings: { source: 'paper-scan', scanId: input.scanId, batchId: input.batchId, variantCode: input.variantCode },
      });
      await this.outbox.enqueueStandalone({
        aggregate: 'quiz', type: 'quiz_attempt_started',
        payload: { pinId: quiz.id, courseId: quiz.course, attemptId: row.id, usageId: row.usageId, userId: input.studentId, attemptNumber, preview: false, actorId },
      });
      const usageView = await this.questions.getUsage(usage.usage.id);
      for (const s of input.layout) {
        const response = input.responses[s.slot - 1] ?? null;
        if (response === null) continue;
        const qa = usageView.attempts.find((a) => a.slot === s.slot);
        if (!qa) badRequest(`Usage is missing slot ${s.slot}`, 'paper.slot_missing');
        await this.questions.submitResponse(input.studentId, qa.id, response);
      }
      await this.attempts.finalizeAttempt(quiz, row, false);
      const updated = await this.shared.getAttemptRow(row.id);
      return { attemptId: updated.id, state: updated.state, sumGrades: updated.sumGrades };
    } catch (err) {
      await this.questions.deleteUsage(usage.usage.id).catch(() => undefined);
      throw err;
    }
  }

}
