import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type {
  QuestionSolution,
  QuizAttemptSummary,
  QuizView,
  RichTextDocument,
} from '@giaokhoa/contracts';
import { extractRichTextPlainText } from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { CoursesService } from '../courses/courses.service';
import { EnrolService } from '../enrol/enrol.service';
import { FilesService } from '../files/files.service';
import { GradesService } from '../grades/grades.service';
import { GroupsService } from '../groups/groups.service';
import { QuestionsService } from '../questions/questions.service';
import { PasswordService } from '../users/password.service';
import { UsersService } from '../users/users.service';
import { ipMatchesSubnetList } from './domain/subnet';
import {
  QUIZ_PIN_ATTEMPTS_LIMIT,
  QuizRepository,
  type ExamAttemptEventRow,
  type ExamAttemptRow,
  type ExamPinOverrideRow,
} from '@giaokhoa/db/repositories/quiz';
import { QuizSharedService } from './quiz-shared.service';
import { QUIZ_COMPONENT } from './quiz-shared.service';
import { QUIZ_CAPABILITIES } from './quiz-shared.service';
import type {
  EffectiveQuizSettings,
  QuizAttemptQuestionView,
  QuizAttemptView,
  QuizQuestionStat,
  QuizResultsSummary,
  QuizNeedsGradingView,
  PinRow,
  EffectiveSlotRow,
} from './quiz.service';

export const REVIEW_WINDOW = {
  during: 0x10000,
  immediatelyAfter: 0x01000,
  laterWhileOpen: 0x00100,
  afterClose: 0x00010,
} as const;

export const REVIEW_IMMEDIATELY_AFTER_MS = 2 * 60 * 1000;


export class QuizAttemptsService {
  private readonly logger = new Logger(QuizAttemptsService.name);

  constructor(
    private readonly repo: QuizRepository,
    private readonly courses: CoursesService,
    private readonly questions: QuestionsService,
    private readonly grades: GradesService,
    private readonly users: UsersService,
    private readonly enrol: EnrolService,
    private readonly passwords: PasswordService,
    private readonly groups: GroupsService,
    private readonly outbox: OutboxService,
    private readonly files: FilesService,
    private readonly shared: QuizSharedService,
  ) {}

  private async isInTargetGroup(quiz: PinRow, userId: string): Promise<boolean> {
    if (!quiz.targetGroupId) return true;
    const mine = await this.groups.groupsOfUser(quiz.course, userId);
    return mine.some((g) => g.id === quiz.targetGroupId);
  }

  async resolveEffectiveSettings(quiz: PinRow, userId: string): Promise<EffectiveQuizSettings> {
    const overrides = await this.repo.listOverrides(quiz.id);
    const userOverride = overrides.find((o) => o.userId === userId);
    let groupOverrides: ExamPinOverrideRow[] = [];
    if (overrides.some((o) => o.groupId !== null)) {
      const myGroupIds = new Set((await this.groups.groupsOfUser(quiz.course, userId)).map((g) => g.id));
      groupOverrides = overrides.filter((o) => o.groupId !== null && myGroupIds.has(o.groupId));
    }
    const hasGroups = groupOverrides.length > 0;
    const mergeDate = (pick: (o: ExamPinOverrideRow) => Date | null, widest: 'min' | 'max'): Date | null | undefined => {
      if (!hasGroups) return undefined;
      if (groupOverrides.some((o) => pick(o) === null)) return null;
      const values = groupOverrides.map((o) => pick(o)!.getTime());
      return new Date(widest === 'min' ? Math.min(...values) : Math.max(...values));
    };
    const mergeLimit = (): number | null | undefined => {
      if (!hasGroups) return undefined;
      if (groupOverrides.some((o) => o.timeLimit === null)) return null;
      return Math.max(...groupOverrides.map((o) => o.timeLimit!));
    };
    const mergeAttempts = (): number | undefined => {
      if (!hasGroups) return undefined;
      if (groupOverrides.some((o) => o.attempts === null || o.attempts === 0)) return 0;
      return Math.max(...groupOverrides.map((o) => o.attempts!));
    };
    const pickField = <T>(userValue: T | null | undefined, groupValue: T | null | undefined, quizValue: T): T => {
      if (userValue !== undefined && userValue !== null) return userValue;
      if (groupValue !== undefined) return groupValue as T;
      return quizValue;
    };
    let passwordHashes: string[] = [];
    if (userOverride?.passwordHash) {
      passwordHashes = [userOverride.passwordHash];
    } else {
      const groupHashes = groupOverrides.map((o) => o.passwordHash).filter((h): h is string => h !== null);
      if (groupHashes.length) passwordHashes = groupHashes;
      else if (quiz.passwordHash) passwordHashes = [quiz.passwordHash];
    }
    return {
      timeOpen: pickField(userOverride?.timeOpen, mergeDate((o) => o.timeOpen, 'min'), quiz.timeOpen),
      timeClose: pickField(userOverride?.timeClose, mergeDate((o) => o.timeClose, 'max'), quiz.timeClose),
      timeLimit: pickField(userOverride?.timeLimit, mergeLimit(), quiz.timeLimit),
      attemptsAllowed: pickField(userOverride?.attempts, mergeAttempts(), quiz.attemptsAllowed),
      passwordHashes,
      passwordRequired: passwordHashes.length > 0,
      subnet: quiz.subnet,
      userOverrideId: userOverride?.id ?? null,
      groupOverrideIds: groupOverrides.map((o) => o.id),
    };
  }

  private async attemptEligibility(quiz: PinRow, userId: string, now: Date): Promise<{
    canAttempt: boolean; reason: string | null; inProgressAttemptId: string | null;
    nextAttemptAt: string | null; passwordRequired: boolean;
  }> {
    const mine = await this.repo.listAttemptsForUser(quiz.id, userId);
    const inProgress = mine.find((a) => a.state === 'inprogress');
    const effective = await this.resolveEffectiveSettings(quiz, userId);
    if (inProgress) return { canAttempt: true, reason: null, inProgressAttemptId: inProgress.id, nextAttemptAt: null, passwordRequired: effective.passwordRequired };
    if (effective.timeOpen && now < effective.timeOpen) return { canAttempt: false, reason: 'not_yet_open', inProgressAttemptId: null, nextAttemptAt: null, passwordRequired: effective.passwordRequired };
    if (effective.timeClose && now > effective.timeClose) return { canAttempt: false, reason: 'closed', inProgressAttemptId: null, nextAttemptAt: null, passwordRequired: effective.passwordRequired };
    if (effective.attemptsAllowed > 0 && mine.length >= effective.attemptsAllowed) return { canAttempt: false, reason: 'no_more_attempts', inProgressAttemptId: null, nextAttemptAt: null, passwordRequired: effective.passwordRequired };
    if (quiz.lateEntryMinutes !== null && effective.timeOpen
      && now.getTime() > effective.timeOpen.getTime() + quiz.lateEntryMinutes * 60_000) {
      return { canAttempt: false, reason: 'late_entry_closed', inProgressAttemptId: null, nextAttemptAt: null, passwordRequired: effective.passwordRequired };
    }
    const slots = await this.shared.effectiveSlots(quiz);
    if (!slots.length) return { canAttempt: false, reason: 'no_questions', inProgressAttemptId: null, nextAttemptAt: null, passwordRequired: effective.passwordRequired };
    return { canAttempt: true, reason: null, inProgressAttemptId: null, nextAttemptAt: null, passwordRequired: effective.passwordRequired };
  }

  async currentGradeForUser(quiz: PinRow, userId: string): Promise<number | null> {
    const finished = (await this.repo.listAttemptsForUser(quiz.id, userId)).filter((a) => a.state === 'finished' && a.sumGrades !== null);
    return this.gradeFromFinishedAttempts(quiz, finished);
  }

  private async gradeFromFinishedAttempts(quiz: PinRow, finished: ExamAttemptRow[]): Promise<number | null> {
    if (!finished.length) return null;
    const totals = await this.questions.usageTotalMaxes(finished.map((a) => a.usageId));
    return this.gradeFromTotals(quiz, finished, totals);
  }

  private gradeFromTotals(quiz: PinRow, finished: ExamAttemptRow[], totals: Map<string, number>): number | null {
    const values: number[] = [];
    for (const a of finished) {
      const v = this.shared.attemptGradeValue(quiz, a, totals.get(a.usageId) ?? 0);
      if (v !== null) values.push(v);
    }
    if (!values.length) return null;
    switch (quiz.gradeMethod) {
      case 'first': return values[0]!;
      case 'last': return values[values.length - 1]!;
      case 'average': return values.reduce((s, v) => s + v, 0) / values.length;
      default: return Math.max(...values);
    }
  }

  private async gradeTotalsPublished(quiz: PinRow): Promise<boolean> {
    if (!quiz.cmId) return true;
    const item = await this.grades.getItemForCm(quiz.course, quiz.cmId).catch(() => undefined);
    if (!item) return true;
    return (await this.grades.itemPublicationState(item)).published;
  }

  private async ownerMarksVisible(quiz: PinRow, row: ExamAttemptRow, now: Date): Promise<boolean> {
    if (row.state === 'inprogress') return false;
    const windowBit = await this.reviewWindowBit(quiz, row, now);
    if ((quiz.reviewAttempt & windowBit) === 0) return false;
    return (quiz.reviewMarks & windowBit) !== 0;
  }

  private async maskOwnerTotals(quiz: PinRow, summary: QuizAttemptSummary, marksVisible: boolean): Promise<QuizAttemptSummary> {
    if (summary.grade === null && summary.sumGrades === null) return summary;
    if (marksVisible && (await this.gradeTotalsPublished(quiz))) return summary;
    return { ...summary, grade: null, sumGrades: null };
  }

  private async myGradeForViewer(quiz: PinRow, userId: string, ownAttempts: ExamAttemptRow[], isStaffViewer: boolean): Promise<number | null> {
    const value = await this.currentGradeForUser(quiz, userId);
    if (value === null || isStaffViewer) return value;
    const contributing = ownAttempts.filter((a) => !a.preview && a.state === 'finished' && a.sumGrades !== null);
    const latest = contributing[contributing.length - 1];
    if (!latest) return null;
    const marksVisible = await this.ownerMarksVisible(quiz, latest, new Date());
    return marksVisible && (await this.gradeTotalsPublished(quiz)) ? value : null;
  }

  async getQuizForUser(actorId: string, pinId: string): Promise<{
    quiz: QuizView;
    myAttempts: QuizAttemptSummary[];
    myGrade: number | null;
    canAttempt: boolean;
    attemptBlockedReason: string | null;
    inProgressAttemptId: string | null;
    effective: {
      timeOpen: string | null; timeClose: string | null;
      timeLimitSeconds: number | null; attemptsAllowed: number;
      passwordRequired: boolean; nextAttemptAt: string | null;
    };
    permissions: { manage: boolean; manageOverrides: boolean; grade: boolean; viewReports: boolean; preview: boolean; attempt: boolean };
  }> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireAnyViewCap(actorId, quiz);
    const view = await this.shared.pinView(quiz);
    const [manage, manageOverrides, grade, viewReports, preview, attempt] = await Promise.all([
      this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.manage),
      this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.manageOverrides),
      this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.grade),
      this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.viewReports),
      this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.preview),
      this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.attempt),
    ]);
    const isStaffViewer = manage || grade || viewReports || preview;
    if (!isStaffViewer && !(await this.isInTargetGroup(quiz, actorId))) {
      throw new NotFoundException({ message: `Exam pin ${pinId} not found`, code: 'exam.pin_not_found' });
    }
    const mine = await this.repo.listAttemptsForUser(quiz.id, actorId, true);
    const rawSummaries = await this.shared.attemptSummaries(quiz, mine);
    const summaries: QuizAttemptSummary[] = [];
    for (const [index, a] of mine.entries()) {
      const summary = rawSummaries[index]!;
      summaries.push(!isStaffViewer && !a.preview
        ? await this.maskOwnerTotals(quiz, summary, await this.ownerMarksVisible(quiz, a, new Date()))
        : summary);
    }
    const eligibility = await this.attemptEligibility(quiz, actorId, new Date());
    const effective = await this.resolveEffectiveSettings(quiz, actorId);
    return {
      quiz: view,
      myAttempts: summaries,
      myGrade: await this.myGradeForViewer(quiz, actorId, mine, isStaffViewer),
      canAttempt: attempt && eligibility.canAttempt,
      attemptBlockedReason: eligibility.canAttempt ? null : eligibility.reason,
      inProgressAttemptId: eligibility.inProgressAttemptId,
      effective: {
        timeOpen: effective.timeOpen?.toISOString() ?? null,
        timeClose: effective.timeClose?.toISOString() ?? null,
        timeLimitSeconds: effective.timeLimit,
        attemptsAllowed: effective.attemptsAllowed,
        passwordRequired: effective.passwordRequired,
        nextAttemptAt: eligibility.nextAttemptAt,
      },
      permissions: { manage, manageOverrides, grade, viewReports, preview, attempt },
    };
  }


  async startAttempt(actorId: string, pinId: string, opts: { preview?: boolean; password?: string; clientIp?: string } = {}): Promise<QuizAttemptView> {
    const quiz = await this.shared.getPin(pinId);
    const preview = opts.preview === true;
    if (preview) {
      await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.preview);
    } else {
      await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.attempt);
      await this.courses.assertCourseAccess(actorId, quiz.course);
      if (!(await this.isInTargetGroup(quiz, actorId))) {
        throw new ForbiddenException({ message: 'This exam is limited to a specific group of this course', code: 'exam.pin_not_in_target_group' });
      }
    }
    const existing = await this.repo.listAttemptsForUser(quiz.id, actorId, true);
    const inProgress = existing.find((a) => a.state === 'inprogress' && a.preview === preview);
    if (inProgress) {
      if (await this.isOverdue(quiz, inProgress)) return this.finalizeAttempt(quiz, inProgress, true);
      return this.buildAttemptView(quiz, inProgress, false);
    }

    const now = new Date();
    let effectiveForSnapshot: EffectiveQuizSettings | null = null;
    if (!preview) {
      const effective = await this.resolveEffectiveSettings(quiz, actorId);
      effectiveForSnapshot = effective;
      if (effective.timeOpen && now < effective.timeOpen) {
        throw new ForbiddenException({ message: 'This quiz is not open yet', code: 'quiz.not_yet_open' });
      }
      if (quiz.lateEntryMinutes !== null && effective.timeOpen
        && now.getTime() > effective.timeOpen.getTime() + quiz.lateEntryMinutes * 60_000) {
        throw new ForbiddenException({ message: 'The late-entry window for this quiz has passed', code: 'quiz.late_entry_closed' });
      }
      if (effective.timeClose && now > effective.timeClose) {
        throw new ForbiddenException({ message: 'This quiz is closed', code: 'quiz.closed' });
      }
      const mine = existing.filter((a) => !a.preview);
      if (effective.attemptsAllowed > 0 && mine.length >= effective.attemptsAllowed) {
        throw new ForbiddenException({ message: 'No more attempts are allowed for this quiz', code: 'quiz.no_more_attempts' });
      }
      if (effective.passwordRequired) {
        if (opts.password === undefined || opts.password === '') {
          throw new ForbiddenException({ message: 'A password is required to start this quiz', code: 'quiz.password_required' });
        }
        let matched = false;
        for (const hash of effective.passwordHashes) {
          if (await this.passwords.verify(hash, opts.password)) { matched = true; break; }
        }
        if (!matched) {
          throw new ForbiddenException({ message: 'The quiz password is incorrect', code: 'quiz.password_incorrect' });
        }
      }
      this.assertSubnetAllowed(quiz, opts.clientIp);
    }
    const slots = await this.shared.effectiveSlots(quiz);
    if (!slots.length) throw new BadRequestException({ message: 'This quiz has no questions yet', code: 'quiz.no_questions' });

    const resolvedSlots: { quizSlot: EffectiveSlotRow; questionId: string }[] = [];
    for (const s of slots) {
      if (!s.questionId) {
        throw new BadRequestException({ message: `Slot ${s.slot} of this pin has no pinned question`, code: 'exam.pin_slot_unresolved' });
      }
      resolvedSlots.push({ quizSlot: s, questionId: s.questionId });
    }

    const attemptNumber = existing.length + 1;
    const usage = await this.questions.createUsage(actorId, {
      component: QUIZ_COMPONENT, instanceId: quiz.id, contextId: await this.shared.cmContextId(quiz),
      slots: resolvedSlots.map((e) => ({
        questionId: e.questionId, maxMark: e.quizSlot.maxMark,
        snapshot: quiz.versionMode === 'float_latest_ready' ? undefined : quiz.questionSnapshots?.[e.quizSlot.slot - 1],
        pinnedVersionId: quiz.versionMode === 'float_latest_ready'
          ? undefined
          : (e.quizSlot.pinnedVersionId ?? undefined),
      })),
    });
    const eff = effectiveForSnapshot;
    const userOv = eff?.userOverrideId ? (await this.repo.listOverrides(quiz.id)).find((o) => o.id === eff.userOverrideId) : undefined;
    const makeup = !preview && !!userOv && userOv.timeOpen !== null
      && (quiz.timeOpen === null || userOv.timeOpen.getTime() !== quiz.timeOpen.getTime());
    const appliedSettings: Record<string, unknown> | null = preview || !eff ? null : {
      timeOpen: eff.timeOpen?.toISOString() ?? null,
      timeClose: eff.timeClose?.toISOString() ?? null,
      timeLimitSeconds: eff.timeLimit,
      attemptsAllowed: eff.attemptsAllowed,
      passwordRequired: eff.passwordRequired,
      subnet: eff.subnet,
      preset: (quiz.preset as QuizView['preset']) ?? null,
      versionMode: quiz.versionMode,
      lateEntryMinutes: quiz.lateEntryMinutes,
      monitorEvents: quiz.monitorEvents,
      userOverrideId: eff.userOverrideId,
      groupOverrideIds: eff.groupOverrideIds,
      questionOrder: resolvedSlots.map((e) => e.questionId),
    };
    try {
      await this.questions.startUsage(actorId, usage.usage.id);
      const row = await this.repo.insertAttempt({
        pinId: quiz.id, userId: actorId, attemptNumber, usageId: usage.usage.id,
        state: 'inprogress', preview, timeStart: now,
        makeup, appliedSettings,
      });
      await this.outbox.enqueueStandalone({
        aggregate: 'quiz', type: 'quiz_attempt_started',
        payload: { pinId: quiz.id, courseId: quiz.course, attemptId: row.id, usageId: row.usageId, userId: actorId, attemptNumber, preview, actorId },
      });
      return this.buildAttemptView(quiz, row, false);
    } catch (err) {
      await this.questions.deleteUsage(usage.usage.id).catch(() => undefined);
      throw err;
    }
  }

  private assertSubnetAllowed(quiz: PinRow, clientIp: string | undefined): void {
    if (!quiz.subnet) return;
    if (!clientIp || !ipMatchesSubnetList(clientIp, quiz.subnet)) {
      throw new ForbiddenException({ message: 'Your network address is not allowed for this quiz', code: 'quiz.subnet_denied' });
    }
  }

  private async attemptDeadline(quiz: PinRow, row: ExamAttemptRow): Promise<Date | null> {
    const effective = await this.resolveEffectiveSettings(quiz, row.userId);
    let deadline: number | null = null;
    if (effective.timeLimit) deadline = row.timeStart.getTime() + effective.timeLimit * 1000;
    if (effective.timeClose) {
      const close = effective.timeClose.getTime();
      deadline = deadline === null ? close : Math.min(deadline, close);
    }
    return deadline === null ? null : new Date(deadline);
  }

  private async isOverdue(quiz: PinRow, row: ExamAttemptRow): Promise<boolean> {
    const deadline = await this.attemptDeadline(quiz, row);
    return deadline !== null && new Date() > deadline;
  }

  private async reviewWindowBit(quiz: PinRow, row: ExamAttemptRow, now: Date): Promise<number> {
    const finish = row.timeFinish?.getTime() ?? now.getTime();
    if (now.getTime() < finish + REVIEW_IMMEDIATELY_AFTER_MS) return REVIEW_WINDOW.immediatelyAfter;
    const session = await this.repo.sessionLatestClose(quiz.id);
    if (session.hasUnbounded || session.latest === null || now <= session.latest) return REVIEW_WINDOW.laterWhileOpen;
    return REVIEW_WINDOW.afterClose;
  }

  async buildAttemptView(quiz: PinRow, row: ExamAttemptRow, closedDueToTimeLimit: boolean, viewerId?: string): Promise<QuizAttemptView> {
    const usage = await this.questions.getUsage(row.usageId);
    const slots = await this.shared.effectiveSlots(quiz);
    const pageBySlot = new Map(slots.map((s) => [s.slot, s.page]));
    const submitted = row.state !== 'inprogress';
    const viewer = viewerId ?? row.userId;
    let privileged = row.preview || viewer !== row.userId;
    if (!privileged) {
      privileged = (await this.shared.hasCap(viewer, quiz, QUIZ_CAPABILITIES.grade))
        || (await this.shared.hasCap(viewer, quiz, QUIZ_CAPABILITIES.viewReports))
        || (await this.shared.hasCap(viewer, quiz, QUIZ_CAPABILITIES.manage));
    }
    let windowBit = 0;
    let hideContent = false;
    if (submitted && !privileged) {
      windowBit = await this.reviewWindowBit(quiz, row, new Date());
      hideContent = (quiz.reviewAttempt & windowBit) === 0;
    }
    const marksPublished = privileged || !quiz.questionSnapshots || await this.gradeTotalsPublished(quiz);
    const showAspects = submitted && (privileged || !hideContent);
    const aspectOn = (mask: number): boolean => privileged ? submitted : (showAspects && (mask & windowBit) !== 0);
    const questions: QuizAttemptQuestionView[] = [];
    for (const a of usage.attempts) {
      if (hideContent && !privileged) break;
      const content = await this.questions.getAttemptContent(a);
      const questionText = content.questionText as RichTextDocument;
      let answers = content.answers.map((x) => ({ id: x.id, text: x.answer as RichTextDocument }));
      const options = content.options;
      const stimulus = content.stimulus ? { id: content.stimulus.id, content: content.stimulus.content as RichTextDocument } : null;
      const feedbackByAnswerId = new Map(content.answers.map((x) => [x.id, (x.feedback ?? null) as RichTextDocument | null]));
      const generalFeedback = (content.generalFeedback ?? null) as RichTextDocument | null;
      const pinnedAnswers = content.answers;
      const answerKey = content.answerKey;
      if (!privileged && content.qtype === 'shortanswer' && !aspectOn(quiz.reviewRightAnswer)) {
        answers = [];
      }
      const lastResponse = [...a.steps].reverse().find((s) => s.data.answer !== undefined)?.data.answer ?? null;
      const manualCommentStep = [...a.steps]
        .sort((x, y) => x.sequenceNumber - y.sequenceNumber)
        .reverse()
        .find((s) => s.data.gradedBy != null && typeof s.data.comment === 'string' && s.data.comment !== '');
      let solution: QuestionSolution | null = null;
      if (aspectOn(quiz.reviewRightAnswer)) {
        if (content.qtype === 'essay') {
          solution = (answerKey.solution as QuestionSolution | null) ?? null;
        } else if (content.qtype === 'truefalse') {
          const stored = answerKey.solution as { answers?: { statementId: string; value: boolean }[] } | null;
          solution = stored?.answers?.length
            ? { statements: stored.answers.map((a) => ({ statementId: a.statementId, value: a.value === true })) }
            : null;
        } else if (content.qtype === 'shortanswer') {
          const accepted = pinnedAnswers.filter((x) => x.isCorrect)
            .map((x) => extractRichTextPlainText(x.answer as RichTextDocument).trim())
            .filter((x) => x !== '');
          solution = accepted.length ? { acceptedAnswers: accepted } : null;
        } else {
          const correctRow = pinnedAnswers.find((x) => x.isCorrect);
          solution = correctRow ? { correctAnswerId: correctRow.id } : null;
        }
      }
      const excerptText = extractRichTextPlainText(questionText).trim();
      questions.push({
        slot: a.slot,
        page: pageBySlot.get(a.slot) ?? 1,
        questionAttemptId: a.id,
        questionId: a.questionId,
        qtype: content.qtype,
        questionExcerpt: excerptText.length > 120 ? `${excerptText.slice(0, 120)}…` : excerptText,
        questionText,
        guidance: (answerKey.guidance ?? null) as RichTextDocument | null,
        solution,
        stimulus,
        answers,
        options,
        maxMark: a.maxMark,
        state: a.state,
        response: lastResponse,
        fraction: submitted && marksPublished && aspectOn(quiz.reviewCorrectness) ? a.fraction : null,
        mark: (submitted && marksPublished && aspectOn(quiz.reviewMarks) && a.fraction !== null) ? a.fraction * a.maxMark : null,
        rightAnswer: aspectOn(quiz.reviewRightAnswer) ? a.rightAnswer : null,
        feedback: aspectOn(quiz.reviewSpecificFeedback) && lastResponse !== null
          ? (feedbackByAnswerId.get(lastResponse) ?? null)
          : null,
        generalFeedback: aspectOn(quiz.reviewGeneralFeedback) ? generalFeedback : null,
        manualComment: aspectOn(quiz.reviewSpecificFeedback)
          ? (manualCommentStep?.data.comment ?? null)
          : null,
      });
    }
    for (const q of questions) {
      q.questionText = await this.files.resolveQuestionImageUrls(q.questionText);
      q.answers = await Promise.all(q.answers.map(async (a) => ({ ...a, text: await this.files.resolveQuestionImageUrls(a.text) })));
      if (q.stimulus) q.stimulus = { ...q.stimulus, content: await this.files.resolveQuestionImageUrls(q.stimulus.content) };
      q.feedback = await this.files.resolveQuestionImageUrls(q.feedback);
      q.generalFeedback = await this.files.resolveQuestionImageUrls(q.generalFeedback);
      q.guidance = await this.files.resolveQuestionImageUrls(q.guidance);
      if (q.solution && 'answer' in q.solution) {
        q.solution = { answer: await this.files.resolveQuestionImageUrls(q.solution.answer) };
      }
    }
    const { pendingManual } = this.shared.syncFromUsage(usage);
    let overallFeedback: string | null = null;
    if (submitted && row.sumGrades !== null && aspectOn(quiz.reviewOverallFeedback)) {
      const totalMax = this.shared.usageTotalMax(usage);
      if (totalMax > 0) {
        const percent = (row.sumGrades / totalMax) * 100;
        const bands = await this.repo.listFeedbacks(quiz.id);
        const band = bands.find((b) => percent >= b.minPercent && (percent < b.maxPercent || (percent === 100 && b.maxPercent === 100)));
        overallFeedback = band?.feedback ?? null;
      }
    }
    const rawSummary = await this.shared.attemptSummary(quiz, row);
    const attemptSummary = !privileged && submitted
      ? await this.maskOwnerTotals(quiz, rawSummary, aspectOn(quiz.reviewMarks))
      : rawSummary;
    return {
      attempt: attemptSummary,
      quiz: await this.shared.pinView(quiz),
      questions,
      totalMax: this.shared.usageTotalMax(usage),
      pendingManualCount: pendingManual,
      closedDueToTimeLimit,
      overallFeedback,
    };
  }

  async getAttemptView(actorId: string, attemptId: string): Promise<QuizAttemptView> {
    const row = await this.shared.getAttemptRow(attemptId);
    const quiz = await this.shared.getPin(row.pinId);
    await this.shared.requireAttemptReadable(actorId, quiz, row);
    if (row.state === 'inprogress' && row.userId === actorId && await this.isOverdue(quiz, row)) {
      return this.finalizeAttempt(quiz, await this.shared.getAttemptRow(attemptId), true);
    }
    return this.buildAttemptView(quiz, row, false, actorId);
  }

  async submitResponse(actorId: string, attemptId: string, input: { questionAttemptId: string; response?: string | null }, clientIp?: string): Promise<QuizAttemptView> {
    const row = await this.shared.getAttemptRow(attemptId);
    const quiz = await this.shared.getPin(row.pinId);
    if (row.userId !== actorId) {
      throw new ForbiddenException({ message: 'Only the attempt owner can answer', code: 'quiz.attempt_forbidden' });
    }
    if (row.state !== 'inprogress') {
      throw new BadRequestException({ message: 'This attempt is already submitted', code: 'quiz.attempt_already_submitted' });
    }
    if (!row.preview) this.assertSubnetAllowed(quiz, clientIp);
    if (await this.isOverdue(quiz, row)) {
      return this.finalizeAttempt(quiz, row, true);
    }
    const usage = await this.questions.getUsage(row.usageId);
    if (!usage.attempts.some((a) => a.id === input.questionAttemptId)) {
      throw new NotFoundException({ message: `Question attempt ${input.questionAttemptId} is not part of this quiz attempt`, code: 'quiz.question_attempt_not_found' });
    }
    await this.questions.submitResponse(actorId, input.questionAttemptId, input.response ?? null);
    return this.buildAttemptView(quiz, await this.shared.getAttemptRow(attemptId), false);
  }

  public async finalizeAttempt(quiz: PinRow, row: ExamAttemptRow, closedDueToTimeLimit: boolean): Promise<QuizAttemptView> {
    if (row.state !== 'inprogress') return this.buildAttemptView(quiz, row, false);
    const finishedUsage = await this.questions.finishUsage(row.userId, row.usageId, { tfScale: quiz.tfScale });
    const { sumGrades, pendingManual } = this.shared.syncFromUsage(finishedUsage);
    const state = pendingManual > 0 ? 'needsgrading' : 'finished';
    await this.repo.updateAttempt(row.id, { state, timeFinish: new Date(), sumGrades });
    if (closedDueToTimeLimit && quiz.monitorEvents && !row.preview) {
      await this.repo.insertAttemptEvent({ attemptId: row.id, type: 'auto_submit_timeout' }).catch(() => undefined);
    }
    const updated = await this.shared.getAttemptRow(row.id);
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'quiz_attempt_finished',
      payload: {
        pinId: quiz.id, courseId: quiz.course, attemptId: row.id, usageId: row.usageId,
        userId: row.userId, attemptNumber: row.attemptNumber, preview: row.preview,
        sumGrades, needsGrading: pendingManual > 0, closedDueToTimeLimit, actorId: row.userId,
      },
    });
    if (state === 'finished' && !row.preview) await this.pushGrade(quiz, row.userId);
    return this.buildAttemptView(quiz, updated, closedDueToTimeLimit);
  }

  async submitAttempt(actorId: string, attemptId: string): Promise<QuizAttemptView> {
    const row = await this.shared.getAttemptRow(attemptId);
    const quiz = await this.shared.getPin(row.pinId);
    if (row.userId !== actorId) {
      throw new ForbiddenException({ message: 'Only the attempt owner can submit', code: 'quiz.attempt_forbidden' });
    }
    return this.finalizeAttempt(quiz, row, await this.isOverdue(quiz, row));
  }

  public async pushGrade(quiz: PinRow, userId: string): Promise<void> {
    if (!quiz.cmId) return;
    const value = await this.currentGradeForUser(quiz, userId);
    if (value === null) return;
    const item = await this.grades.getItemForCm(quiz.course, quiz.cmId).catch(() => undefined);
    if (!item) {
      this.logger.warn(`quiz ${quiz.id}: no grade item for cm ${quiz.cmId}; grade ${value} for user ${userId} not recorded`);
      return;
    }
    try {
      await this.grades.recordActivityGrade(item.id, userId, value);
    } catch (err) {
      this.logger.warn(`quiz ${quiz.id}: could not record grade ${value} for user ${userId} on item ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }


  async getResults(actorId: string, pinId: string): Promise<{
    quiz: QuizView;
    attempts: QuizAttemptSummary[];
    gradesByUser: { userId: string; grade: number | null }[];
    needsGrading: QuizNeedsGradingView[];
    questionStats: QuizQuestionStat[];
    summary: QuizResultsSummary;
  }> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.viewReports);
    const rows = (await this.repo.listAttempts(quiz.id, QUIZ_PIN_ATTEMPTS_LIMIT)).filter((a) => !a.preview);
    const attempts = await this.shared.attemptSummaries(quiz, rows);
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const finishedByUser = new Map<string, ExamAttemptRow[]>();
    for (const r of rows) {
      if (r.state !== 'finished' || r.sumGrades === null) continue;
      const list = finishedByUser.get(r.userId);
      if (list) list.push(r);
      else finishedByUser.set(r.userId, [r]);
    }
    const finishedAttempts = [...finishedByUser.values()].flat();
    const finishedTotals = finishedAttempts.length
      ? await this.questions.usageTotalMaxes(finishedAttempts.map((a) => a.usageId))
      : new Map<string, number>();
    const gradesByUser = userIds.map((userId) => ({
      userId,
      grade: this.gradeFromTotals(quiz, finishedByUser.get(userId) ?? [], finishedTotals),
    }));
    const summary = await this.resultsSummary(quiz, rows, gradesByUser);
    const needsGrading: QuizNeedsGradingView[] = [];
    const gradingRows = rows.filter((a) => a.state === 'needsgrading');
    const gradingUsages = await this.questions.getUsages(gradingRows.map((r) => r.usageId));
    for (const r of gradingRows) {
      const usage = gradingUsages.get(r.usageId);
      if (!usage) continue;
      for (const a of usage.attempts) {
        if (a.state !== 'needsgrading') continue;
        const lastResponse = [...a.steps].reverse().find((s) => s.data.answer !== undefined)?.data.answer ?? null;
        needsGrading.push({
          quizAttemptId: r.id, userId: r.userId, attemptNumber: r.attemptNumber,
          questionAttemptId: a.id, slot: a.slot, questionId: a.questionId,
          maxMark: a.maxMark, response: lastResponse,
        });
      }
    }
    const questionStats = await this.questionStats(quiz, rows);
    return { quiz: await this.shared.pinView(quiz), attempts, gradesByUser, needsGrading, questionStats, summary };
  }

  private async resultsSummary(
    quiz: PinRow,
    rows: ExamAttemptRow[],
    gradesByUser: { userId: string; grade: number | null }[],
  ): Promise<QuizResultsSummary> {
    const enrolments = await this.enrol.listEnrolmentsForCourse(quiz.course);
    const enrolledIds = [...new Set(enrolments.filter((e) => e.status === 0).map((e) => e.userId))];
    const submittedIds = new Set(rows.filter((r) => r.state === 'finished' || r.state === 'needsgrading').map((r) => r.userId));
    const notSubmittedIds = enrolledIds.filter((id) => !submittedIds.has(id));
    const nameById = new Map<string, string>();
    if (notSubmittedIds.length) {
      for (const u of await this.users.getUsersByIds(notSubmittedIds)) {
        const full = `${u.firstName} ${u.lastName}`.trim();
        nameById.set(u.id, full || u.username);
      }
    }
    const graded = gradesByUser.map((g) => g.grade).filter((g): g is number => g !== null);
    const averageGrade = graded.length ? graded.reduce((a, b) => a + b, 0) / graded.length : null;
    const distribution = Array.from({ length: 10 }, (_, i) => ({ fromPct: i * 10, toPct: (i + 1) * 10, count: 0 }));
    for (const g of graded) {
      const pct = quiz.grade > 0 ? (g / quiz.grade) * 100 : 0;
      const idx = Math.min(9, Math.max(0, Math.floor(pct / 10)));
      distribution[idx]!.count += 1;
    }
    return {
      enrolledCount: enrolledIds.length,
      submittedCount: enrolledIds.filter((id) => submittedIds.has(id)).length,
      notSubmittedStudents: notSubmittedIds.map((userId) => ({ userId, displayName: nameById.get(userId) ?? userId })),
      averageGrade,
      gradeMax: quiz.grade,
      distribution,
    };
  }

  private async questionStats(quiz: PinRow, rows: ExamAttemptRow[]): Promise<QuizQuestionStat[]> {
    const submitted = rows.filter((r) => r.state === 'finished' || r.state === 'needsgrading');
    interface SlotAcc {
      questionIds: Set<string>;
      maxMark: number;
      attemptsCount: number;
      gradedCount: number;
      pendingCount: number;
      wrongCount: number;
      fullyWrongCount: number;
      wrong: { userId: string; quizAttemptId: string; attemptNumber: number; fraction: number; mark: number }[];
      correct: { userId: string }[];
    }
    const bySlot = new Map<number, SlotAcc>();
    const usages = await this.questions.getUsages(submitted.map((r) => r.usageId));
    for (const r of submitted) {
      const usage = usages.get(r.usageId);
      if (!usage) continue;
      for (const a of usage.attempts) {
        let acc = bySlot.get(a.slot);
        if (!acc) {
          acc = {
            questionIds: new Set(), maxMark: a.maxMark, attemptsCount: 0,
            gradedCount: 0, pendingCount: 0, wrongCount: 0, fullyWrongCount: 0, wrong: [], correct: [],
          };
          bySlot.set(a.slot, acc);
        }
        acc.questionIds.add(a.questionId);
        acc.attemptsCount += 1;
        if (a.state === 'needsgrading') {
          acc.pendingCount += 1;
        } else if (a.fraction !== null && a.fraction !== undefined) {
          acc.gradedCount += 1;
          if (a.fraction === 1) acc.correct.push({ userId: r.userId });
          if (a.fraction < 1) {
            acc.wrongCount += 1;
            if (a.fraction === 0) acc.fullyWrongCount += 1;
            acc.wrong.push({
              userId: r.userId, quizAttemptId: r.id, attemptNumber: r.attemptNumber,
              fraction: a.fraction, mark: a.fraction * a.maxMark,
            });
          }
        }
      }
    }
    const statUserIds = [...new Set([...bySlot.values()].flatMap((acc) => [
      ...acc.wrong.map((w) => w.userId),
      ...acc.correct.map((c) => c.userId),
    ]))];
    const nameById = new Map<string, string>();
    if (statUserIds.length) {
      for (const u of await this.users.getUsersByIds(statUserIds)) {
        const full = `${u.firstName} ${u.lastName}`.trim();
        nameById.set(u.id, full || u.username);
      }
    }
    const questionNameById = new Map<string, string>();
    const stats: QuizQuestionStat[] = [];
    for (const [slot, acc] of bySlot) {
      const questionId = acc.questionIds.size === 1 ? [...acc.questionIds][0]! : null;
      let questionName: string | null = null;
      if (questionId) {
        if (!questionNameById.has(questionId)) {
          const view = await this.questions.getQuestion(questionId).catch(() => undefined);
          const snapshot = quiz.questionSnapshots?.find((q) => q.questionId === questionId);
          const questionText = snapshot?.package.questionText ?? view?.latestVersion.questionText;
          const text = questionText ? extractRichTextPlainText(questionText as RichTextDocument).trim() : '';
          questionNameById.set(questionId, text.length > 120 ? `${text.slice(0, 120)}…` : text);
        }
        questionName = questionNameById.get(questionId) || null;
      }
      stats.push({
        slot, questionId, questionName, maxMark: acc.maxMark,
        attemptsCount: acc.attemptsCount, gradedCount: acc.gradedCount,
        pendingCount: acc.pendingCount, wrongCount: acc.wrongCount,
        fullyWrongCount: acc.fullyWrongCount,
        wrongStudents: acc.wrong.map((w) => ({
          userId: w.userId,
          displayName: nameById.get(w.userId) ?? w.userId,
          quizAttemptId: w.quizAttemptId, attemptNumber: w.attemptNumber,
          fraction: w.fraction, mark: w.mark,
        })),
        correctCount: acc.correct.length,
        correctStudents: acc.correct.map((c) => ({
          userId: c.userId,
          displayName: nameById.get(c.userId) ?? c.userId,
        })),
      });
    }
    return stats.sort((x, y) => y.wrongCount - x.wrongCount || x.slot - y.slot);
  }

  async manualGrade(actorId: string, attemptId: string, input: { questionAttemptId: string; mark: number; comment?: string }): Promise<QuizAttemptView> {
    const row = await this.shared.getAttemptRow(attemptId);
    const quiz = await this.shared.getPin(row.pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.grade);
    const usage = await this.questions.getUsage(row.usageId);
    if (!usage.attempts.some((a) => a.id === input.questionAttemptId)) {
      throw new NotFoundException({ message: `Question attempt ${input.questionAttemptId} is not part of this quiz attempt`, code: 'quiz.question_attempt_not_found' });
    }
    await this.questions.manualGradeAttempt(actorId, input.questionAttemptId, input.mark, input.comment);
    const after = await this.questions.getUsage(row.usageId);
    const { sumGrades, pendingManual } = this.shared.syncFromUsage(after);
    const wasSubmitted = row.state === 'needsgrading' || row.state === 'finished';
    const nextState = row.state === 'inprogress' ? row.state : (pendingManual > 0 ? 'needsgrading' : 'finished');
    await this.repo.updateAttempt(row.id, { sumGrades, ...(wasSubmitted ? { state: nextState } : {}) });
    const updated = await this.shared.getAttemptRow(row.id);
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'exam_attempt_regraded',
      payload: {
        pinId: quiz.id, courseId: quiz.course, attemptId: row.id, usageId: row.usageId,
        userId: row.userId, questionAttemptId: input.questionAttemptId, mark: input.mark,
        sumGrades, state: updated.state, actorId,
      },
    });
    if (updated.state === 'finished' && !row.preview) await this.pushGrade(quiz, row.userId);
    return this.buildAttemptView(quiz, updated, false, actorId);
  }


  async recordAttemptEvent(actorId: string, attemptId: string, input: { type: string; data?: Record<string, unknown> }): Promise<ExamAttemptEventRow> {
    const row = await this.shared.getAttemptRow(attemptId);
    if (row.userId !== actorId) {
      throw new ForbiddenException({ message: 'This attempt belongs to another user', code: 'quiz.attempt_forbidden' });
    }
    const quiz = await this.shared.getPin(row.pinId);
    if (!quiz.monitorEvents) {
      throw new BadRequestException({ message: 'Event monitoring is not enabled for this quiz', code: 'quiz.monitoring_disabled' });
    }
    if (row.state !== 'inprogress') {
      throw new BadRequestException({ message: 'Events can only be recorded while the attempt is in progress', code: 'quiz.attempt_not_in_progress' });
    }
    return this.repo.insertAttemptEvent({ attemptId: row.id, type: input.type, data: input.data ?? null });
  }

  async listAttemptEvents(actorId: string, attemptId: string): Promise<ExamAttemptEventRow[]> {
    const row = await this.shared.getAttemptRow(attemptId);
    const quiz = await this.shared.getPin(row.pinId);
    await this.shared.requireAttemptReadable(actorId, quiz, row);
    return this.repo.listAttemptEvents(row.id);
  }

  async listQuestionGradingQueue(actorId: string, pinId: string, questionId: string): Promise<{
    attemptId: string; userId: string; displayName: string; attemptNumber: number;
    questionAttemptId: string; slot: number; state: string; response: string | null;
    fraction: number | null; mark: number | null; maxMark: number;
  }[]> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.grade);
    const submitted = (await this.repo.listAttempts(quiz.id, QUIZ_PIN_ATTEMPTS_LIMIT)).filter((a) => !a.preview && a.state !== 'inprogress');
    const rows: {
      attemptId: string; userId: string; displayName: string; attemptNumber: number;
      questionAttemptId: string; slot: number; state: string; response: string | null;
      fraction: number | null; mark: number | null; maxMark: number;
    }[] = [];
    const nameById = new Map<string, string>();
    for (const u of await this.users.getUsersByIds(submitted.map((a) => a.userId))) {
      const full = `${u.firstName} ${u.lastName}`.trim();
      nameById.set(u.id, full || u.username);
    }
    const queueUsages = await this.questions.getUsages(submitted.map((r) => r.usageId));
    for (const r of submitted) {
      const usage = queueUsages.get(r.usageId);
      if (!usage) continue;
      const qa = usage.attempts.find((a) => a.questionId === questionId);
      if (!qa) continue;
      const lastResponse = [...qa.steps].reverse().find((s) => s.data.answer !== undefined)?.data.answer ?? null;
      rows.push({
        attemptId: r.id, userId: r.userId, displayName: nameById.get(r.userId) ?? r.userId,
        attemptNumber: r.attemptNumber, questionAttemptId: qa.id, slot: qa.slot,
        state: qa.state, response: lastResponse,
        fraction: qa.fraction ?? null,
        mark: qa.fraction !== null && qa.fraction !== undefined ? qa.fraction * qa.maxMark : null,
        maxMark: qa.maxMark,
      });
    }
    return rows.sort((x, y) => x.attemptNumber - y.attemptNumber || x.slot - y.slot);
  }

  async gradeQuestionForAttempts(actorId: string, pinId: string, input: {
    questionId: string;
    grades: { attemptId: string; mark: number; comment?: string }[];
  }): Promise<QuizAttemptSummary[]> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.grade);
    const out: QuizAttemptSummary[] = [];
    for (const entry of input.grades) {
      const row = await this.shared.getAttemptRow(entry.attemptId);
      if (row.pinId !== quiz.id) {
        throw new BadRequestException({ message: `Attempt ${entry.attemptId} does not belong to this quiz`, code: 'quiz.attempt_quiz_mismatch' });
      }
      const usage = await this.questions.getUsage(row.usageId);
      const qa = usage.attempts.find((a) => a.questionId === input.questionId);
      if (!qa) {
        throw new BadRequestException({ message: `Attempt ${entry.attemptId} does not contain question ${input.questionId}`, code: 'quiz.question_not_in_attempt' });
      }
      const view = await this.manualGrade(actorId, entry.attemptId, {
        questionAttemptId: qa.id, mark: entry.mark, comment: entry.comment,
      });
      out.push(view.attempt);
    }
    return out;
  }

  async listAttemptSummaries(actorId: string, pinId: string): Promise<QuizAttemptSummary[]> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireAnyViewCap(actorId, quiz);
    const canSeeAll = await this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.viewReports);
    if (canSeeAll) {
      const rows = (await this.repo.listAttempts(quiz.id, QUIZ_PIN_ATTEMPTS_LIMIT)).filter((a) => !a.preview);
      return this.shared.attemptSummaries(quiz, rows);
    }
    const isStaffViewer = (await this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.grade))
      || (await this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.manage));
    const rows = await this.repo.listAttemptsForUser(quiz.id, actorId, true);
    const rawSummaries = await this.shared.attemptSummaries(quiz, rows);
    const out: QuizAttemptSummary[] = [];
    for (const [index, r] of rows.entries()) {
      const summary = rawSummaries[index]!;
      out.push(!isStaffViewer && !r.preview
        ? await this.maskOwnerTotals(quiz, summary, await this.ownerMarksVisible(quiz, r, new Date()))
        : summary);
    }
    return out;
  }
}
