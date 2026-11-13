import type { ExamQuestionSnapshot } from '@giaokhoa/db';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  cognitiveLevelSchema, extractRichTextPlainText, getTrueFalseStatements, toRichTextDocument, uuidIdSchema,
  type RichTextDocument, type RichTextInput,
} from '@giaokhoa/contracts';
import {
  assertSupportedQtype, badAnswerData, docOrNull, normaliseQuestionContent,
  type NormalisedContent, type QuestionContentInput, type StoredSolution,
  type SupportedQtype,
} from './application/question-content-normalizer';
export { SUPPORTED_QTYPES } from './application/question-content-normalizer';
export type {
  QuestionAnswerInput, QuestionOptionsInput, QuestionContentInput, SupportedQtype,
} from './application/question-content-normalizer';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContextsService } from '../access/contexts.service';
import { FilesService } from '../files/files.service';
import { BEHAVIOURS, canTransition, gradeAnswer, gradedStateForFraction, usageState, type GradingData, type GradeOutcome, type QuestionState } from './domain/question-engine';
import {
  QuestionsRepository, type AnswerKeyRow, type AnswerRow, type AttemptRow, type EntryRow, type EssayOptionsRow,
  type MultichoiceOptionsRow, type QCategoryRow, type QuestionRow, type QuestionsTx,
  type ShortanswerOptionsRow, type StepRow, type StimulusRow, type UsageRow, type VersionRow,
} from '@giaokhoa/db/repositories/questions';

export interface QuestionView {
  question: QuestionRow;
  entry: EntryRow;
  latestVersion: VersionRow;
  answers: AnswerRow[];
  answerKey: { guidance: unknown; solution: unknown };
  options: Record<string, unknown> | null;
  stimulus: StimulusRow | null;
}
export interface QuestionCurriculumLinksView {
  questionId: string;
  subjectIds: string[];
  outcomes: { outcomeId: string; cognitiveLevel: string }[];
}
export interface AttemptView extends AttemptRow {
  steps: { id: string; sequenceNumber: number; state: string; fraction: number | null; data: Record<string, string | null> }[];
}
export interface UsageView {
  usage: UsageRow;
  state: string;
  attempts: AttemptView[];
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  while (e !== null && typeof e === 'object') {
    if ((e as { code?: unknown }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class QuestionsService {
  constructor(
    private readonly repo: QuestionsRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly outbox: OutboxService,
    private readonly files: FilesService,
  ) {}

  private async requireCap(actorId: string, capability: string, contextId: string): Promise<void> {
    await this.evaluator.requireCapability(actorId, capability, contextId);
  }

  private async canUseBank(actorId: string, contextId: string): Promise<boolean> {
    const bank = await this.repo.getBankByContextId(contextId).catch(() => undefined);
    if (bank && bank.scope === 'personal' && bank.ownerId !== actorId) {
      const isAdmin = await this.evaluator.isSiteAdmin(actorId).catch(() => false);
      if (!isAdmin) return false;
    }
    return this.evaluator.hasCapability(actorId, 'question:useall', contextId).catch(() => false);
  }


  private async bankOfCategory(category: QCategoryRow): Promise<{ scope: string; ownerId: string | null } | undefined> {
    if (category.bankId) {
      const byId = await this.repo.getBankById(category.bankId).catch(() => undefined);
      if (byId) return byId;
    }
    return this.repo.getBankByContextId(category.contextId).catch(() => undefined);
  }

  private async assertCategoryNotForeignPersonal(
    actorId: string,
    category: QCategoryRow,
    notFound: () => NotFoundException,
  ): Promise<void> {
    const bank = await this.bankOfCategory(category);
    if (!bank || bank.scope !== 'personal' || bank.ownerId === actorId) return;
    const isAdmin = await this.evaluator.isSiteAdmin(actorId).catch(() => false);
    if (!isAdmin) throw notFound();
  }

  private categoryNotFound(id: string): NotFoundException {
    return new NotFoundException({ message: `Question category ${id} not found`, code: 'question.category_not_found' });
  }
  private questionNotFound(id: string): NotFoundException {
    return new NotFoundException({ message: `Question ${id} not found`, code: 'question.not_found' });
  }
  private stimulusNotFound(id: string): NotFoundException {
    return new NotFoundException({ message: `Stimulus ${id} not found`, code: 'stimulus.not_found' });
  }
  private usageNotFound(id: string): NotFoundException {
    return new NotFoundException({ message: `Question usage ${id} not found`, code: 'question.usage_not_found' });
  }

  private async assertQuestionReadable(actorId: string, questionId: string): Promise<QuestionRow> {
    const q = await this.repo.getQuestion(questionId);
    if (!q) throw this.questionNotFound(questionId);
    const category = await this.repo.getCategory(q.category);
    if (!category || !(await this.canUseBank(actorId, category.contextId))) throw this.questionNotFound(questionId);
    return q;
  }

  private async assertCategoryReadable(actorId: string, categoryId: string): Promise<QCategoryRow> {
    const category = await this.repo.getCategory(categoryId);
    if (!category) throw this.categoryNotFound(categoryId);
    if (!(await this.canUseBank(actorId, category.contextId))) throw this.categoryNotFound(categoryId);
    return category;
  }


  async createCategory(actorId: string, input: { name: string; contextId: string; info?: string; parent?: string; bankId?: string }): Promise<QCategoryRow> {
    const ctx = await this.contexts.getContext(input.contextId).catch(() => undefined);
    if (!ctx) {
      throw new BadRequestException({
        message: `Context ${input.contextId} does not exist; a question category must be created in an existing context`,
        code: 'question.category_context_not_found',
      });
    }
    let attachedBank: Awaited<ReturnType<QuestionsRepository['getBankById']>>;
    if (input.bankId !== undefined) {
      attachedBank = await this.repo.getBankById(input.bankId);
      if (!attachedBank) throw new NotFoundException({ message: `Question bank ${input.bankId} not found`, code: 'question.bank_not_found' });
    }
    for (const candidate of [attachedBank, await this.repo.getBankByContextId(ctx.id).catch(() => undefined)]) {
      if (candidate && candidate.scope === 'personal' && candidate.ownerId !== actorId
        && !(await this.evaluator.isSiteAdmin(actorId).catch(() => false))) {
        throw new NotFoundException({ message: `Question bank ${candidate.id} not found`, code: 'question.bank_not_found' });
      }
    }
    await this.requireCap(actorId, 'question:managecategory', ctx.id);
    if (attachedBank) {
      if (attachedBank.contextId !== ctx.id) {
        throw new BadRequestException({ message: 'A category attached to a bank must live in the bank context', code: 'question.category_bank_context_mismatch' });
      }
    }
    return this.repo.insertCategory({
      name: input.name, contextId: ctx.id, info: input.info ?? '', parent: input.parent ?? null,
      bankId: input.bankId ?? null,
      stamp: `qcat-${Date.now().toString(36)}`,
    });
  }
  async listCategories(contextId?: string): Promise<QCategoryRow[]> { return this.repo.listCategories(contextId); }
  async getCategory(id: string): Promise<QCategoryRow> {
    const row = await this.repo.getCategory(id);
    if (!row) throw new NotFoundException({ message: `Question category ${id} not found`, code: 'question.category_not_found' });
    return row;
  }

  async listCategoriesForViewer(actorId: string, contextId?: string): Promise<QCategoryRow[]> {
    if (contextId !== undefined) {
      if (!(await this.canUseBank(actorId, contextId))) throw this.categoryNotFound(contextId);
      return this.repo.listCategories(contextId);
    }
    const rows = await this.repo.listCategories();
    const allowedByContext = new Map<string, boolean>();
    const out: QCategoryRow[] = [];
    for (const row of rows) {
      let ok = allowedByContext.get(row.contextId);
      if (ok === undefined) {
        ok = await this.canUseBank(actorId, row.contextId);
        allowedByContext.set(row.contextId, ok);
      }
      if (ok) out.push(row);
    }
    return out;
  }

  async listQuestionsForViewer(actorId: string, categoryId: string): Promise<QuestionView[]> {
    await this.assertCategoryReadable(actorId, categoryId);
    return this.listQuestions(categoryId);
  }


  async createStimulus(actorId: string, input: { categoryId: string; content: RichTextInput }): Promise<StimulusRow> {
    const category = await this.getCategory(input.categoryId);
    await this.assertCategoryNotForeignPersonal(actorId, category, () => this.categoryNotFound(input.categoryId));
    await this.requireCap(actorId, 'question:add', category.contextId);
    const row = await this.repo.insertStimulus({
      categoryId: category.id, createdBy: actorId, content: toRichTextDocument(input.content) as never,
    });
    await this.outbox.enqueueStandalone({ aggregate: 'stimulus', type: 'stimulus_created', payload: { stimulusId: row.id, categoryId: category.id } });
    return row;
  }
  async getStimulus(id: string): Promise<StimulusRow> {
    const row = await this.repo.getStimulus(id);
    if (!row) throw new NotFoundException({ message: `Stimulus ${id} not found`, code: 'stimulus.not_found' });
    return row;
  }
  async listStimuli(categoryId: string): Promise<StimulusRow[]> { return this.repo.listStimuliInCategory(categoryId); }

  async listStimuliForViewer(actorId: string, categoryId: string): Promise<StimulusRow[]> {
    await this.assertCategoryReadable(actorId, categoryId);
    return this.repo.listStimuliInCategory(categoryId);
  }

  async getStimulusForViewer(actorId: string, id: string): Promise<StimulusRow> {
    const row = await this.repo.getStimulus(id);
    if (!row) throw this.stimulusNotFound(id);
    const category = await this.repo.getCategory(row.categoryId);
    if (!category || !(await this.canUseBank(actorId, category.contextId))) throw this.stimulusNotFound(id);
    return row;
  }

  private async requireStimulusMutable(stimulus: StimulusRow): Promise<void> {
    const refs = await this.repo.countVersionsReferencingStimulus(stimulus.id);
    if (refs > 0) {
      throw new BadRequestException({
        message: 'Stimulus is already referenced by a question version and can no longer be changed or deleted; create a new stimulus instead',
        code: 'stimulus_in_use',
      });
    }
  }
  async updateStimulus(actorId: string, id: string, input: { content: RichTextInput }): Promise<StimulusRow> {
    const stimulus = await this.getStimulus(id);
    const category = await this.getCategory(stimulus.categoryId);
    await this.assertCategoryNotForeignPersonal(actorId, category, () => this.stimulusNotFound(id));
    await this.requireCap(actorId, 'question:editall', category.contextId);
    await this.requireStimulusMutable(stimulus);
    await this.repo.updateStimulus(id, { content: toRichTextDocument(input.content) as never });
    await this.outbox.enqueueStandalone({ aggregate: 'stimulus', type: 'stimulus_updated', payload: { stimulusId: id } });
    return this.getStimulus(id);
  }
  async deleteStimulus(actorId: string, id: string): Promise<void> {
    const stimulus = await this.getStimulus(id);
    const category = await this.getCategory(stimulus.categoryId);
    await this.assertCategoryNotForeignPersonal(actorId, category, () => this.stimulusNotFound(id));
    await this.requireCap(actorId, 'question:editall', category.contextId);
    await this.requireStimulusMutable(stimulus);
    await this.repo.deleteStimulus(id);
    await this.outbox.enqueueStandalone({ aggregate: 'stimulus', type: 'stimulus_deleted', payload: { stimulusId: id } });
  }


  private async writeVersionContent(tx: QuestionsTx, _qtype: SupportedQtype, versionId: string, content: NormalisedContent): Promise<void> {
    const inserted: AnswerRow[] = [];
    for (const [index, a] of content.answers.entries()) {
      inserted.push(await this.repo.insertAnswer({
        questionVersionId: versionId, answer: a.answer as never, isCorrect: a.isCorrect,
        feedback: a.feedback as never, sortOrder: index,
      }, tx));
    }
    if (content.multichoice) {
      await this.repo.insertMultichoiceOptions({ questionVersionId: versionId, ...content.multichoice } as never, tx);
    }
    if (content.shortanswer) {
      await this.repo.insertShortanswerOptions({
        questionVersionId: versionId, useCase: content.shortanswer.useCase,
        numericAnswer: content.shortanswer.numericAnswer, numericMaxLength: content.shortanswer.numericMaxLength,
        numericAllowSign: content.shortanswer.numericAllowSign, numericAllowDecimal: content.shortanswer.numericAllowDecimal,
      }, tx);
    }
    if (content.essay) {
      await this.repo.insertEssayOptions({ questionVersionId: versionId, ...content.essay } as never, tx);
    }
    if (content.answerKey.guidance !== null || content.answerKey.solution !== null) {
      await this.repo.insertAnswerKey({
        questionVersionId: versionId,
        guidance: content.answerKey.guidance as never,
        solution: content.answerKey.solution as never,
      }, tx);
    }
  }

  private async cloneVersionContent(tx: QuestionsTx, qtype: SupportedQtype, fromVersionId: string, toVersionId: string, skipAnswerKey = false): Promise<void> {
    const answers = await this.repo.listAnswers(fromVersionId);
    const idMap = new Map<string, string>();
    for (const a of answers) {
      const row = await this.repo.insertAnswer({
        questionVersionId: toVersionId, answer: a.answer as never, isCorrect: a.isCorrect,
        feedback: a.feedback as never, sortOrder: a.sortOrder,
      }, tx);
      idMap.set(a.id, row.id);
    }
    if (qtype === 'multichoice') {
      const o = await this.repo.getMultichoiceOptions(fromVersionId);
      if (o) await this.repo.insertMultichoiceOptions({
        questionVersionId: toVersionId, shuffleAnswers: o.shuffleAnswers,
        answerNumbering: o.answerNumbering, correctFeedback: o.correctFeedback as never,
        incorrectFeedback: o.incorrectFeedback as never,
        showStandardInstruction: o.showStandardInstruction,
      }, tx);
    } else if (qtype === 'shortanswer') {
      const o = await this.repo.getShortanswerOptions(fromVersionId);
      if (o) await this.repo.insertShortanswerOptions({
        questionVersionId: toVersionId, useCase: o.useCase,
        numericAnswer: o.numericAnswer, numericMaxLength: o.numericMaxLength,
        numericAllowSign: o.numericAllowSign, numericAllowDecimal: o.numericAllowDecimal,
      }, tx);
    } else if (qtype === 'essay') {
      const o = await this.repo.getEssayOptions(fromVersionId);
      if (o) await this.repo.insertEssayOptions({
        questionVersionId: toVersionId, responseFormat: o.responseFormat, responseRequired: o.responseRequired,
        responseFieldLines: o.responseFieldLines, minWordLimit: o.minWordLimit, maxWordLimit: o.maxWordLimit,
        graderInfo: o.graderInfo as never, responseTemplate: o.responseTemplate as never,
      }, tx);
    }
    if (!skipAnswerKey) {
      const key = await this.repo.getAnswerKey(fromVersionId);
      if (key) {
        await this.repo.insertAnswerKey({
          questionVersionId: toVersionId, guidance: key.guidance as never, solution: key.solution as never,
        }, tx);
      }
    }
  }

  async cloneVersionContentTx(tx: QuestionsTx, qtype: SupportedQtype, fromVersionId: string, toVersionId: string): Promise<void> {
    await this.cloneVersionContent(tx, qtype, fromVersionId, toVersionId);
  }

  private async optionsView(qtype: string, versionId: string): Promise<Record<string, unknown> | null> {
    if (qtype === 'multichoice') return this.optionsFromRow(qtype, await this.repo.getMultichoiceOptions(versionId));
    if (qtype === 'shortanswer') return this.optionsFromRow(qtype, await this.repo.getShortanswerOptions(versionId));
    if (qtype === 'essay') return this.optionsFromRow(qtype, await this.repo.getEssayOptions(versionId));
    return null;
  }

  private optionsFromRow(
    qtype: string,
    row: MultichoiceOptionsRow | ShortanswerOptionsRow | EssayOptionsRow | undefined,
  ): Record<string, unknown> | null {
    if (!row) return null;
    if (qtype === 'multichoice') {
      const o = row as MultichoiceOptionsRow;
      return {
        shuffleAnswers: o.shuffleAnswers, answerNumbering: o.answerNumbering,
        correctFeedback: o.correctFeedback, incorrectFeedback: o.incorrectFeedback,
        showStandardInstruction: o.showStandardInstruction,
      };
    }
    if (qtype === 'shortanswer') {
      const o = row as ShortanswerOptionsRow;
      return {
        useCase: o.useCase,
        numericAnswer: o.numericAnswer, numericMaxLength: o.numericMaxLength,
        numericAllowSign: o.numericAllowSign, numericAllowDecimal: o.numericAllowDecimal,
      };
    }
    if (qtype === 'essay') {
      const o = row as EssayOptionsRow;
      return {
        responseFormat: o.responseFormat, responseRequired: o.responseRequired,
        responseFieldLines: o.responseFieldLines, minWordLimit: o.minWordLimit,
        maxWordLimit: o.maxWordLimit, graderInfo: o.graderInfo, responseTemplate: o.responseTemplate,
      };
    }
    return null;
  }

  async answerKeyOf(versionId: string): Promise<{ guidance: unknown; solution: unknown }> {
    const key: AnswerKeyRow | undefined = await this.repo.getAnswerKey(versionId);
    return { guidance: key?.guidance ?? null, solution: key?.solution ?? null };
  }

  private async assembleView(question: QuestionRow, entry: EntryRow, version: VersionRow): Promise<QuestionView> {
    const answers = await this.repo.listAnswers(version.id);
    const answerKey = await this.answerKeyOf(version.id);
    const options = await this.optionsView(question.qtype, version.id);
    const stimulus = version.stimulusId ? (await this.repo.getStimulus(version.stimulusId)) ?? null : null;
    return { question, entry, latestVersion: version, answers, answerKey, options, stimulus };
  }

  private async loadQuestionViews(rows: QuestionRow[]): Promise<QuestionView[]> {
    if (!rows.length) return [];
    const entries = await this.repo.getEntriesByQuestions(rows.map((q) => q.id));
    const entryByQuestion = new Map(entries.map((e) => [e.questionId, e]));
    const versions = await this.repo.getLatestVersionsByEntries(entries);
    const versionByEntry = new Map(versions.map((v) => [v.questionBankEntryId, v]));
    for (const q of rows) {
      const entry = entryByQuestion.get(q.id);
      if (!entry) throw new NotFoundException({ message: `Question ${q.id} has no bank entry`, code: 'question.entry_missing' });
      if (!versionByEntry.has(entry.id)) throw new NotFoundException({ message: `Question ${q.id} latest version missing`, code: 'question.version_missing' });
    }
    const versionIds = versions.map((v) => v.id);
    const answers = await this.repo.listAnswersByVersions(versionIds);
    const answersByVersion = new Map<string, AnswerRow[]>();
    for (const a of answers) {
      const list = answersByVersion.get(a.questionVersionId);
      if (list) list.push(a); else answersByVersion.set(a.questionVersionId, [a]);
    }
    const keys = await this.repo.listAnswerKeysByVersions(versionIds);
    const keyByVersion = new Map(keys.map((k) => [k.questionVersionId, k]));
    const qtypeByVersion = new Map<string, string>();
    for (const q of rows) {
      const entry = entryByQuestion.get(q.id)!;
      const version = versionByEntry.get(entry.id)!;
      qtypeByVersion.set(version.id, q.qtype);
    }
    const idsFor = (qtype: string): string[] => versionIds.filter((id) => qtypeByVersion.get(id) === qtype);
    const mcOptions = await this.repo.listMultichoiceOptionsByVersions(idsFor('multichoice'));
    const mcByVersion = new Map(mcOptions.map((o) => [o.questionVersionId, o]));
    const saOptions = await this.repo.listShortanswerOptionsByVersions(idsFor('shortanswer'));
    const saByVersion = new Map(saOptions.map((o) => [o.questionVersionId, o]));
    const essayOptions = await this.repo.listEssayOptionsByVersions(idsFor('essay'));
    const essayByVersion = new Map(essayOptions.map((o) => [o.questionVersionId, o]));
    const stimulusIds = [...new Set(versions.map((v) => v.stimulusId).filter((id): id is string => id !== null))];
    const stimuli = await this.repo.listStimuliByIds(stimulusIds);
    const stimulusById = new Map(stimuli.map((s) => [s.id, s]));
    return rows.map((q) => {
      const entry = entryByQuestion.get(q.id)!;
      const version = versionByEntry.get(entry.id)!;
      const key = keyByVersion.get(version.id);
      const optionsRow = q.qtype === 'multichoice' ? mcByVersion.get(version.id)
        : q.qtype === 'shortanswer' ? saByVersion.get(version.id)
        : q.qtype === 'essay' ? essayByVersion.get(version.id)
        : undefined;
      return {
        question: q, entry, latestVersion: version,
        answers: answersByVersion.get(version.id) ?? [],
        answerKey: { guidance: key?.guidance ?? null, solution: key?.solution ?? null },
        options: this.optionsFromRow(q.qtype, optionsRow),
        stimulus: version.stimulusId ? stimulusById.get(version.stimulusId) ?? null : null,
      };
    });
  }

  private async resolveStimulus(stimulusId: string, categoryId: string): Promise<StimulusRow> {
    const stimulus = await this.getStimulus(stimulusId);
    if (stimulus.categoryId !== categoryId) {
      throw new BadRequestException({
        message: 'Stimulus belongs to a different question category; a stimulus is shared only within its own category',
        code: 'question.stimulus_category_mismatch',
      });
    }
    return stimulus;
  }

  private async insertQuestionGraph(
    tx: QuestionsTx,
    actorId: string,
    category: QCategoryRow,
    input: { qtype: string; sourceKind?: string; sourceRef?: string } & QuestionContentInput,
    content: NormalisedContent,
    stimulusId: string | null,
  ): Promise<{ q: QuestionRow; entry: EntryRow; version: VersionRow }> {
    const q = await this.repo.insertQuestion({
      category: category.id, qtype: input.qtype, createdBy: actorId, modifiedBy: actorId,
      sourceKind: input.sourceKind ?? 'manual', sourceRef: input.sourceRef ?? null,
    }, tx);
    const entry = await this.repo.insertEntry({ questionCategoryId: category.id, questionId: q.id, latestVersion: 1 }, tx);
    const version = await this.repo.insertVersion({
      questionBankEntryId: entry.id, questionId: q.id, version: 1,
      questionText: toRichTextDocument(input.questionText ?? '') as never,
      generalFeedback: docOrNull(input.generalFeedback) as never,
      defaultMark: input.defaultMark ?? 1, penalty: input.penalty ?? 0,
      stimulusId,
    }, tx);
    await this.writeVersionContent(tx, input.qtype as SupportedQtype, version.id, content);
    return { q, entry, version };
  }

  async createQuestion(actorId: string, input: {
    categoryId: string; qtype: string;
    sourceKind?: string; sourceRef?: string;
  } & QuestionContentInput): Promise<QuestionView> {
    const category = await this.getCategory(input.categoryId);
    await this.assertCategoryNotForeignPersonal(actorId, category, () => this.categoryNotFound(input.categoryId));
    await this.requireCap(actorId, 'question:add', category.contextId);
    assertSupportedQtype(input.qtype);
    const content = normaliseQuestionContent(input.qtype, input);
    const stimulus = input.stimulusId ? await this.resolveStimulus(input.stimulusId, category.id) : null;
    let created!: { q: QuestionRow; entry: EntryRow; version: VersionRow };
    await this.repo.transaction(async (tx) => {
      created = await this.insertQuestionGraph(tx, actorId, category, input, content, stimulus?.id ?? null);
    });
    await this.outbox.enqueueStandalone({ aggregate: 'question', type: 'question_created', payload: { questionId: created.q.id, version: 1 } });
    return this.assembleView(created.q, created.entry, created.version);
  }

  async createStimulusWithQuestions(
    actorId: string,
    input: {
      categoryId: string;
      content: RichTextInput;
      questions: ({
        qtype: string;
        sourceKind?: string; sourceRef?: string;
      } & QuestionContentInput)[];
    },
  ): Promise<{ stimulus: StimulusRow; questions: QuestionView[] }> {
    const category = await this.getCategory(input.categoryId);
    await this.assertCategoryNotForeignPersonal(actorId, category, () => this.categoryNotFound(input.categoryId));
    await this.requireCap(actorId, 'question:add', category.contextId);
    const prepared = input.questions.map((question) => {
      assertSupportedQtype(question.qtype);
      return { question, content: normaliseQuestionContent(question.qtype, question) };
    });
    let stimulus!: StimulusRow;
    const created: { q: QuestionRow; entry: EntryRow; version: VersionRow }[] = [];
    await this.repo.transaction(async (tx) => {
      stimulus = await this.repo.insertStimulus({
        categoryId: category.id, createdBy: actorId, content: toRichTextDocument(input.content) as never,
      }, tx);
      for (const { question, content } of prepared) {
        created.push(await this.insertQuestionGraph(tx, actorId, category, question, content, stimulus.id));
      }
    });
    await this.outbox.enqueueStandalone({ aggregate: 'stimulus', type: 'stimulus_created', payload: { stimulusId: stimulus.id, categoryId: category.id } });
    for (const item of created) {
      await this.outbox.enqueueStandalone({ aggregate: 'question', type: 'question_created', payload: { questionId: item.q.id, version: 1 } });
    }
    const questions = await Promise.all(created.map((item) => this.assembleView(item.q, item.entry, item.version)));
    return { stimulus, questions };
  }

  async getQuestion(id: string): Promise<QuestionView> {
    const q = await this.repo.getQuestion(id);
    if (!q) throw new NotFoundException({ message: `Question ${id} not found`, code: 'question.not_found' });
    const entry = await this.repo.getEntryByQuestion(id);
    if (!entry) throw new NotFoundException({ message: `Question ${id} has no bank entry`, code: 'question.entry_missing' });
    const latest = await this.repo.getVersionByNumber(entry.id, entry.latestVersion);
    if (!latest) throw new NotFoundException({ message: `Question ${id} latest version missing`, code: 'question.version_missing' });
    return this.assembleView(q, entry, latest);
  }
  async listQuestions(categoryId: string): Promise<QuestionView[]> {
    const rows = await this.repo.listQuestionsInCategory(categoryId);
    return this.loadQuestionViews(rows);
  }
  async listVersions(questionId: string): Promise<VersionRow[]> {
    const entry = await this.repo.getEntryByQuestion(questionId);
    if (!entry) throw new NotFoundException({ message: `Question ${questionId} has no bank entry`, code: 'question.entry_missing' });
    return this.repo.listVersions(entry.id);
  }

  async getQuestionForViewer(actorId: string, id: string): Promise<QuestionView> {
    await this.assertQuestionReadable(actorId, id);
    const view = await this.getQuestion(id);
    return this.resolveQuestionImages(view);
  }

  private async resolveQuestionImages(view: QuestionView): Promise<QuestionView> {
    const [questionText, generalFeedback, stimulusContent] = await Promise.all([
      this.files.resolveQuestionImageUrls(view.latestVersion.questionText),
      this.files.resolveQuestionImageUrls(view.latestVersion.generalFeedback),
      view.stimulus ? this.files.resolveQuestionImageUrls(view.stimulus.content) : Promise.resolve(null),
    ]);
    const answers = await Promise.all(view.answers.map(async (a) => ({
      ...a,
      answer: await this.files.resolveQuestionImageUrls(a.answer),
      feedback: await this.files.resolveQuestionImageUrls(a.feedback),
    })));
    const guidance = await this.files.resolveQuestionImageUrls(view.answerKey.guidance as never);
    let solution: unknown = view.answerKey.solution;
    const solutionAnswer = (solution as { answer?: unknown } | null)?.answer;
    if (solutionAnswer !== undefined) {
      solution = { ...(solution as Record<string, unknown>), answer: await this.files.resolveQuestionImageUrls(solutionAnswer as never) };
    }
    return {
      ...view,
      latestVersion: { ...view.latestVersion, questionText, generalFeedback },
      answers,
      answerKey: { guidance, solution },
      stimulus: view.stimulus && stimulusContent ? { ...view.stimulus, content: stimulusContent } : view.stimulus,
    };
  }

  async listVersionsForViewer(actorId: string, questionId: string): Promise<VersionRow[]> {
    await this.assertQuestionReadable(actorId, questionId);
    return this.listVersions(questionId);
  }
  async getAttemptContent(attempt: AttemptRow) {
    const snapshot = await this.repo.getAttemptSnapshot(attempt.id);
    if (snapshot) {
      const pkg = snapshot.package;
      return { qtype: snapshot.qtype, questionText: pkg.questionText, generalFeedback: pkg.generalFeedback,
        answers: pkg.answers.map((a, i) => ({ ...a, id: snapshot.answerIds[i]! })),
        answerKey: pkg.answerKey ?? { guidance: null, solution: null }, options: pkg.options,
        stimulus: pkg.stimulusContent ? { id: snapshot.versionId, content: pkg.stimulusContent } : null };
    }
    const view = await this.getQuestion(attempt.questionId);
    const content = attempt.questionVersionId ? await this.getVersionContent(attempt.questionId, attempt.questionVersionId) : null;
    const version = content?.version ?? view.latestVersion;
    const stimulus = version.stimulusId ? await this.getStimulus(version.stimulusId) : null;
    return { qtype: view.question.qtype, questionText: version.questionText, generalFeedback: version.generalFeedback,
      answers: content?.answers ?? view.answers, answerKey: content?.answerKey ?? view.answerKey,
      options: content?.options ?? view.options, stimulus };
  }

  async getVersionContent(questionId: string, versionId: string): Promise<{ version: VersionRow; answers: AnswerRow[]; answerKey: { guidance: unknown; solution: unknown }; options: Record<string, unknown> | null }> {
    const q = await this.repo.getQuestion(questionId);
    if (!q) throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    const version = await this.repo.getVersion(versionId);
    if (!version || version.questionId !== questionId) {
      throw new NotFoundException({ message: `Question version ${versionId} not found`, code: 'question.version_missing' });
    }
    const answers = await this.repo.listAnswers(version.id);
    const answerKey = await this.answerKeyOf(version.id);
    const options = await this.optionsView(q.qtype, version.id);
    return { version, answers, answerKey, options };
  }

  async updateQuestion(actorId: string, questionId: string, input: QuestionContentInput): Promise<QuestionView> {
    const { question: q, entry, latestVersion } = await this.getQuestion(questionId);
    const category = await this.getCategory(q.category);
    await this.assertCategoryNotForeignPersonal(actorId, category, () => this.questionNotFound(questionId));
    await this.requireCap(actorId, 'question:editall', category.contextId);
    assertSupportedQtype(q.qtype);
    const hasNewContent = input.answers !== undefined || input.options !== undefined
      || (q.qtype === 'truefalse' && (input.questionText !== undefined || input.solution !== undefined));
    const content = hasNewContent ? normaliseQuestionContent(q.qtype, input, latestVersion.questionText as RichTextDocument) : null;
    const touchesAnswerKey = input.guidance !== undefined || input.solution !== undefined;
    const prevKey = (content || touchesAnswerKey) ? await this.answerKeyOf(latestVersion.id) : null;
    if (content) {
      if (input.guidance === undefined) content.answerKey.guidance = prevKey!.guidance as RichTextDocument | null;
      if (input.solution === undefined) {
        if (q.qtype === 'truefalse' && input.questionText !== undefined) {
          const newStatements = getTrueFalseStatements(toRichTextDocument(input.questionText));
          const prevAnswers = (prevKey!.solution as { answers?: { statementId: string }[] } | null)?.answers;
          if (prevAnswers && newStatements) {
            const prevIds = new Set(prevAnswers.map((a) => a.statementId));
            const newIds = new Set(newStatements.map((s) => s.id));
            if (prevIds.size !== newIds.size || [...prevIds].some((id) => !newIds.has(id))) {
              throw badAnswerData('truefalse solution inheritance requires the new question text to carry exactly the statements covered by the previous solution; send solution.answers covering the new statements');
            }
          }
        }
        content.answerKey.solution = prevKey!.solution as StoredSolution | null;
      }
    }
    let stimulusId = latestVersion.stimulusId;
    if (input.stimulusId !== undefined) {
      stimulusId = input.stimulusId === null ? null : (await this.resolveStimulus(input.stimulusId, category.id)).id;
    }
    const nextVersion = entry.latestVersion + 1;
    let version!: VersionRow;
    await this.repo.transaction(async (tx) => {
      version = await this.repo.insertVersion({
        questionBankEntryId: entry.id, questionId: q.id, version: nextVersion,
        questionText: (input.questionText !== undefined ? toRichTextDocument(input.questionText) : latestVersion.questionText) as never,
        generalFeedback: (input.generalFeedback !== undefined ? toRichTextDocument(input.generalFeedback) : latestVersion.generalFeedback) as never,
        defaultMark: input.defaultMark ?? latestVersion.defaultMark,
        penalty: input.penalty ?? latestVersion.penalty,
        stimulusId: stimulusId,
      }, tx);
      if (content) {
        await this.writeVersionContent(tx, q.qtype as SupportedQtype, version.id, content);
      } else if (touchesAnswerKey) {
        await this.cloneVersionContent(tx, q.qtype as SupportedQtype, latestVersion.id, version.id, true);
        const guidance = input.guidance !== undefined ? docOrNull(input.guidance) : (prevKey!.guidance as RichTextDocument | null);
        const solution: StoredSolution | null = input.solution !== undefined
          ? (q.qtype === 'essay' && 'answer' in input.solution
            ? { answer: toRichTextDocument(input.solution.answer) }
            : q.qtype === 'truefalse' && 'answers' in input.solution
              ? { answers: input.solution.answers.map((a) => ({ statementId: a.statementId, value: a.value === true })) }
              : null)
          : (prevKey!.solution as StoredSolution | null);
        if (guidance !== null || solution !== null) {
          await this.repo.insertAnswerKey({ questionVersionId: version.id, guidance: guidance as never, solution: solution as never }, tx);
        }
      } else {
        await this.cloneVersionContent(tx, q.qtype as SupportedQtype, latestVersion.id, version.id);
      }
      await this.repo.markSystemImportDerived(q.id, tx);
    });
    await this.repo.updateEntry(entry.id, { latestVersion: nextVersion });
    await this.repo.updateQuestion(q.id, { modifiedBy: actorId });
    await this.outbox.enqueueStandalone({ aggregate: 'question', type: 'question_updated', payload: { questionId: q.id, version: nextVersion } });
    return this.getQuestion(q.id);
  }


  private async questionForEdit(actorId: string, questionId: string): Promise<QuestionRow> {
    const q = await this.repo.getQuestion(questionId);
    if (!q) throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    const category = await this.getCategory(q.category);
    await this.assertCategoryNotForeignPersonal(actorId, category, () => this.questionNotFound(questionId));
    await this.requireCap(actorId, 'question:editall', category.contextId);
    return q;
  }

  async getCurriculumLinksForViewer(actorId: string, questionId: string): Promise<QuestionCurriculumLinksView> {
    await this.assertQuestionReadable(actorId, questionId);
    return this.getCurriculumLinks(questionId);
  }

  async getCurriculumLinks(questionId: string): Promise<QuestionCurriculumLinksView> {
    const q = await this.repo.getQuestion(questionId);
    if (!q) throw new NotFoundException({ message: `Question ${questionId} not found`, code: 'question.not_found' });
    const subjectLinks = await this.repo.listQuestionSubjectLinks(questionId);
    const outcomeLinks = await this.repo.listQuestionOutcomeLinks(questionId);
    return {
      questionId,
      subjectIds: subjectLinks.map((l) => l.subjectId),
      outcomes: outcomeLinks.map((l) => ({ outcomeId: l.learningOutcomeId, cognitiveLevel: l.cognitiveLevel })),
    };
  }

  async attachSubject(actorId: string, questionId: string, subjectId: string): Promise<QuestionCurriculumLinksView> {
    await this.questionForEdit(actorId, questionId);
    const subject = await this.repo.getSubjectRow(subjectId);
    if (!subject) throw new NotFoundException({ message: `Subject ${subjectId} not found`, code: 'curriculum.subject_not_found' });
    if (await this.repo.getQuestionSubjectLink(questionId, subjectId)) {
      throw new ConflictException({ message: 'Question is already linked to this subject', code: 'question.subject_link_exists' });
    }
    try {
      await this.repo.insertQuestionSubjectLink({ questionId, subjectId });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ message: 'Question is already linked to this subject', code: 'question.subject_link_exists' });
      }
      throw err;
    }
    return this.getCurriculumLinks(questionId);
  }

  async detachSubject(actorId: string, questionId: string, subjectId: string): Promise<QuestionCurriculumLinksView> {
    await this.questionForEdit(actorId, questionId);
    if (!(await this.repo.deleteQuestionSubjectLink(questionId, subjectId))) {
      throw new NotFoundException({ message: 'Question is not linked to this subject', code: 'question.subject_link_not_found' });
    }
    return this.getCurriculumLinks(questionId);
  }

  async attachOutcome(actorId: string, questionId: string, outcomeId: string, cognitiveLevel: string): Promise<QuestionCurriculumLinksView> {
    await this.questionForEdit(actorId, questionId);
    const chain = await this.repo.getOutcomeChain(outcomeId);
    if (!chain) throw new NotFoundException({ message: `Learning outcome ${outcomeId} not found`, code: 'curriculum.outcome_not_found' });
    if (await this.repo.getQuestionOutcomeLink(questionId, outcomeId)) {
      throw new ConflictException({ message: 'Question is already linked to this learning outcome', code: 'question.outcome_link_exists' });
    }
    try {
      await this.repo.insertQuestionOutcomeLink({ questionId, learningOutcomeId: outcomeId, cognitiveLevel });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ message: 'Question is already linked to this learning outcome', code: 'question.outcome_link_exists' });
      }
      throw err;
    }
    return this.getCurriculumLinks(questionId);
  }

  async updateOutcomeLink(actorId: string, questionId: string, outcomeId: string, cognitiveLevel: string): Promise<QuestionCurriculumLinksView> {
    await this.questionForEdit(actorId, questionId);
    if (!(await this.repo.getQuestionOutcomeLink(questionId, outcomeId))) {
      throw new NotFoundException({ message: 'Question is not linked to this learning outcome', code: 'question.outcome_link_not_found' });
    }
    await this.repo.updateQuestionOutcomeLink(questionId, outcomeId, cognitiveLevel);
    return this.getCurriculumLinks(questionId);
  }

  async detachOutcome(actorId: string, questionId: string, outcomeId: string): Promise<QuestionCurriculumLinksView> {
    await this.questionForEdit(actorId, questionId);
    if (!(await this.repo.deleteQuestionOutcomeLink(questionId, outcomeId))) {
      throw new NotFoundException({ message: 'Question is not linked to this learning outcome', code: 'question.outcome_link_not_found' });
    }
    return this.getCurriculumLinks(questionId);
  }

  private validateCurriculumFilter(filter: {
    subjectId?: string; outcomeId?: string; nodeId?: string; cognitiveLevel?: string; qtype?: string; status?: string;
  }): void {
    for (const [field, value] of [['subjectId', filter.subjectId], ['outcomeId', filter.outcomeId], ['nodeId', filter.nodeId]] as const) {
      if (value !== undefined && !uuidIdSchema.safeParse(value).success) {
        throw new BadRequestException({ message: `${field} must be a uuid`, code: 'question.invalid_filter' });
      }
    }
    if (filter.cognitiveLevel !== undefined && !cognitiveLevelSchema.safeParse(filter.cognitiveLevel).success) {
      throw new BadRequestException({ message: `cognitiveLevel ${filter.cognitiveLevel} is not a known cognitive level`, code: 'question.invalid_cognitive_level' });
    }
  }

  async listQuestionsByCurriculumFilter(filter: {
    subjectId?: string; outcomeId?: string; nodeId?: string; cognitiveLevel?: string; qtype?: string; status?: string;
  }): Promise<QuestionView[]> {
    this.validateCurriculumFilter(filter);
    const rows = await this.repo.filterQuestionsByCurriculumLinks(filter);
    return this.loadQuestionViews(rows);
  }

  async countQuestionsByCurriculumFilterByCategory(filter: {
    subjectId?: string; outcomeId?: string; nodeId?: string; cognitiveLevel?: string; qtype?: string; status?: string;
  }): Promise<{ categoryId: string; count: number }[]> {
    this.validateCurriculumFilter(filter);
    return this.repo.countQuestionsByCurriculumFilterPerCategory(filter);
  }

  async listQuestionsByCurriculumFilterForViewer(actorId: string, filter: {
    subjectId?: string; outcomeId?: string; nodeId?: string; cognitiveLevel?: string; qtype?: string; status?: string;
  }): Promise<QuestionView[]> {
    this.validateCurriculumFilter(filter);
    const rows = await this.repo.filterQuestionsByCurriculumLinks(filter);
    const readableByCategory = new Map<string, boolean>();
    const included: QuestionRow[] = [];
    for (const q of rows) {
      let ok = readableByCategory.get(q.category);
      if (ok === undefined) {
        const category = await this.repo.getCategory(q.category);
        ok = category !== undefined && (await this.canUseBank(actorId, category.contextId));
        readableByCategory.set(q.category, ok);
      }
      if (ok) included.push(q);
    }
    return this.loadQuestionViews(included);
  }


  async createUsage(actorId: string, input: {
    component: string; instanceId?: string; contextId?: string; preferredBehaviour?: string;
    slots: { questionId: string; maxMark?: number; pinnedVersionId?: string; snapshot?: ExamQuestionSnapshot }[];
  }): Promise<UsageView> {
    const behaviour = input.preferredBehaviour ?? 'deferredfeedback';
    if (!BEHAVIOURS[behaviour]) {
      throw new BadRequestException({ message: `Unknown question behaviour ${behaviour}`, code: 'question.unknown_behaviour' });
    }
    if (!input.slots.length) throw new BadRequestException({ message: 'A usage needs at least one question slot', code: 'question.usage_empty' });
    const usage = await this.repo.insertUsage({
      component: input.component, instanceId: input.instanceId ?? null,
      owningContextId: input.contextId ?? null, preferredBehaviour: behaviour, userId: actorId,
    });
    let slot = 1;
    for (const s of input.slots) {
      if (s.snapshot) {
        await this.repo.insertAttempt({ questionUsageId: usage.id, slot: slot++, behaviour,
          questionId: s.snapshot.questionId, questionVersionId: s.snapshot.versionId,
          contentSnapshot: s.snapshot, maxMark: s.maxMark ?? s.snapshot.defaultMark,
          questionSummary: extractRichTextPlainText(s.snapshot.package.questionText as RichTextDocument),
          userId: actorId, state: 'notstarted' });
        continue;
      }
      const view = await this.getQuestion(s.questionId);
      void view;
      const usageEntry = await this.repo.getEntryByQuestion(s.questionId);
      if (usageEntry?.status === 'draft') {
        throw new BadRequestException({ message: 'Draft questions cannot be used in a quiz until they are reviewed and published', code: 'question.usage_draft_question' });
      }
      if (s.pinnedVersionId) {
        const pinned = await this.repo.getVersion(s.pinnedVersionId);
        if (!pinned || pinned.questionId !== s.questionId) {
          throw new BadRequestException({ message: `Pinned version ${s.pinnedVersionId} does not belong to question ${s.questionId}`, code: 'question.pinned_version_mismatch' });
        }
      }
      await this.repo.insertAttempt({
        questionUsageId: usage.id, slot: slot++, behaviour,
        questionId: s.questionId, questionVersionId: s.pinnedVersionId ?? null,
        maxMark: s.maxMark ?? view.latestVersion.defaultMark,
        questionSummary: extractRichTextPlainText(view.latestVersion.questionText as RichTextDocument), userId: actorId,
        state: 'notstarted',
      });
    }
    await this.outbox.enqueueStandalone({ aggregate: 'question', type: 'question_usage_created', payload: { usageId: usage.id, component: input.component, instanceId: input.instanceId ?? 0, userId: actorId, actorId } });
    return this.getUsage(usage.id);
  }

  async listQuestionIdsInCategory(categoryId: string): Promise<string[]> {
    const rows = await this.repo.listQuestionsInCategory(categoryId);
    return rows.map((r) => r.id);
  }
  async listUsableQuestionIdsInCategory(categoryId: string): Promise<string[]> {
    const rows = await this.repo.listQuestionsInCategory(categoryId);
    const out: string[] = [];
    for (const r of rows) {
      const entry = await this.repo.getEntryByQuestion(r.id);
      if (entry && entry.status === 'ready') out.push(r.id);
    }
    return out;
  }
  async deleteUsage(usageId: string): Promise<void> {
    await this.repo.deleteUsage(usageId);
  }

  async assertCanCreateUsage(actorId: string, questionIds: string[]): Promise<void> {
    const allowedByContext = new Map<string, boolean>();
    for (const questionId of questionIds) {
      const q = await this.repo.getQuestion(questionId);
      if (!q) throw this.questionNotFound(questionId);
      const category = await this.repo.getCategory(q.category);
      if (!category) throw this.questionNotFound(questionId);
      let ok = allowedByContext.get(category.contextId);
      if (ok === undefined) {
        ok = await this.canUseBank(actorId, category.contextId);
        allowedByContext.set(category.contextId, ok);
      }
      if (!ok) throw this.questionNotFound(questionId);
    }
  }

  async getUsageForViewer(actorId: string, id: string): Promise<UsageView> {
    const usage = await this.repo.getUsage(id);
    if (!usage) throw this.usageNotFound(id);
    if (usage.userId !== actorId) {
      const system = await this.contexts.ensureSystemContext();
      if (!(await this.canUseBank(actorId, system.id))) throw this.usageNotFound(id);
    }
    if (await this.repo.usageHasSnapshots(id)) throw this.usageNotFound(id);
    return this.getUsage(id);
  }

  async getUsage(id: string): Promise<UsageView> {
    const usages = await this.getUsages([id]);
    const view = usages.get(id);
    if (!view) throw new NotFoundException({ message: `Question usage ${id} not found`, code: 'question.usage_not_found' });
    return view;
  }

  async getUsages(ids: string[]): Promise<Map<string, UsageView>> {
    const uniqueIds = [...new Set(ids)];
    const views = new Map<string, UsageView>();
    if (!uniqueIds.length) return views;
    const usages = await this.repo.getUsagesByIds(uniqueIds);
    const attempts = await this.repo.listAttemptsForUsages(uniqueIds);
    const steps = await this.repo.listStepsForAttempts(attempts.map((a) => a.id));
    const dataRows = await this.repo.listStepDataForSteps(steps.map((s) => s.id));
    const attemptsByUsage = new Map<string, AttemptRow[]>();
    for (const a of attempts) {
      const list = attemptsByUsage.get(a.questionUsageId) ?? [];
      list.push(a);
      attemptsByUsage.set(a.questionUsageId, list);
    }
    const stepsByAttempt = new Map<string, StepRow[]>();
    for (const s of steps) {
      const list = stepsByAttempt.get(s.questionAttemptId) ?? [];
      list.push(s);
      stepsByAttempt.set(s.questionAttemptId, list);
    }
    const dataByStep = new Map<string, Map<string, string | null>>();
    for (const d of dataRows) {
      const byName = dataByStep.get(d.attemptStepId) ?? new Map<string, string | null>();
      byName.set(d.name, d.value);
      dataByStep.set(d.attemptStepId, byName);
    }
    for (const usage of usages) {
      views.set(usage.id, this.buildUsageView(usage, attemptsByUsage.get(usage.id) ?? [], stepsByAttempt, dataByStep));
    }
    return views;
  }

  private buildUsageView(
    usage: UsageRow,
    attempts: AttemptRow[],
    stepsByAttempt: Map<string, StepRow[]>,
    dataByStep: Map<string, Map<string, string | null>>,
  ): UsageView {
    const views: AttemptView[] = attempts.map((a) => ({
      ...a,
      steps: (stepsByAttempt.get(a.id) ?? []).map((s) => ({
        id: s.id, sequenceNumber: s.sequenceNumber, state: s.state, fraction: s.fraction,
        data: Object.fromEntries(dataByStep.get(s.id) ?? []),
      })),
    }));
    return { usage, state: usageState(attempts.map((a) => a.state)), attempts: views };
  }

  async usageTotalMaxes(usageIds: string[]): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    const uniqueIds = [...new Set(usageIds)];
    if (!uniqueIds.length) return totals;
    const attempts = await this.repo.listAttemptsForUsages(uniqueIds);
    for (const a of attempts) {
      totals.set(a.questionUsageId, (totals.get(a.questionUsageId) ?? 0) + a.maxMark);
    }
    return totals;
  }
  async getAttempt(id: string): Promise<AttemptRow> {
    const row = await this.repo.getAttempt(id);
    if (!row) throw new NotFoundException({ message: `Question attempt ${id} not found`, code: 'question.attempt_not_found' });
    return row;
  }

  private async appendStep(attempt: AttemptRow, userId: string, state: QuestionState, fraction: number | null, data?: Record<string, string>): Promise<void> {
    const steps = await this.repo.listSteps(attempt.id);
    const seq = steps.length;
    await this.repo.transaction(async (tx) => {
      const step = await this.repo.insertStep({
        questionAttemptId: attempt.id, sequenceNumber: seq, state, fraction, userId: userId,
      }, tx);
      if (data) {
        for (const [name, value] of Object.entries(data)) {
          await this.repo.insertStepData({ attemptStepId: step.id, name, value }, tx);
        }
      }
    });
  }
  private async transition(attempt: AttemptRow, to: QuestionState): Promise<void> {
    if (!canTransition(attempt.state, to)) {
      throw new BadRequestException({ message: `Cannot move a question attempt from ${attempt.state} to ${to}`, code: 'question.bad_transition' });
    }
  }
  private async latestResponse(attemptId: string): Promise<string | null> {
    const steps = await this.repo.listSteps(attemptId);
    let response: string | null = null;
    for (const s of steps) {
      const data = await this.repo.listStepData(s.id);
      const answer = data.find((d) => d.name === 'answer');
      if (answer) response = answer.value;
    }
    return response;
  }

  private async gradingDataFor(version: VersionRow, qtype: string, tfScale?: readonly number[] | null): Promise<GradingData> {
    const answers = await this.repo.listAnswers(version.id);
    const data: GradingData = {
      answers: answers.map((a) => ({
        id: a.id,
        text: extractRichTextPlainText(a.answer as RichTextDocument),
        isCorrect: a.isCorrect,
      })),
    };
    if (qtype === 'truefalse') {
      const key = await this.repo.getAnswerKey(version.id);
      const solution = key?.solution as { answers?: { statementId: string; value: boolean }[] } | null | undefined;
      data.truefalseStatements = (solution?.answers ?? []).map((a) => ({
        statementId: a.statementId,
        value: a.value === true,
      }));
      if (tfScale) data.tfScale = tfScale;
    } else if (qtype === 'shortanswer') {
      const o = await this.repo.getShortanswerOptions(version.id);
      data.shortanswer = {
        useCase: o?.useCase ?? false,
        numericAnswer: o?.numericAnswer ?? false,
        numericMaxLength: o?.numericMaxLength ?? null,
        numericAllowSign: o?.numericAllowSign ?? true,
        numericAllowDecimal: o?.numericAllowDecimal ?? true,
      };
    }
    return data;
  }


  private async requireOwnedUsage(userId: string, usageId: string): Promise<void> {
    const usage = await this.repo.getUsage(usageId);
    if (!usage || usage.userId !== userId) {
      throw new NotFoundException({ message: `Question usage ${usageId} not found`, code: 'question.usage_not_found' });
    }
  }
  private async requireOwnedAttempt(userId: string, attempt: AttemptRow): Promise<void> {
    const usage = await this.repo.getUsage(attempt.questionUsageId);
    if (!usage || usage.userId !== userId) {
      throw new NotFoundException({ message: `Question attempt ${attempt.id} not found`, code: 'question.attempt_not_found' });
    }
  }

  private async requireNotLockedByQuizAttempt(usageId: string): Promise<void> {
    const link = await this.repo.findQuizAttemptByUsageId(usageId);
    if (link && (link.state === 'inprogress' || await this.repo.usageHasSnapshots(usageId))) {
      throw new ForbiddenException({
        message: 'This usage belongs to a quiz attempt in progress; answer and submit through the quiz',
        code: 'question.usage_managed_by_quiz',
      });
    }
  }
  async assertUsageManipulableViaHttp(actorId: string, usageId: string): Promise<void> {
    await this.requireOwnedUsage(actorId, usageId);
    await this.requireNotLockedByQuizAttempt(usageId);
  }
  async assertAttemptManipulableViaHttp(actorId: string, usageId: string, attemptId: string): Promise<void> {
    const attempt = await this.repo.getAttempt(attemptId);
    if (!attempt || attempt.questionUsageId !== usageId) {
      throw new NotFoundException({ message: `Question attempt ${attemptId} not found`, code: 'question.attempt_not_found' });
    }
    const usage = await this.repo.getUsage(usageId);
    if (!usage || usage.userId !== actorId) {
      throw new NotFoundException({ message: `Question attempt ${attemptId} not found`, code: 'question.attempt_not_found' });
    }
    await this.requireNotLockedByQuizAttempt(usageId);
  }

  async startAttempt(userId: string, attemptId: string): Promise<AttemptView> {
    const attempt = await this.getAttempt(attemptId);
    await this.requireOwnedAttempt(userId, attempt);
    await this.transition(attempt, 'todo');
    let pinnedVersionId = attempt.questionVersionId;
    if (!pinnedVersionId) {
      const { entry } = await this.getQuestion(attempt.questionId);
      const versions = await this.repo.listVersions(entry.id);
      const ready = versions.filter((v) => v.status === 'ready');
      const chosen = ready.length ? ready[ready.length - 1]! : (entry.status === 'draft' ? undefined : versions[versions.length - 1]);
      if (!chosen) throw new NotFoundException({ message: `Question ${attempt.questionId} latest version missing`, code: 'question.version_missing' });
      pinnedVersionId = chosen.id;
    }
    await this.repo.updateAttempt(attempt.id, { state: 'todo', questionVersionId: pinnedVersionId, userId: userId });
    const updated = await this.getAttempt(attempt.id);
    await this.appendStep(updated, userId, 'todo', null);
    const usage = await this.getUsage(attempt.questionUsageId);
    return usage.attempts.find((a) => a.id === attemptId)!;
  }

  async submitResponse(userId: string, attemptId: string, response: string | null): Promise<AttemptView> {
    const attempt = await this.getAttempt(attemptId);
    await this.requireOwnedAttempt(userId, attempt);
    const behaviour = BEHAVIOURS[attempt.behaviour];
    if (!behaviour) throw new BadRequestException({ message: `Unknown behaviour ${attempt.behaviour}`, code: 'question.unknown_behaviour' });
    const to = behaviour.stateAfterSubmit(response);
    await this.transition(attempt, to);
    await this.repo.updateAttempt(attempt.id, { state: to, responseSummary: response ?? '', userId: userId });
    const updated = await this.getAttempt(attempt.id);
    await this.appendStep(updated, userId, to, null, { answer: response ?? '' });
    const usage = await this.getUsage(attempt.questionUsageId);
    return usage.attempts.find((a) => a.id === attemptId)!;
  }

  async finishAttempt(userId: string, attemptId: string, tfScale?: readonly number[] | null): Promise<AttemptView> {
    const attempt = await this.getAttempt(attemptId);
    await this.requireOwnedAttempt(userId, attempt);
    if (attempt.state === 'notstarted') {
      throw new BadRequestException({ message: 'Cannot finish an attempt that was never started', code: 'question.not_started' });
    }
    if (['gradedright', 'gradedpartial', 'gradedwrong', 'gaveup', 'needsgrading'].includes(attempt.state)) {
      const usage = await this.getUsage(attempt.questionUsageId);
      return usage.attempts.find((a) => a.id === attemptId)!;
    }
    const behaviour = BEHAVIOURS[attempt.behaviour];
    if (!behaviour) throw new BadRequestException({ message: `Unknown behaviour ${attempt.behaviour}`, code: 'question.unknown_behaviour' });
    if (!attempt.questionVersionId) throw new BadRequestException({ message: 'Attempt has no pinned version', code: 'question.no_version' });
    const content = await this.getAttemptContent(attempt);
    const response = await this.latestResponse(attempt.id);
    const options = content.options ?? {};
    const gradingData: GradingData = {
      answers: content.answers.map((a) => ({ id: a.id, text: extractRichTextPlainText(a.answer as RichTextDocument), isCorrect: a.isCorrect })),
    };
    if (content.qtype === 'truefalse') {
      const solution = content.answerKey.solution as { answers?: { statementId: string; value: boolean }[] } | null;
      gradingData.truefalseStatements = solution?.answers ?? [];
      if (tfScale) gradingData.tfScale = tfScale;
    } else if (content.qtype === 'shortanswer') {
      gradingData.shortanswer = { useCase: options.useCase === true, numericAnswer: options.numericAnswer === true,
        numericMaxLength: typeof options.numericMaxLength === 'number' ? options.numericMaxLength : null,
        numericAllowSign: options.numericAllowSign !== false, numericAllowDecimal: options.numericAllowDecimal !== false };
    }
    const outcome = behaviour.gradeAtFinish(content.qtype, gradingData, response);
    let state: QuestionState;
    let fraction: number | null;
    if (outcome === null) { state = 'gaveup'; fraction = 0; }
    else { state = outcome.state; fraction = outcome.fraction; }
    await this.transition(attempt, state);
    await this.repo.updateAttempt(attempt.id, {
      state, fraction, rightAnswer: outcome?.rightAnswer ?? attempt.rightAnswer, userId: userId,
    });
    const updated = await this.getAttempt(attempt.id);
    await this.appendStep(updated, userId, state, fraction);
    const usage = await this.getUsage(attempt.questionUsageId);
    return usage.attempts.find((a) => a.id === attemptId)!;
  }

  async finishUsage(userId: string, usageId: string, opts?: { tfScale?: readonly number[] | null }): Promise<UsageView> {
    await this.requireOwnedUsage(userId, usageId);
    const before = await this.getUsage(usageId);
    for (const a of before.attempts) {
      if (a.state !== 'notstarted') await this.finishAttempt(userId, a.id, opts?.tfScale);
    }
    const after = await this.getUsage(usageId);
    await this.outbox.enqueueStandalone({
      aggregate: 'question', type: 'question_usage_finished',
      payload: { usageId, userId, actorId: userId, state: after.state, attempts: after.attempts.map((a) => ({ attemptId: a.id, state: a.state, fraction: a.fraction })) },
    });
    return after;
  }

  async manualGradeAttempt(graderId: string, attemptId: string, mark: number, comment?: string): Promise<AttemptView> {
    const attempt = await this.getAttempt(attemptId);
    if (attempt.state !== 'needsgrading') {
      throw new BadRequestException({ message: `Question attempt ${attemptId} is not waiting for manual grading (state ${attempt.state})`, code: 'question.not_needs_grading' });
    }
    if (!(mark >= 0) || attempt.maxMark <= 0 || mark > attempt.maxMark + 1e-9) {
      throw new BadRequestException({ message: `Manual mark must be between 0 and the attempt max mark (${attempt.maxMark})`, code: 'question.manual_mark_out_of_range' });
    }
    const fraction = Math.min(1, Math.max(0, mark / attempt.maxMark));
    const state = gradedStateForFraction(fraction);
    await this.transition(attempt, state);
    await this.repo.updateAttempt(attempt.id, { state, fraction, userId: attempt.userId ?? graderId });
    const updated = await this.getAttempt(attempt.id);
    const data: Record<string, string> = { mark: String(mark) };
    if (comment) data.comment = comment;
    data.gradedBy = graderId;
    await this.appendStep(updated, graderId, state, fraction, data);
    const usage = await this.getUsage(attempt.questionUsageId);
    return usage.attempts.find((a) => a.id === attemptId)!;
  }

  async previewRegradeAttempt(attemptId: string, toVersionId: string, tfScale?: readonly number[] | null): Promise<{
    fromVersionId: string; toVersionId: string;
    oldFraction: number | null; oldState: string;
    newFraction: number | null; newState: string;
  }> {
    const attempt = await this.getAttempt(attemptId);
    const computed = await this.computeRegradeOutcome(attempt, toVersionId, tfScale);
    return {
      fromVersionId: attempt.questionVersionId!,
      toVersionId,
      oldFraction: attempt.fraction,
      oldState: attempt.state,
      newFraction: computed.outcome.fraction,
      newState: computed.outcome.state,
    };
  }

  async regradeAttemptWithVersion(graderId: string, attemptId: string, toVersionId: string, tfScale?: readonly number[] | null): Promise<{
    attempt: AttemptView; fromVersionId: string; oldFraction: number | null; newFraction: number | null;
  }> {
    const attempt = await this.getAttempt(attemptId);
    const computed = await this.computeRegradeOutcome(attempt, toVersionId, tfScale);
    const fromVersionId = attempt.questionVersionId!;
    const oldFraction = attempt.fraction;
    await this.repo.updateAttempt(attempt.id, {
      state: computed.outcome.state,
      fraction: computed.outcome.fraction,
      rightAnswer: computed.outcome.rightAnswer,
      questionVersionId: toVersionId,
    });
    const updated = await this.getAttempt(attempt.id);
    await this.appendStep(updated, graderId, computed.outcome.state, computed.outcome.fraction, {
      regradedBy: graderId, fromVersionId, toVersionId,
    });
    const usage = await this.getUsage(attempt.questionUsageId);
    return {
      attempt: usage.attempts.find((a) => a.id === attemptId)!,
      fromVersionId, oldFraction, newFraction: computed.outcome.fraction,
    };
  }

  private async computeRegradeOutcome(attempt: AttemptRow, toVersionId: string, tfScale?: readonly number[] | null): Promise<{ outcome: GradeOutcome }> {
    if (!['gradedright', 'gradedpartial', 'gradedwrong', 'gaveup'].includes(attempt.state)) {
      throw new BadRequestException({
        message: `Question attempt ${attempt.id} is not auto-graded yet (state ${attempt.state}); only auto-graded attempts can be regraded against a corrected version`,
        code: 'question.attempt_not_graded',
      });
    }
    if (!attempt.questionVersionId) {
      throw new BadRequestException({ message: 'Attempt has no pinned version', code: 'question.no_version' });
    }
    const q = await this.repo.getQuestion(attempt.questionId);
    if (q?.qtype === 'essay') {
      throw new BadRequestException({
        message: 'Essay attempts are graded manually and cannot be regraded against an answer key',
        code: 'question.regrade_not_supported',
      });
    }
    const version = await this.repo.getVersion(toVersionId);
    if (!version || version.questionId !== attempt.questionId) {
      throw new NotFoundException({ message: `Question version ${toVersionId} not found for question ${attempt.questionId}`, code: 'question.version_not_found' });
    }
    if (version.status !== 'ready') {
      throw new BadRequestException({
        message: `Question version ${toVersionId} is not ready (status ${version.status}); regrading needs the corrected ready version`,
        code: 'question.regrade_version_not_ready',
      });
    }
    const rawResponse = await this.latestResponse(attempt.id);
    if (rawResponse === null || rawResponse.trim() === '') {
      return { outcome: { fraction: 0, state: 'gaveup', rightAnswer: attempt.rightAnswer ?? '' } };
    }
    const response = q?.qtype === 'multichoice'
      ? await this.translateMultichoiceResponse(attempt.questionVersionId, version.id, rawResponse)
      : rawResponse;
    const gradingData = await this.gradingDataFor(version, q?.qtype ?? '', tfScale);
    return { outcome: gradeAnswer(q?.qtype ?? '', gradingData, response) };
  }

  private async translateMultichoiceResponse(fromVersionId: string, toVersionId: string, response: string): Promise<string> {
    const [fromAnswers, toAnswers] = await Promise.all([
      this.repo.listAnswers(fromVersionId),
      this.repo.listAnswers(toVersionId),
    ]);
    const normalise = (value: string): string => value.normalize('NFC').trim();
    const toIdByText = new Map<string, string>();
    for (const a of toAnswers) {
      const text = normalise(extractRichTextPlainText(a.answer as RichTextDocument));
      if (!toIdByText.has(text)) toIdByText.set(text, a.id);
    }
    const fromById = new Map(fromAnswers.map((a) => [a.id, a]));
    const mapped: string[] = [];
    for (const id of response.split(',').map((x) => x.trim()).filter((x) => x !== '')) {
      const from = fromById.get(id);
      if (!from) continue;
      const toId = toIdByText.get(normalise(extractRichTextPlainText(from.answer as RichTextDocument)));
      if (toId) mapped.push(toId);
    }
    return mapped.join(',');
  }

  async startUsage(userId: string, usageId: string): Promise<UsageView> {
    await this.requireOwnedUsage(userId, usageId);
    const view = await this.getUsage(usageId);
    for (const a of view.attempts) {
      if (a.state === 'notstarted') await this.startAttempt(userId, a.id);
    }
    return this.getUsage(usageId);
  }

  forbidden(msg: string): never { throw new ForbiddenException({ message: msg, code: 'question.forbidden' }); }
}
