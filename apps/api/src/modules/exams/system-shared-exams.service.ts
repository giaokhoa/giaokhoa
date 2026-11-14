import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { systemBankPackageSchema, systemExamPackageSchema, type CreateExamPin, type RichTextInput, type SystemExamPackage } from '@giaokhoa/contracts';
import type { ExamQuestionSnapshot } from '@giaokhoa/db';
import { ExamsRepository } from '@giaokhoa/db/repositories/exams';
import { SystemExamsRepository, type SystemExamVersionRow } from '@giaokhoa/db/repositories/system-exams';
import { SystemBankCentreRepository } from '@giaokhoa/db/repositories/system-bank-centre';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CoursesService } from '../courses/courses.service';
import { QuestionBanksService } from '../questions/question-banks.service';
import { QuestionsService, type QuestionContentInput } from '../questions/questions.service';
import { ExamQuestionSnapshotsService } from '../quiz/exam-question-snapshots.service';
import { QuizService } from '../quiz/quiz.service';
import { SystemBankMediaService } from '../system-bank/system-bank-media.service';
import { canonicalizeJson, checksumPackage, packageValidationError } from '../system-bank/system-bank-package';
import { tenantAls } from '../tenants/tenant-als';
import { ExamsService } from './exams.service';

@Injectable()
export class SystemSharedExamsService {
  constructor(
    private readonly config: ConfigService,
    private readonly repo: SystemExamsRepository,
    private readonly centreRepo: SystemBankCentreRepository,
    private readonly examsRepo: ExamsRepository,
    private readonly exams: ExamsService,
    private readonly snapshots: ExamQuestionSnapshotsService,
    private readonly media: SystemBankMediaService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly courses: CoursesService,
    private readonly banks: QuestionBanksService,
    private readonly questions: QuestionsService,
    private readonly quiz: QuizService,
  ) {}

  private async centreManager(actorId: string): Promise<{ tenantId: string; centreSlug: string }> {
    const tenantId = tenantAls.getStore()?.tenantId;
    if (!tenantId) throw new ForbiddenException({ code: 'system_exam.centre_required' });
    const context = await this.contexts.getTenantContext(tenantId);
    if (!context) throw new ForbiddenException({ code: 'system_exam.centre_required' });
    await this.evaluator.requireCapability(actorId, 'tenant:manage', context.id);
    const centreSlug = tenantAls.getStore()?.spaceSlug ?? await this.centreRepo.resolveTenantSlug(tenantId);
    if (!centreSlug) throw new ForbiddenException({ code: 'system_exam.centre_required' });
    return { tenantId, centreSlug };
  }

  private async reviewer(actorId: string): Promise<void> {
    const system = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, 'systembank:review', system.id);
  }

  private async deployer(actorId: string, courseId: string): Promise<void> {
    await this.courses.getCourse(courseId);
    const contextId = await this.courses.courseContextId(courseId);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', contextId);
    await this.evaluator.requireCapability(actorId, 'grade:manage', contextId);
  }

  private summary(row: SystemExamVersionRow) {
    const pkg = systemExamPackageSchema.parse(row.package);
    return {
      id: row.id,
      name: pkg.name,
      sourceExamId: row.sourceExamId,
      sourceVersionNumber: row.sourceVersionNumber,
      grade: pkg.grade,
      examKind: pkg.examKind,
      totalScore: pkg.totalScore,
      durationMinutes: pkg.durationMinutes,
      slotCount: pkg.slots.length,
      status: row.status,
      createdAt: row.createdAt,
      rejectionReason: row.rejectionReason,
    };
  }

  async submit(actorId: string, examId: string) {
    const { tenantId, centreSlug } = await this.centreManager(actorId);
    const paper = await this.examsRepo.getPaper(examId);
    if (!paper || paper.kind !== 'snapshot' || paper.tenantId !== tenantId) {
      throw new NotFoundException({ code: 'exam.not_found' });
    }
    const view = await this.exams.getPaper(actorId, examId);
    if (view.paper.status !== 'ready') throw new BadRequestException({ code: 'system_exam.source_not_ready' });
    const version = await this.examsRepo.getVersionByNumber(examId, view.version.version);
    if (!version) throw new NotFoundException({ code: 'exam.version_not_found' });
    const slots = await this.examsRepo.listSlots(version.id);
    if (!slots.length) throw new BadRequestException({ code: 'system_exam.empty' });
    const sources: SystemExamPackage['slots'] = [];
    for (const slot of slots) {
      const source = slot.sourceDomain === 'bank-system'
        ? await this.snapshots.readSystem(actorId, slot.questionId, slot.pinnedVersionNumber!)
        : await this.snapshots.readLocal(actorId, slot.questionId, slot.pinnedVersionId!);
      if (source.versionId !== slot.pinnedVersionId || source.versionNumber !== slot.pinnedVersionNumber ||
        (slot.sourceSnapshot && slot.sourceSnapshot.checksum !== source.checksum)) {
        throw new ConflictException({ code: 'system_exam.source_changed' });
      }
      let pkg = source.package;
      if (source.sourceDomain === 'centre') {
        const question = await this.questions.getQuestion(slot.questionId);
        const category = await this.questions.getCategory(question.question.category);
        if (!category.bankId) throw new NotFoundException({ code: 'question.not_found' });
        const bank = await this.banks.getBankOrThrow(category.bankId);
        if (bank.tenantId !== tenantId) throw new NotFoundException({ code: 'question.not_found' });
        const links = await this.questions.getCurriculumLinks(slot.questionId);
        pkg = systemBankPackageSchema.parse({
          ...pkg,
          outcomes: links.outcomes.map((outcome) => ({
            outcomeId: outcome.outcomeId,
            cognitiveLevel: outcome.cognitiveLevel,
          })),
        });
        pkg = await this.media.snapshot(pkg, category.contextId);
      }
      if (packageValidationError(source.qtype, pkg)) {
        throw new BadRequestException({ code: 'system_exam.bad_question' });
      }
      sources.push({
        position: slot.position,
        section: slot.section,
        questionId: slot.questionId,
        versionId: source.versionId,
        versionNumber: source.versionNumber,
        qtype: source.qtype as SystemExamPackage['slots'][number]['qtype'],
        maxMark: slot.maxMark,
        checksum: checksumPackage(pkg),
        package: pkg,
      });
    }
    const pkg = systemExamPackageSchema.parse({
      name: view.version.name,
      grade: view.version.grade,
      examKind: view.version.examKind,
      totalScore: view.version.totalScore,
      durationMinutes: view.version.durationMinutes,
      tfScale: view.version.tfScale,
      source: { centreSlug, examId, versionId: version.id, versionNumber: version.version },
      slots: sources,
    });
    let row;
    try {
      row = await this.repo.submit({
        centreSlug, sourceExamId: examId, sourceVersionId: version.id, sourceVersionNumber: version.version,
        package: pkg, checksum: checksumPackage(pkg), submittedBy: actorId,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'system_exam.source_withdrawn') {
        throw new ConflictException({ code: 'system_exam.source_withdrawn' });
      }
      throw error;
    }
    if (row.status === 'rejected') throw new ConflictException({ code: 'system_exam.rejected_source_version' });
    if (row.status === 'withdrawn') throw new ConflictException({ code: 'system_exam.source_withdrawn' });
    return this.summary(row);
  }

  async listMine(actorId: string) {
    const { centreSlug } = await this.centreManager(actorId);
    return (await this.repo.listMine(centreSlug)).map((row) => this.summary(row));
  }

  async listPublished(actorId: string, courseId: string) {
    await this.deployer(actorId, courseId);
    return (await this.repo.listPublished()).map((row) => this.summary(row));
  }

  async listUsed(actorId: string) {
    const tenantId = tenantAls.getStore()?.tenantId;
    if (!tenantId) throw new ForbiddenException({ code: 'system_exam.centre_required' });
    const permitted = await this.evaluator.hasCapabilityFromRealAssignmentAnywhere(actorId, 'exam:use');
    const manager = await this.contexts.getTenantContext(tenantId);
    const manages = manager ? await this.evaluator.hasCapability(actorId, 'tenant:manage', manager.id) : false;
    if (!permitted && !manages) throw new ForbiddenException({ code: 'access.capability_denied' });
    const ids = await this.centreRepo.listSharedExamVersionIds();
    const rows = await Promise.all(ids.map((id) => this.repo.get(id)));
    return rows.filter((row): row is SystemExamVersionRow => row !== null).map((row) => this.summary(row));
  }

  async listApprovedForReview(actorId: string) {
    await this.reviewer(actorId);
    return (await this.repo.listPublished()).map((row) => this.summary(row));
  }

  async listPending(actorId: string) {
    await this.reviewer(actorId);
    return (await this.repo.listPending()).map((row) => this.summary(row));
  }

  async getReview(actorId: string, id: string) {
    await this.reviewer(actorId);
    const row = await this.repo.get(id);
    if (!row) throw new NotFoundException({ code: 'system_exam.not_found' });
    return row;
  }

  async reviewMedia(actorId: string, id: string, hash: string) {
    const row = await this.getReview(actorId, id);
    const pkg = systemExamPackageSchema.parse(row.package);
    const slot = pkg.slots.find((s) => s.package.media?.some((m) => m.contentHash === hash));
    if (!slot) throw new NotFoundException({ code: 'system_exam.media_not_found' });
    return this.media.readPreview(slot.package, hash);
  }

  private validate(row: SystemExamVersionRow): SystemExamPackage {
    const pkg = systemExamPackageSchema.parse(row.package);
    if (checksumPackage(pkg) !== row.checksum ||
      pkg.source.centreSlug !== row.centreSlug || pkg.source.examId !== row.sourceExamId ||
      pkg.source.versionId !== row.sourceVersionId || pkg.source.versionNumber !== row.sourceVersionNumber) {
      throw new BadRequestException({ code: 'system_exam.checksum_mismatch' });
    }
    const positions = new Set<number>();
    for (const slot of pkg.slots) {
      if (positions.has(slot.position) || slot.position > pkg.slots.length ||
        checksumPackage(slot.package) !== slot.checksum ||
        packageValidationError(slot.qtype, slot.package)) {
        throw new BadRequestException({ code: 'system_exam.bad_package' });
      }
      positions.add(slot.position);
    }
    return pkg;
  }

  async approve(actorId: string, id: string) {
    const row = await this.getReview(actorId, id);
    if (row.status === 'approved') return this.summary(row);
    if (row.status !== 'pending') throw new ConflictException({ code: 'system_exam.already_reviewed' });
    const pkg = this.validate(row);
    for (const slot of pkg.slots) {
      for (const file of slot.package.media ?? []) {
        await this.media.readPreview(slot.package, file.contentHash);
      }
    }
    let updated;
    try {
      updated = await this.repo.review(id, actorId, 'approved');
    } catch (error) {
      if (error instanceof Error && error.message === 'system_exam.source_withdrawn') {
        throw new ConflictException({ code: 'system_exam.source_withdrawn' });
      }
      throw error;
    }
    if (!updated || updated.status !== 'approved') throw new ConflictException({ code: 'system_exam.already_reviewed' });
    return this.summary(updated);
  }

  async fork(actorId: string, id: string) {
    const tenantId = tenantAls.getStore()?.tenantId;
    if (!tenantId) throw new ForbiddenException({ code: 'system_exam.centre_required' });
    const row = await this.repo.get(id);
    if (!row || (row.status !== 'approved' &&
      !(row.status === 'withdrawn' && await this.centreRepo.hasSharedExamVersion(id)))) {
      throw new NotFoundException({ code: 'system_exam.not_published' });
    }
    const pkg = this.validate(row);
    const examBank = await this.banks.ensurePersonalBank(actorId, 'exam', { forCopy: true });
    await this.exams.getExamBank(actorId, examBank.id);
    await this.evaluator.requireCapability(actorId, 'exam:add', examBank.contextId);
    if (examBank.tenantId !== tenantId) throw new ForbiddenException({ code: 'system_exam.centre_required' });
    const questionBank = await this.banks.ensurePersonalBank(actorId, 'question', { forCopy: true });
    const category = await this.banks.defaultCategoryOfBank(questionBank);
    await this.evaluator.requireCapability(actorId, 'question:add', category.contextId);
    const prepared: Array<{
      position: number; section: string; maxMark: number; qtype: string;
      stimulusContent: RichTextInput | null;
      content: QuestionContentInput;
    }> = [];
    for (const slot of pkg.slots) {
      const local = await this.media.materialize(slot.package, category.contextId, actorId);
      const options = local.options ? { ...local.options } : undefined;
      if (options) {
        for (const key of ['correctFeedback', 'incorrectFeedback', 'graderInfo', 'responseTemplate']) {
          if (options[key] === null) delete options[key];
        }
      }
      prepared.push({
        position: slot.position, section: slot.section, maxMark: slot.maxMark,
        qtype: slot.qtype, stimulusContent: local.stimulusContent as RichTextInput | null,
        content: {
          questionText: local.questionText as RichTextInput,
          generalFeedback: (local.generalFeedback ?? undefined) as RichTextInput | undefined,
          guidance: (local.answerKey?.guidance ?? undefined) as RichTextInput | undefined,
          answers: local.answers.map((answer) => ({
            text: answer.answer as RichTextInput, correct: answer.isCorrect,
            feedback: (answer.feedback ?? undefined) as RichTextInput | undefined,
          })),
          options: options as QuestionContentInput['options'],
          solution: local.answerKey?.solution
            ? local.answerKey.solution as QuestionContentInput['solution'] : undefined,
        },
      });
    }
    return this.questions.createQuestionCopies(
      actorId, category.id,
      prepared.map(({ qtype, stimulusContent, content }) => ({ qtype, stimulusContent, content })),
      async (tx, copies) => {
        const paper = await this.examsRepo.insertPaper({
          tenantId, bankId: examBank.id, kind: 'snapshot', status: 'draft',
          createdBy: actorId, systemExamForkVersionId: id, latestVersion: 1,
          derivedFromVersionNumber: row.sourceVersionNumber,
        }, tx);
        const version = await this.examsRepo.insertVersion({
          examId: paper.id, version: 1, name: pkg.name, grade: pkg.grade, examKind: pkg.examKind,
          totalScore: pkg.totalScore, durationMinutes: pkg.durationMinutes, tfScale: pkg.tfScale,
          createdBy: actorId,
        }, tx);
        await this.examsRepo.insertSlots(copies.map((copy, index) => ({
          examVersionId: version.id, position: prepared[index]!.position, section: prepared[index]!.section,
          questionId: copy.questionId, pinnedVersionId: copy.versionId,
          pinnedVersionNumber: 1, maxMark: prepared[index]!.maxMark, sourceDomain: 'centre',
        })), tx);
        return { paperId: paper.id, versionId: version.id, sourceExamVersionId: id, questionIds: copies.map((copy) => copy.questionId) };
      },
    );
  }

  async withdraw(actorId: string, id: string, reason: string) {
    await this.reviewer(actorId);
    const row = await this.repo.withdrawSource(id, reason);
    if (!row) throw new ConflictException({ code: 'system_exam.not_published' });
    return this.summary(row);
  }

  async reject(actorId: string, id: string, reason: string) {
    const row = await this.getReview(actorId, id);
    if (row.status !== 'pending') throw new ConflictException({ code: 'system_exam.already_reviewed' });
    const updated = await this.repo.review(id, actorId, 'rejected', reason);
    if (!updated || updated.status !== 'rejected') throw new ConflictException({ code: 'system_exam.already_reviewed' });
    return this.summary(updated);
  }

  private requestChecksum(courseId: string, input: CreateExamPin): string {
    const timestamp = (value: string | null | undefined): string | null => {
      if (!value) return null;
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime())) throw new BadRequestException({ code: 'quiz.bad_window' });
      return parsed.toISOString();
    };
    const normalized = {
      courseId,
      sharedExamVersionId: input.sharedExamVersionId,
      sectionId: input.sectionId,
      name: input.name ?? null,
      intro: input.intro ?? '',
      timeOpen: timestamp(input.timeOpen),
      timeClose: timestamp(input.timeClose),
      timeLimitSeconds: input.timeLimitSeconds ?? null,
      attemptsAllowed: input.attemptsAllowed ?? null,
      gradeMethod: input.gradeMethod ?? 'highest',
      shuffleAnswers: input.shuffleAnswers ?? null,
      password: input.password ?? null,
      subnet: input.subnet ?? null,
      reviewAttempt: input.reviewAttempt ?? null,
      reviewCorrectness: input.reviewCorrectness ?? null,
      reviewMarks: input.reviewMarks ?? null,
      reviewSpecificFeedback: input.reviewSpecificFeedback ?? null,
      reviewGeneralFeedback: input.reviewGeneralFeedback ?? null,
      reviewRightAnswer: input.reviewRightAnswer ?? null,
      reviewOverallFeedback: input.reviewOverallFeedback ?? null,
      preset: input.preset ?? null,
      lateEntryMinutes: input.lateEntryMinutes ?? null,
      monitorEvents: input.monitorEvents ?? null,
      variantCount: input.variantCount ?? 1,
      targetGroupId: input.targetGroupId ?? null,
      versionMode: input.versionMode ?? 'pinned',
    };
    const key = createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update('giaokhoa:system-shared-exam-pin-idempotency:v1').digest();
    return createHmac('sha256', key).update(canonicalizeJson(normalized)).digest('hex');
  }

  async assign(actorId: string, courseId: string, input: CreateExamPin) {
    if (!input.sharedExamVersionId || !input.requestId) {
      throw new BadRequestException({ code: 'exam.pin_request_id_required' });
    }
    if (input.examId || input.examVersionId || input.newExam || input.versionMode === 'float_latest_ready') {
      throw new BadRequestException({ code: 'system_exam.pin_source_conflict' });
    }
    await this.deployer(actorId, courseId);
    return this.quiz.withPinRequestLock(courseId, actorId, input.requestId,
      () => this.assignLocked(actorId, courseId, input));
  }

  private async assignLocked(actorId: string, courseId: string, input: CreateExamPin) {
    const requestId = input.requestId!;
    const sharedId = input.sharedExamVersionId!;
    const requestChecksum = this.requestChecksum(courseId, input);
    const previous = await this.examsRepo.findPaperByPinRequest(actorId, courseId, requestId);
    if (previous && (previous.kind !== 'system_execution' ||
      previous.sharedExamVersionId !== sharedId || previous.sharedRequestedSectionId !== input.sectionId ||
      previous.sharedRequestChecksum !== requestChecksum)) {
      throw new ConflictException({ code: 'exam.pin_request_conflict' });
    }
    const priorPin = await this.quiz.getPinRequestRecord(courseId, actorId, requestId);
    if (priorPin && (!previous || priorPin.examId !== previous.id || priorPin.requestedSectionId !== input.sectionId)) {
      throw new ConflictException({ code: 'exam.pin_request_conflict' });
    }
    if (previous) {
      const resumed = await this.quiz.getPinByRequest(courseId, actorId, requestId, input.sectionId);
      if (resumed) return resumed;
    }

    let paper = previous;
    if (!paper) {
      const row = await this.repo.get(sharedId);
      if (!row || (row.status !== 'approved' &&
        !(row.status === 'withdrawn' && await this.centreRepo.hasSharedExamVersion(sharedId)))) {
        throw new NotFoundException({ code: 'system_exam.not_published' });
      }
      const pkg = this.validate(row);
      const tenantId = tenantAls.getStore()?.tenantId;
      if (!tenantId) throw new ForbiddenException({ code: 'system_exam.centre_required' });
      const bank = await this.banks.ensurePersonalBank(actorId, 'exam');
      if (bank.tenantId !== tenantId) throw new ForbiddenException({ code: 'system_exam.centre_required' });
      await this.examsRepo.transaction(async (tx) => {
        paper = await this.examsRepo.insertPaper({
          tenantId, bankId: bank.id, kind: 'system_execution', status: 'ready', createdBy: actorId,
          pinRequestId: requestId, pinRequestCourseId: courseId,
          sharedExamVersionId: sharedId, sharedSourceExamId: row.sourceExamId,
          sharedSourceVersionNumber: row.sourceVersionNumber, sharedRequestedSectionId: input.sectionId,
          sharedRequestChecksum: requestChecksum,
        }, tx);
        const version = await this.examsRepo.insertVersion({
          examId: paper.id, version: 1, name: pkg.name, grade: pkg.grade, examKind: pkg.examKind,
          totalScore: pkg.totalScore, durationMinutes: pkg.durationMinutes, tfScale: pkg.tfScale,
          createdBy: actorId,
        }, tx);
        await this.examsRepo.insertSlots(pkg.slots.map((slot) => {
          const snapshot: ExamQuestionSnapshot = {
            sourceDomain: 'bank-system', questionId: slot.questionId, versionId: slot.versionId,
            versionNumber: slot.versionNumber, qtype: slot.qtype, defaultMark: 1,
            checksum: slot.checksum, package: slot.package,
            answerIds: slot.package.answers.map(() => randomUUID()),
          };
          return {
            examVersionId: version.id, position: slot.position, section: slot.section,
            questionId: slot.questionId, pinnedVersionId: slot.versionId,
            pinnedVersionNumber: slot.versionNumber, maxMark: slot.maxMark,
            sourceDomain: 'bank-system', sourceSnapshot: snapshot,
          };
        }), tx);
      });
    }
    const version = await this.examsRepo.getVersionByNumber(paper!.id, 1);
    if (!version) throw new ConflictException({ code: 'system_exam.incomplete_execution' });
    return this.quiz.createPinRecord(actorId, courseId, {
      requestId, sectionId: input.sectionId, examId: paper!.id, examVersionId: version.id,
      name: input.name, intro: input.intro, timeOpen: input.timeOpen, timeClose: input.timeClose,
      timeLimitSeconds: input.timeLimitSeconds, attemptsAllowed: input.attemptsAllowed,
      gradeMethod: input.gradeMethod, shuffleAnswers: input.shuffleAnswers, password: input.password,
      subnet: input.subnet, reviewAttempt: input.reviewAttempt, reviewCorrectness: input.reviewCorrectness,
      reviewMarks: input.reviewMarks, reviewSpecificFeedback: input.reviewSpecificFeedback,
      reviewGeneralFeedback: input.reviewGeneralFeedback, reviewRightAnswer: input.reviewRightAnswer,
      reviewOverallFeedback: input.reviewOverallFeedback, preset: input.preset,
      lateEntryMinutes: input.lateEntryMinutes, monitorEvents: input.monitorEvents,
      variantCount: input.variantCount, targetGroupId: input.targetGroupId ?? null, versionMode: 'pinned',
    });
  }
}
