import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type {
  PinRegradeLogEntry,
  PinRegradeResult,
  PinVersionUpdatePreview,
  PinVersionUpdateSlotDiff,
  ExamPinOverrideView,
  QuizView,
} from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { CoursesService } from '../courses/courses.service';
import { GradesService } from '../grades/grades.service';
import { GroupsService } from '../groups/groups.service';
import { FilesService } from '../files/files.service';
import { QuestionsService, type UsageView } from '../questions/questions.service';
import { PasswordService } from '../users/password.service';
import { UsersService } from '../users/users.service';
import type { CreateExamPinOverrideDto, UpdateExamPinOverrideDto } from './dto/quiz.dto';
import { EXAM_KIND_PRESETS, type ExamKind } from './domain/matrix';
import { isValidSubnetList } from './domain/subnet';
import {
  QUIZ_PIN_ATTEMPTS_LIMIT,
  QuizRepository,
  type ExamAttemptRow,
  type ExamPinFeedbackRow,
  type ExamPinOverrideRow,
  type ExamPinRow,
} from '@giaokhoa/db/repositories/quiz';
import { ExamQuestionSnapshotsService } from './exam-question-snapshots.service';
import { QuizSharedService } from './quiz-shared.service';
import { QuizAttemptsService } from './quiz-attempts.service';
import { QUIZ_COMPONENT } from './quiz-shared.service';
import { QUIZ_CAPABILITIES } from './quiz-shared.service';
import type { PinRow } from './quiz.service';


export class QuizPinsService {
  constructor(
    private readonly snapshots: ExamQuestionSnapshotsService,
    private readonly files: FilesService,
    private readonly repo: QuizRepository,
    private readonly courses: CoursesService,
    private readonly evaluator: PermissionEvaluator,
    private readonly questions: QuestionsService,
    private readonly grades: GradesService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly groups: GroupsService,
    private readonly outbox: OutboxService,
    private readonly shared: QuizSharedService,
    private readonly attempts: QuizAttemptsService,
  ) {}

  async assertPinUnlocked(pin: PinRow): Promise<void> {
    const attempts = await this.repo.listAttempts(pin.id, QUIZ_PIN_ATTEMPTS_LIMIT);
    if (attempts.some((a) => !a.preview)) {
      throw new BadRequestException({ message: 'This pin already has real attempts; its pinned exam version is locked', code: 'exam.pin_locked' });
    }
  }

  private sumWithFraction(usage: UsageView, questionAttemptId: string, fraction: number | null): number {
    let sum = 0;
    for (const a of usage.attempts) {
      if (a.state === 'needsgrading') continue;
      const f = a.id === questionAttemptId ? fraction : a.fraction;
      if (f !== null && f !== undefined) sum += f * a.maxMark;
    }
    return sum;
  }


  private assertValidSubnet(subnet: string | null | undefined): void {
    if (subnet !== undefined && subnet !== null && !isValidSubnetList(subnet)) {
      throw new BadRequestException({ message: 'Subnet must be a comma-separated list of IPs or CIDR ranges', code: 'quiz.subnet_invalid' });
    }
  }

  private async hashQuizPassword(password: string | null | undefined): Promise<string | null> {
    if (password === undefined || password === null) return null;
    return this.passwords.hash(password);
  }

  private async assertTargetGroup(courseId: string, targetGroupId: string | null | undefined): Promise<void> {
    if (targetGroupId === undefined || targetGroupId === null) return;
    const group = await this.groups.getGroup(targetGroupId).catch(() => null);
    if (!group || group.courseId !== courseId) {
      throw new BadRequestException({ message: 'Target group does not belong to this course', code: 'exam.pin_target_group_invalid' });
    }
  }

  private assertVersionModeAllowed(preset: string | null | undefined, versionMode: string | null | undefined): void {
    if (versionMode === 'float_latest_ready' && preset !== 'regular') {
      throw new BadRequestException({
        message: 'float_latest_ready is only allowed for practice pins (preset regular); official exam pins (periodic/mock or no preset) must stay pinned',
        code: 'exam.version_mode_not_allowed',
      });
    }
  }

  async createPinRecord(actorId: string, courseId: string, input: {
    requestId?: string;
    sectionId: string; examId: string; examVersionId: string;
    name?: string; intro?: string;
    timeOpen?: string | null; timeClose?: string | null; timeLimitSeconds?: number | null;
    attemptsAllowed?: number; gradeMethod?: string; shuffleAnswers?: boolean;
    password?: string | null; subnet?: string | null;
    reviewAttempt?: number; reviewCorrectness?: number; reviewMarks?: number;
    reviewSpecificFeedback?: number; reviewGeneralFeedback?: number;
    reviewRightAnswer?: number; reviewOverallFeedback?: number;
    preset?: ExamKind | null; lateEntryMinutes?: number | null; monitorEvents?: boolean;
    variantCount?: number; targetGroupId?: string | null;
    versionMode?: 'pinned' | 'float_latest_ready';
  }): Promise<QuizView> {
    await this.courses.getCourse(courseId);
    const courseContextId = await this.courses.courseContextId(courseId);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', courseContextId);
    await this.evaluator.requireCapability(actorId, 'grade:manage', courseContextId);
    const section = await this.courses.getSection(input.sectionId);
    if (section.course !== courseId) throw new BadRequestException({ code: 'course.section_course_mismatch' });
    await this.assertTargetGroup(courseId, input.targetGroupId);
    const version = await this.repo.getExamVersion(input.examVersionId);
    if (!version || version.examId !== input.examId) {
      throw new NotFoundException({ message: `Exam version ${input.examVersionId} not found for exam ${input.examId}`, code: 'exam.version_not_found' });
    }
    const timeOpen = input.timeOpen ? new Date(input.timeOpen) : null;
    const timeClose = input.timeClose ? new Date(input.timeClose) : null;
    if (timeOpen && timeClose && timeClose <= timeOpen) {
      throw new BadRequestException({ message: 'timeClose must be after timeOpen', code: 'quiz.bad_window' });
    }
    this.assertValidSubnet(input.subnet);
    this.assertVersionModeAllowed(input.preset ?? null, input.versionMode ?? 'pinned');
    const preset = input.preset ? EXAM_KIND_PRESETS[input.preset] : null;
    const variantCount = input.variantCount ?? 1;
    const slots = await this.repo.listExamSlots(version.id);
    if (slots.some((s) => s.sourceDomain === 'bank-system') && !input.requestId) {
      throw new BadRequestException({ code: 'exam.pin_request_id_required' });
    }
    if (slots.some((s) => s.sourceDomain === 'bank-system') && input.versionMode === 'float_latest_ready') {
      throw new BadRequestException({ code: 'exam.shared_requires_pinned' });
    }
    const pin = await this.repo.insertPin({
      questionSnapshots: null, requestId: input.requestId, requestedSectionId: input.sectionId,
      preparationState: 'preparing',
      examId: input.examId, examVersionId: input.examVersionId, courseId, cmId: null,
      name: input.name ?? null, intro: input.intro ?? '',
      timeOpen, timeClose, timeLimit: input.timeLimitSeconds ?? null,
      attemptsAllowed: input.attemptsAllowed ?? preset?.attemptsAllowed ?? 0,
      gradeMethod: input.gradeMethod ?? 'highest',
      shuffleAnswers: input.shuffleAnswers ?? preset?.shuffleAnswers ?? false,
      passwordHash: await this.hashQuizPassword(input.password),
      subnet: input.subnet ?? null,
      preset: input.preset ?? null,
      versionMode: input.versionMode ?? 'pinned',
      lateEntryMinutes: input.lateEntryMinutes !== undefined ? input.lateEntryMinutes : (preset?.lateEntryMinutes ?? null),
      monitorEvents: input.monitorEvents ?? preset?.monitorEvents ?? false,
      variantCount,
      variants: this.makeVariants(`${input.examId}:${input.examVersionId}:${courseId}:${Date.now()}`, variantCount),
      targetGroupId: input.targetGroupId ?? null,
      resultsPublishedAt: null,
      createdBy: actorId,
      ...(input.reviewAttempt !== undefined ? { reviewAttempt: input.reviewAttempt } : {}),
      ...(input.reviewCorrectness !== undefined ? { reviewCorrectness: input.reviewCorrectness } : (preset ? { reviewCorrectness: preset.reviewCorrectness } : {})),
      ...(input.reviewMarks !== undefined ? { reviewMarks: input.reviewMarks } : (preset ? { reviewMarks: preset.reviewMarks } : {})),
      ...(input.reviewSpecificFeedback !== undefined ? { reviewSpecificFeedback: input.reviewSpecificFeedback } : (preset ? { reviewSpecificFeedback: preset.reviewSpecificFeedback } : {})),
      ...(input.reviewGeneralFeedback !== undefined ? { reviewGeneralFeedback: input.reviewGeneralFeedback } : (preset ? { reviewGeneralFeedback: preset.reviewGeneralFeedback } : {})),
      ...(input.reviewRightAnswer !== undefined ? { reviewRightAnswer: input.reviewRightAnswer } : (preset ? { reviewRightAnswer: preset.reviewRightAnswer } : {})),
      ...(input.reviewOverallFeedback !== undefined ? { reviewOverallFeedback: input.reviewOverallFeedback } : (preset ? { reviewOverallFeedback: preset.reviewOverallFeedback } : {})),
    });
    return this.resumePinRecord(actorId, courseId, pin, input.sectionId, true);
  }

  async resumePinRecord(actorId: string, courseId: string, pin: ExamPinRow, sectionId: string, newlyInserted = false): Promise<QuizView> {
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courses.courseContextId(courseId));
    await this.evaluator.requireCapability(actorId, 'grade:manage', await this.courses.courseContextId(courseId));
    const section = await this.courses.getSection(sectionId);
    if (section.course !== courseId || pin.courseId !== courseId || pin.createdBy !== actorId
      || (pin.requestedSectionId !== null && pin.requestedSectionId !== sectionId)) {
      throw new ConflictException({ code: 'exam.pin_request_conflict' });
    }
    const version = await this.repo.getExamVersion(pin.examVersionId);
    if (!version) throw new NotFoundException({ code: 'exam.version_not_found' });
    const name = pin.name ?? version.name;
    let cm = (await this.courses.listCms(courseId))
      .find((item) => item.component === QUIZ_COMPONENT && item.instanceId === pin.id);
    if (cm && cm.section !== sectionId) throw new ConflictException({ code: 'exam.pin_request_conflict' });
    try {
      const slots = await this.repo.listExamSlots(pin.examVersionId);
      if (!pin.questionSnapshots && slots.some((slot) => slot.sourceDomain === 'bank-system')) {
        await this.files.cleanupExamSnapshotFiles(pin.id);
        const exam = await this.repo.getExam(pin.examId);
        const snapshots = await this.snapshots.prepare(actorId, slots,
          await this.courses.courseContextId(courseId), pin.versionMode, pin.id,
          exam?.kind === 'system_execution');
        if (!snapshots) throw new BadRequestException({ code: 'exam.snapshot_missing' });
        await this.repo.updatePin(pin.id, { questionSnapshots: snapshots });
      }

      if (!cm) {
        cm = await this.courses.createCm(actorId, courseId, {
          sectionId, component: QUIZ_COMPONENT, instanceId: pin.id, name,
          completion: 2, completionUseGrade: true,
        });
      }
      if (pin.cmId !== cm.id) await this.repo.updatePin(pin.id, { cmId: cm.id });
      const grade = await this.grades.getItemForCm(courseId, cm.id);
      if (!grade) await this.grades.createItem(actorId, courseId, {
        itemName: name, itemType: 'mod', cmId: cm.id, gradeMax: version.totalScore,
      });
      await this.repo.updatePin(pin.id, { preparationState: 'ready' });
    } catch (error) {
      if (newlyInserted) {
        try {
          const createdCm = (await this.courses.listCms(courseId))
            .find((item) => item.component === QUIZ_COMPONENT && item.instanceId === pin.id);
          if (createdCm) {
            const createdGrade = await this.grades.getItemForCm(courseId, createdCm.id);
            if (createdGrade) await this.grades.deleteItem(actorId, createdGrade.id);
            await this.courses.deleteCm(actorId, createdCm.id);
          }
          await this.files.cleanupExamSnapshotFiles(pin.id);
          await this.repo.deletePin(pin.id);
        } catch {
        }
      }
      throw error;
    }
    await this.outbox.enqueueStandalone({
      aggregate: 'exam_pin', type: 'exam_pinned',
      payload: { examId: pin.examId, examVersionId: pin.examVersionId, pinId: pin.id, courseId, actorId },
    });
    return this.shared.pinView(await this.shared.getPin(pin.id));
  }

  private makeVariants(seedSource: string, count: number): { code: string; seed: number }[] {
    let h = 2166136261;
    for (const ch of seedSource) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return Array.from({ length: count }, (_, i) => ({
      code: String(i + 1).padStart(3, '0'),
      seed: (h + i * 2654435761) % 2147483647,
    }));
  }

  private async cleanupPendingSnapshot(pin: PinRow): Promise<void> {
    if (!pin.pendingSnapshotId) return;
    await this.files.cleanupExamSnapshotFiles(pin.pendingSnapshotId);
    await this.repo.updatePin(pin.id, { pendingSnapshotId: null });
  }

  private async prepareVersionAndApply(
    actorId: string, pin: PinRow, versionId: string, mode: string,
    apply: (snapshots: Awaited<ReturnType<ExamQuestionSnapshotsService['prepare']>>) => Promise<void>,
  ): Promise<void> {
    await this.cleanupPendingSnapshot(pin);
    const slots = await this.repo.listExamSlots(versionId);
    if (!slots.some((slot) => slot.sourceDomain === 'bank-system')) {
      await apply(null);
      return;
    }
    const stageId = randomUUID();
    await this.repo.updatePin(pin.id, { pendingSnapshotId: stageId });
    try {
      const exam = await this.repo.getExam(pin.examId);
      const snapshots = await this.snapshots.prepare(actorId, slots,
        await this.courses.courseContextId(pin.course), mode, stageId,
        exam?.kind === 'system_execution');
      await apply(snapshots);
    } catch (error) {
      try {
        await this.files.cleanupExamSnapshotFiles(stageId);
        await this.repo.updatePin(pin.id, { pendingSnapshotId: null });
      } catch {   }
      throw error;
    }
  }

  async updatePin(actorId: string, pinId: string, input: {
    name?: string; intro?: string;
    timeOpen?: string | null; timeClose?: string | null; timeLimitSeconds?: number | null;
    attemptsAllowed?: number; gradeMethod?: string; shuffleAnswers?: boolean;
    password?: string | null; subnet?: string | null;
    reviewAttempt?: number; reviewCorrectness?: number; reviewMarks?: number;
    reviewSpecificFeedback?: number; reviewGeneralFeedback?: number;
    reviewRightAnswer?: number; reviewOverallFeedback?: number;
    preset?: ExamKind | null; lateEntryMinutes?: number | null; monitorEvents?: boolean;
    examVersionId?: string; variantCount?: number; targetGroupId?: string | null;
    versionMode?: 'pinned' | 'float_latest_ready';
  }): Promise<QuizView> {
    return this.repo.withPinRequestLock(pinId, 'version', 'mutation',
      () => this.updatePinLocked(actorId, pinId, input));
  }

  private async updatePinLocked(actorId: string, pinId: string, input: {
    name?: string; intro?: string;
    timeOpen?: string | null; timeClose?: string | null; timeLimitSeconds?: number | null;
    attemptsAllowed?: number; gradeMethod?: string; shuffleAnswers?: boolean;
    password?: string | null; subnet?: string | null;
    reviewAttempt?: number; reviewCorrectness?: number; reviewMarks?: number;
    reviewSpecificFeedback?: number; reviewGeneralFeedback?: number;
    reviewRightAnswer?: number; reviewOverallFeedback?: number;
    preset?: ExamKind | null; lateEntryMinutes?: number | null; monitorEvents?: boolean;
    examVersionId?: string; variantCount?: number; targetGroupId?: string | null;
    versionMode?: 'pinned' | 'float_latest_ready';
  }): Promise<QuizView> {
    const pin = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, pin, QUIZ_CAPABILITIES.manage);
    await this.cleanupPendingSnapshot(pin);
    this.assertValidSubnet(input.subnet);
    this.assertVersionModeAllowed(
      input.preset !== undefined ? input.preset : pin.preset,
      input.versionMode !== undefined ? input.versionMode : pin.versionMode,
    );
    const patch: Partial<ExamPinRow> = {};
    if (input.versionMode !== undefined) patch.versionMode = input.versionMode;
    if (input.name !== undefined) patch.name = input.name;
    if (input.intro !== undefined) patch.intro = input.intro;
    if (input.timeOpen !== undefined) patch.timeOpen = input.timeOpen ? new Date(input.timeOpen) : null;
    if (input.timeClose !== undefined) patch.timeClose = input.timeClose ? new Date(input.timeClose) : null;
    if (input.timeLimitSeconds !== undefined) patch.timeLimit = input.timeLimitSeconds;
    if (input.attemptsAllowed !== undefined) patch.attemptsAllowed = input.attemptsAllowed;
    if (input.gradeMethod !== undefined) patch.gradeMethod = input.gradeMethod;
    if (input.shuffleAnswers !== undefined) patch.shuffleAnswers = input.shuffleAnswers;
    if (input.password !== undefined) patch.passwordHash = await this.hashQuizPassword(input.password);
    if (input.subnet !== undefined) patch.subnet = input.subnet;
    if (input.reviewAttempt !== undefined) patch.reviewAttempt = input.reviewAttempt;
    if (input.reviewCorrectness !== undefined) patch.reviewCorrectness = input.reviewCorrectness;
    if (input.reviewMarks !== undefined) patch.reviewMarks = input.reviewMarks;
    if (input.reviewSpecificFeedback !== undefined) patch.reviewSpecificFeedback = input.reviewSpecificFeedback;
    if (input.reviewGeneralFeedback !== undefined) patch.reviewGeneralFeedback = input.reviewGeneralFeedback;
    if (input.reviewRightAnswer !== undefined) patch.reviewRightAnswer = input.reviewRightAnswer;
    if (input.reviewOverallFeedback !== undefined) patch.reviewOverallFeedback = input.reviewOverallFeedback;
    if (input.preset !== undefined) patch.preset = input.preset;
    if (input.lateEntryMinutes !== undefined) patch.lateEntryMinutes = input.lateEntryMinutes;
    if (input.targetGroupId !== undefined) {
      await this.assertTargetGroup(pin.course, input.targetGroupId);
      patch.targetGroupId = input.targetGroupId;
    }
    if (input.monitorEvents !== undefined) patch.monitorEvents = input.monitorEvents;
    let newVersion: Awaited<ReturnType<QuizRepository['getExamVersion']>> | undefined;
    if (input.examVersionId !== undefined && input.examVersionId !== pin.examVersionId) {
      await this.assertPinUnlocked(pin);
      const v = await this.repo.getExamVersion(input.examVersionId);
      if (!v || v.examId !== pin.examId) {
        throw new NotFoundException({ message: `Exam version ${input.examVersionId} not found for exam ${pin.examId}`, code: 'exam.version_not_found' });
      }
      newVersion = v;
      patch.examVersionId = input.examVersionId;
    }
    if (input.variantCount !== undefined && input.variantCount !== pin.variantCount) {
      await this.assertPinUnlocked(pin);
      patch.variantCount = input.variantCount;
      patch.variants = this.makeVariants(`${pin.examId}:${patch.examVersionId ?? pin.examVersionId}:${pin.courseId}:${Date.now()}`, input.variantCount);
    }
    const nextOpen = patch.timeOpen !== undefined ? patch.timeOpen : pin.timeOpen;
    const nextClose = patch.timeClose !== undefined ? patch.timeClose : pin.timeClose;
    if (nextOpen && nextClose && nextClose <= nextOpen) {
      throw new BadRequestException({ message: 'timeClose must be after timeOpen', code: 'quiz.bad_window' });
    }
    const targetHasShared = newVersion
      ? (await this.repo.listExamSlots(newVersion.id)).some((slot) => slot.sourceDomain === 'bank-system')
      : (pin.questionSnapshots ?? []).some((snapshot) => snapshot.sourceDomain === 'bank-system');
    if ((patch.versionMode ?? pin.versionMode) === 'float_latest_ready' && targetHasShared) {
      throw new BadRequestException({ code: 'exam.shared_requires_pinned' });
    }
    if (newVersion) {
      await this.prepareVersionAndApply(actorId, pin, newVersion.id, patch.versionMode ?? pin.versionMode, async (snapshots) => {
        await this.repo.updatePin(pin.id, { ...patch, questionSnapshots: snapshots, pendingSnapshotId: null });
      });
    } else if (Object.keys(patch).length) await this.repo.updatePin(pin.id, patch);
    const updated = await this.shared.getPin(pin.id);
    if (updated.cmId && input.name !== undefined) {
      await this.courses.updateCm(actorId, updated.cmId, { name: updated.name });
    }
    if (updated.cmId && (newVersion || input.name !== undefined)) {
      const item = await this.grades.getItemForCm(updated.course, updated.cmId);
      if (item) {
        await this.grades.updateItem(actorId, item.id, {
          ...(newVersion ? { gradeMax: newVersion.totalScore } : {}),
          ...(input.name !== undefined ? { itemName: updated.name } : {}),
        });
      }
    }
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'quiz_updated', payload: { pinId: pin.id, courseId: pin.course, actorId } });
    return this.shared.pinView(updated);
  }

  async deletePin(actorId: string, pinId: string): Promise<void> {
    const pin = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, pin, QUIZ_CAPABILITIES.manage);
    const attempts = await this.repo.listAttempts(pin.id, QUIZ_PIN_ATTEMPTS_LIMIT);
    for (const a of attempts) await this.questions.deleteUsage(a.usageId);
    if (pin.cmId) {
      const item = await this.grades.getItemForCm(pin.course, pin.cmId).catch(() => undefined);
      if (item) await this.grades.deleteItem(actorId, item.id).catch(() => undefined);
    }
    await this.repo.deletePin(pin.id);
    if (pin.cmId) await this.courses.deleteCm(actorId, pin.cmId);
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'quiz_deleted', payload: { pinId: pin.id, courseId: pin.course, actorId } });
  }


  private async pinHasRealAttempts(pinId: string): Promise<boolean> {
    const attempts = await this.repo.listAttempts(pinId, QUIZ_PIN_ATTEMPTS_LIMIT);
    return attempts.some((a) => !a.preview);
  }

  private async diffExamVersionSlots(fromVersionId: string, toVersionId: string): Promise<PinVersionUpdateSlotDiff[]> {
    const [fromSlots, toSlots] = await Promise.all([
      this.repo.listExamSlots(fromVersionId),
      this.repo.listExamSlots(toVersionId),
    ]);
    const fromByPos = new Map(fromSlots.map((s) => [s.position, s]));
    const toByPos = new Map(toSlots.map((s) => [s.position, s]));
    const positions = [...new Set([...fromByPos.keys(), ...toByPos.keys()])].sort((a, b) => a - b);
    return positions.map((position) => {
      const from = fromByPos.get(position);
      const to = toByPos.get(position);
      const change: PinVersionUpdateSlotDiff['change'] = !from
        ? 'added'
        : !to
          ? 'removed'
          : from.questionId !== to.questionId
            ? 'question_changed'
            : from.pinnedVersionNumber !== to.pinnedVersionNumber
              ? 'question_version_changed'
              : from.maxMark !== to.maxMark
                ? 'mark_changed'
                : 'unchanged';
      return {
        position, change,
        fromQuestionId: from?.questionId ?? null,
        toQuestionId: to?.questionId ?? null,
        fromPinnedVersionNumber: from?.pinnedVersionNumber ?? null,
        toPinnedVersionNumber: to?.pinnedVersionNumber ?? null,
        fromMaxMark: from?.maxMark ?? null,
        toMaxMark: to?.maxMark ?? null,
      };
    });
  }

  async getPinVersionUpdatePreview(actorId: string, pinId: string): Promise<PinVersionUpdatePreview> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.manage);
    const versions = await this.repo.listExamVersions(quiz.examId);
    const target = versions.find((v) => v.version === quiz.examLatestVersion);
    const available = quiz.examStatus === 'ready' && !!target && target.id !== quiz.examVersionId;
    return {
      pinId: quiz.id,
      fromExamVersionId: quiz.examVersionId,
      fromVersionNumber: quiz.examVersionNumber,
      toExamVersionId: available ? target!.id : null,
      toVersionNumber: available ? target!.version : null,
      examStatus: quiz.examStatus,
      available,
      blockedByAttempts: await this.pinHasRealAttempts(quiz.id),
      slotDiffs: available ? await this.diffExamVersionSlots(quiz.examVersionId, target!.id) : [],
    };
  }

  async applyPinVersionUpdate(actorId: string, pinId: string, toExamVersionId: string): Promise<QuizView> {
    return this.repo.withPinRequestLock(pinId, 'version', 'mutation',
      () => this.applyPinVersionUpdateLocked(actorId, pinId, toExamVersionId));
  }

  private async applyPinVersionUpdateLocked(actorId: string, pinId: string, toExamVersionId: string): Promise<QuizView> {
    const pin = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, pin, QUIZ_CAPABILITIES.manage);
    await this.assertPinUnlocked(pin);
    if (pin.examStatus !== 'ready') {
      throw new BadRequestException({
        message: `Exam ${pin.examId} is not ready (status ${pin.examStatus}); there is no ready version to update this pin to`,
        code: 'exam.version_not_ready',
      });
    }
    const target = await this.repo.getExamVersion(toExamVersionId);
    if (!target || target.examId !== pin.examId) {
      throw new NotFoundException({ message: `Exam version ${toExamVersionId} not found for exam ${pin.examId}`, code: 'exam.version_not_found' });
    }
    if (target.id === pin.examVersionId) {
      throw new BadRequestException({ message: 'This pin already uses the requested exam version', code: 'exam.pin_version_unchanged' });
    }
    if (target.version !== pin.examLatestVersion) {
      throw new BadRequestException({
        message: `Exam version ${toExamVersionId} is not the latest version of exam ${pin.examId}; pins only update to the latest ready version`,
        code: 'exam.version_not_latest',
      });
    }
    await this.prepareVersionAndApply(actorId, pin, target.id, pin.versionMode, async (questionSnapshots) => {
      await this.repo.transaction(async (tx) => {
        await this.repo.updatePin(pin.id, { examVersionId: target.id, questionSnapshots, pendingSnapshotId: null }, tx);
        await this.repo.insertPinVersionUpdate({
          pinId: pin.id, actorId, fromExamVersionId: pin.examVersionId, toExamVersionId: target.id,
        }, tx);
      });
    });
    const updated = await this.shared.getPin(pin.id);
    if (updated.cmId) {
      const item = await this.grades.getItemForCm(updated.course, updated.cmId);
      if (item) await this.grades.updateItem(actorId, item.id, { gradeMax: target.totalScore });
    }
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'exam_pin_version_updated',
      payload: { pinId: pin.id, courseId: pin.course, fromExamVersionId: pin.examVersionId, toExamVersionId: target.id, actorId },
    });
    return this.shared.pinView(updated);
  }

  async regradePinQuestion(actorId: string, pinId: string, input: { questionId: string; toVersionId: string; dryRun: boolean }): Promise<PinRegradeResult> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.grade);
    const questionView = await this.questions.getQuestion(input.questionId);
    if (questionView.question.qtype === 'essay') {
      throw new BadRequestException({
        message: 'Essay questions are graded manually and cannot be regraded against an answer key',
        code: 'question.regrade_not_supported',
      });
    }
    const { version: targetVersion } = await this.questions.getVersionContent(input.questionId, input.toVersionId);
    if (targetVersion.status !== 'ready') {
      throw new BadRequestException({
        message: `Question version ${input.toVersionId} is not ready (status ${targetVersion.status}); regrading needs the corrected ready version`,
        code: 'question.regrade_version_not_ready',
      });
    }
    type Candidate = {
      attempt: ExamAttemptRow;
      qa: UsageView['attempts'][number];
      oldFraction: number | null; newFraction: number | null;
      oldSumGrades: number; newSumGrades: number; changed: boolean;
    };
    const candidates: Candidate[] = [];
    const submitted = (await this.repo.listAttempts(quiz.id, QUIZ_PIN_ATTEMPTS_LIMIT))
      .filter((a) => !a.preview && (a.state === 'finished' || a.state === 'needsgrading'));
    for (const attempt of submitted) {
      const usage = await this.questions.getUsage(attempt.usageId);
      const qa = usage.attempts.find((x) => x.questionId === input.questionId);
      if (!qa || qa.questionVersionId === input.toVersionId) continue;
      if (!['gradedright', 'gradedpartial', 'gradedwrong', 'gaveup'].includes(qa.state)) continue;
      const preview = await this.questions.previewRegradeAttempt(qa.id, input.toVersionId, quiz.tfScale);
      const oldSumGrades = this.shared.syncFromUsage(usage).sumGrades;
      candidates.push({
        attempt, qa,
        oldFraction: qa.fraction, newFraction: preview.newFraction,
        oldSumGrades,
        newSumGrades: this.sumWithFraction(usage, qa.id, preview.newFraction),
        changed: preview.newFraction !== qa.fraction,
      });
    }
    const changes = candidates.map((c) => ({
      examAttemptId: c.attempt.id,
      userId: c.attempt.userId,
      attemptNumber: c.attempt.attemptNumber,
      questionAttemptId: c.qa.id,
      oldFraction: c.oldFraction,
      newFraction: c.newFraction,
      oldSumGrades: c.oldSumGrades,
      newSumGrades: c.newSumGrades,
      changed: c.changed,
    }));
    const result: PinRegradeResult = {
      dryRun: input.dryRun,
      pinId: quiz.id,
      questionId: input.questionId,
      fromVersionIds: [...new Set(candidates.map((c) => c.qa.questionVersionId).filter((v): v is string => v !== null))],
      toVersionId: input.toVersionId,
      changes,
    };
    if (input.dryRun || candidates.length === 0) return result;
    const byFromVersion = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const key = c.qa.questionVersionId!;
      byFromVersion.set(key, [...(byFromVersion.get(key) ?? []), c]);
    }
    let changedCount = 0;
    for (const [fromVersionId, group] of byFromVersion) {
      const regrade = await this.repo.insertRegrade({
        pinId: quiz.id, questionId: input.questionId, fromVersionId, toVersionId: input.toVersionId, actorId,
      });
      for (const c of group) {
        await this.questions.regradeAttemptWithVersion(actorId, c.qa.id, input.toVersionId, quiz.tfScale);
        const afterUsage = await this.questions.getUsage(c.attempt.usageId);
        const { sumGrades, pendingManual } = this.shared.syncFromUsage(afterUsage);
        const nextState = pendingManual > 0 ? 'needsgrading' : 'finished';
        await this.repo.updateAttempt(c.attempt.id, { sumGrades, state: nextState });
        if (c.changed) {
          changedCount += 1;
          await this.repo.insertRegradeItem({
            regradeId: regrade.id, examAttemptId: c.attempt.id, questionAttemptId: c.qa.id,
            userId: c.attempt.userId, oldFraction: c.oldFraction, newFraction: c.newFraction,
            oldSumGrades: c.oldSumGrades, newSumGrades: sumGrades,
          });
        }
        const updated = await this.shared.getAttemptRow(c.attempt.id);
        if (updated.state === 'finished') await this.attempts.pushGrade(quiz, c.attempt.userId);
      }
    }
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'exam_attempt_answer_key_regraded',
      payload: {
        pinId: quiz.id, courseId: quiz.course, questionId: input.questionId,
        toVersionId: input.toVersionId, actorId,
        candidateCount: candidates.length, changedCount,
      },
    });
    return result;
  }

  async listPinRegrades(actorId: string, pinId: string): Promise<PinRegradeLogEntry[]> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.viewReports);
    const attempts = await this.repo.listAttempts(quiz.id, QUIZ_PIN_ATTEMPTS_LIMIT);
    const numberByAttempt = new Map(attempts.map((a) => [a.id, a.attemptNumber]));
    const out: PinRegradeLogEntry[] = [];
    for (const r of await this.repo.listRegrades(quiz.id)) {
      const items = await this.repo.listRegradeItems(r.id);
      out.push({
        id: r.id, pinId: r.pinId, questionId: r.questionId,
        fromVersionId: r.fromVersionId, toVersionId: r.toVersionId,
        actorId: r.actorId, createdAt: r.createdAt.toISOString(),
        items: items.map((i) => ({
          examAttemptId: i.examAttemptId, userId: i.userId,
          attemptNumber: numberByAttempt.get(i.examAttemptId) ?? 0,
          oldFraction: i.oldFraction, newFraction: i.newFraction,
          oldSumGrades: i.oldSumGrades, newSumGrades: i.newSumGrades,
        })),
      });
    }
    return out;
  }

  async listMyPinRegrades(actorId: string, pinId: string): Promise<PinRegradeLogEntry[]> {
    const quiz = await this.shared.getPin(pinId);
    if (!quiz.resultsPublishedAt && !(await this.shared.hasCap(actorId, quiz, QUIZ_CAPABILITIES.viewReports))) {
      return [];
    }
    const rows = await this.repo.listRegradeItemsForUser(quiz.id, actorId);
    const attempts = await this.repo.listAttemptsForUser(quiz.id, actorId, true);
    const numberByAttempt = new Map(attempts.map((a) => [a.id, a.attemptNumber]));
    const byRegrade = new Map<string, PinRegradeLogEntry>();
    for (const { regrade, item } of rows) {
      let entry = byRegrade.get(regrade.id);
      if (!entry) {
        entry = {
          id: regrade.id, pinId: regrade.pinId, questionId: regrade.questionId,
          fromVersionId: regrade.fromVersionId, toVersionId: regrade.toVersionId,
          actorId: regrade.actorId, createdAt: regrade.createdAt.toISOString(),
          items: [],
        };
        byRegrade.set(regrade.id, entry);
      }
      entry.items.push({
        examAttemptId: item.examAttemptId, userId: item.userId,
        attemptNumber: numberByAttempt.get(item.examAttemptId) ?? 0,
        oldFraction: item.oldFraction, newFraction: item.newFraction,
        oldSumGrades: item.oldSumGrades, newSumGrades: item.newSumGrades,
      });
    }
    return [...byRegrade.values()];
  }

  async listPins(actorId: string, courseId: string): Promise<QuizView[]> {
    await this.courses.assertCourseAccess(actorId, courseId);
    const rows = await this.repo.listPinsInCourse(courseId);
    const canManage = await this.evaluator.hasCapability(actorId, QUIZ_CAPABILITIES.manage, await this.courses.courseContextId(courseId));
    const myGroupIds = canManage ? null : new Set((await this.groups.groupsOfUser(courseId, actorId)).map((g) => g.id));
    const out: QuizView[] = [];
    for (const r of rows) {
      if (myGroupIds && r.targetGroupId && !myGroupIds.has(r.targetGroupId)) continue;
      out.push(await this.shared.pinView(await this.shared.enrichPin(r)));
    }
    return out;
  }

  private async overrideView(row: ExamPinOverrideRow): Promise<ExamPinOverrideView> {
    let groupName: string | null = null;
    let userName: string | null = null;
    if (row.groupId) {
      const group = await this.groups.getGroup(row.groupId).catch(() => undefined);
      groupName = group?.name ?? null;
    }
    if (row.userId) {
      const [user] = await this.users.getUsersByIds([row.userId]);
      if (user) userName = `${user.firstName} ${user.lastName}`.trim() || user.username;
    }
    return {
      id: row.id, pinId: row.pinId,
      groupId: row.groupId, groupName,
      userId: row.userId, userName,
      timeOpen: row.timeOpen?.toISOString() ?? null,
      timeClose: row.timeClose?.toISOString() ?? null,
      timeLimitSeconds: row.timeLimit,
      attempts: row.attempts,
      hasPassword: row.passwordHash !== null,
      reason: row.reason,
    };
  }

  private async getOverrideRow(quiz: PinRow, overrideId: string): Promise<ExamPinOverrideRow> {
    const row = await this.repo.getOverride(overrideId);
    if (!row || row.pinId !== quiz.id) {
      throw new NotFoundException({ message: `Quiz override ${overrideId} not found`, code: 'quiz.override_not_found' });
    }
    return row;
  }


  async publishResults(actorId: string, pinId: string): Promise<QuizView> {
    const pin = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, pin, QUIZ_CAPABILITIES.manage);
    await this.repo.updatePin(pin.id, { resultsPublishedAt: new Date() });
    return this.shared.pinView(await this.shared.getPin(pin.id));
  }

  async unpublishResults(actorId: string, pinId: string): Promise<QuizView> {
    const pin = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, pin, QUIZ_CAPABILITIES.manage);
    await this.repo.updatePin(pin.id, { resultsPublishedAt: null });
    return this.shared.pinView(await this.shared.getPin(pin.id));
  }

  async updatePinOverride(actorId: string, overrideId: string, dto: UpdateExamPinOverrideDto): Promise<ExamPinOverrideView> {
    const row = await this.repo.getOverride(overrideId);
    if (!row) throw new NotFoundException({ message: `Exam pin override ${overrideId} not found`, code: 'quiz.override_not_found' });
    return this.updateOverride(actorId, row.pinId, overrideId, dto);
  }

  async deletePinOverride(actorId: string, overrideId: string): Promise<void> {
    const row = await this.repo.getOverride(overrideId);
    if (!row) throw new NotFoundException({ message: `Exam pin override ${overrideId} not found`, code: 'quiz.override_not_found' });
    await this.deleteOverride(actorId, row.pinId, overrideId);
  }

  async deletePinFeedback(actorId: string, feedbackId: string): Promise<void> {
    const row = await this.repo.getFeedback(feedbackId);
    if (!row) throw new NotFoundException({ message: `Exam pin feedback ${feedbackId} not found`, code: 'quiz.feedback_not_found' });
    await this.deleteFeedback(actorId, row.pinId, feedbackId);
  }

  async listOverrides(actorId: string, pinId: string): Promise<ExamPinOverrideView[]> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.manageOverrides);
    const rows = await this.repo.listOverrides(quiz.id);
    const out: ExamPinOverrideView[] = [];
    for (const r of rows) out.push(await this.overrideView(r));
    return out;
  }

  async createOverride(actorId: string, pinId: string, input: CreateExamPinOverrideDto): Promise<ExamPinOverrideView> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.manageOverrides);
    if (!!input.groupId === !!input.userId) {
      throw new BadRequestException({ message: 'An override needs exactly one target: groupId or userId', code: 'quiz.override_target' });
    }
    const timeOpen = input.timeOpen ? new Date(input.timeOpen) : null;
    const timeClose = input.timeClose ? new Date(input.timeClose) : null;
    if (timeOpen && timeClose && timeClose <= timeOpen) {
      throw new BadRequestException({ message: 'timeClose must be after timeOpen', code: 'quiz.bad_window' });
    }
    if (input.groupId) {
      const group = await this.groups.getGroup(input.groupId);
      if (group.courseId !== quiz.course) {
        throw new BadRequestException({ message: 'Group does not belong to the course of this quiz', code: 'quiz.override_group_mismatch' });
      }
    }
    if (input.userId) {
      await this.users.getUser(input.userId);
      await this.courses.assertCourseAccess(input.userId, quiz.course);
    }
    const existing = await this.repo.listOverrides(quiz.id);
    if (existing.some((o) => o.groupId === (input.groupId ?? null) && o.userId === (input.userId ?? null))) {
      throw new BadRequestException({ message: 'An override already exists for this target', code: 'quiz.override_exists' });
    }
    if (input.userId && (input.timeLimitSeconds != null || input.timeOpen != null) && !input.reason) {
      throw new BadRequestException({ message: 'A reason is required for a user override that extends time or opens a separate window', code: 'quiz.override_reason_required' });
    }
    const row = await this.repo.insertOverride({
      pinId: quiz.id,
      groupId: input.groupId ?? null,
      userId: input.userId ?? null,
      timeOpen, timeClose,
      timeLimit: input.timeLimitSeconds ?? null,
      attempts: input.attempts ?? null,
      passwordHash: await this.hashQuizPassword(input.password),
      reason: input.reason ?? null,
    });
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'quiz_override_created', payload: { pinId: quiz.id, courseId: quiz.course, overrideId: row.id, actorId } });
    return this.overrideView(row);
  }

  async updateOverride(actorId: string, pinId: string, overrideId: string, input: UpdateExamPinOverrideDto): Promise<ExamPinOverrideView> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.manageOverrides);
    const row = await this.getOverrideRow(quiz, overrideId);
    const patch: Partial<ExamPinOverrideRow> = {};
    if (input.timeOpen !== undefined) patch.timeOpen = input.timeOpen ? new Date(input.timeOpen) : null;
    if (input.timeClose !== undefined) patch.timeClose = input.timeClose ? new Date(input.timeClose) : null;
    if (input.timeLimitSeconds !== undefined) patch.timeLimit = input.timeLimitSeconds;
    if (input.attempts !== undefined) patch.attempts = input.attempts;
    if (input.password !== undefined) patch.passwordHash = await this.hashQuizPassword(input.password);
    if (input.reason !== undefined) patch.reason = input.reason;
    const nextOpen = patch.timeOpen !== undefined ? patch.timeOpen : row.timeOpen;
    const nextClose = patch.timeClose !== undefined ? patch.timeClose : row.timeClose;
    if (nextOpen && nextClose && nextClose <= nextOpen) {
      throw new BadRequestException({ message: 'timeClose must be after timeOpen', code: 'quiz.bad_window' });
    }
    const nextTimeLimit = patch.timeLimit !== undefined ? patch.timeLimit : row.timeLimit;
    const nextReason = patch.reason !== undefined ? patch.reason : row.reason;
    if (row.userId && (nextTimeLimit != null || nextOpen != null) && !nextReason) {
      throw new BadRequestException({ message: 'A reason is required for a user override that extends time or opens a separate window', code: 'quiz.override_reason_required' });
    }
    if (Object.keys(patch).length) await this.repo.updateOverride(row.id, patch);
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'quiz_override_updated', payload: { pinId: quiz.id, courseId: quiz.course, overrideId: row.id, actorId } });
    return this.overrideView(await this.getOverrideRow(quiz, overrideId));
  }

  async deleteOverride(actorId: string, pinId: string, overrideId: string): Promise<void> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.manageOverrides);
    const row = await this.getOverrideRow(quiz, overrideId);
    await this.repo.deleteOverride(row.id);
    await this.outbox.enqueueStandalone({ aggregate: 'quiz', type: 'quiz_override_deleted', payload: { pinId: quiz.id, courseId: quiz.course, overrideId: row.id, actorId } });
  }


  async getPinSummary(pinId: string): Promise<{ id: string; name: string; examId: string | null; matrixId: string | null } | null> {
    const row = await this.repo.getPin(pinId);
    if (!row) return null;
    const quiz = await this.shared.enrichPin(row);
    return { id: quiz.id, name: quiz.name, examId: quiz.examId, matrixId: quiz.matrixId };
  }

  async listFeedbacks(actorId: string, pinId: string): Promise<ExamPinFeedbackRow[]> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.manage);
    return this.repo.listFeedbacks(quiz.id);
  }

  async createFeedback(actorId: string, pinId: string, input: { minPercent: number; maxPercent: number; feedback: string }): Promise<ExamPinFeedbackRow> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.manage);
    if (!(input.minPercent < input.maxPercent)) {
      throw new BadRequestException({ message: 'minPercent must be below maxPercent', code: 'quiz.feedback_range' });
    }
    return this.repo.insertFeedback({ pinId: quiz.id, minPercent: input.minPercent, maxPercent: input.maxPercent, feedback: input.feedback });
  }

  async deleteFeedback(actorId: string, pinId: string, feedbackId: string): Promise<void> {
    const quiz = await this.shared.getPin(pinId);
    await this.shared.requireCap(actorId, quiz, QUIZ_CAPABILITIES.manage);
    const bands = await this.repo.listFeedbacks(quiz.id);
    if (!bands.some((b) => b.id === feedbackId)) {
      throw new NotFoundException({ message: `Quiz feedback ${feedbackId} not found`, code: 'quiz.feedback_not_found' });
    }
    await this.repo.deleteFeedback(feedbackId);
  }
}
