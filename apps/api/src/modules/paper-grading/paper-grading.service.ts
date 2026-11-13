import { randomUUID } from 'node:crypto';
import {
  BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import {
  PAPER_SCAN_STATUSES, type CreatePaperBatch, type PaperBatch, type PaperReading,
  type PaperRosterEntry, type PaperScan, type PaperScanStatus, type ResolvePaperReadings,
} from '@giaokhoa/contracts';
import { OutboxService } from '../../infra/events/outbox.service';
import { ContextsService } from '../access/contexts.service';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { EnrolService } from '../enrol/enrol.service';
import { FilesService } from '../files/files.service';
import { encodeTrueFalseResponse } from '../questions/domain/question-engine';
import { QuizService, type PinRow } from '../quiz/quiz.service';
import { SiteConfigService } from '../site-config/site-config.service';
import { UsersService } from '../users/users.service';
import { DEFAULT_OMR_THRESHOLDS, encodePng, processSheetImage, type OmrThresholds, type ProcessedSheet } from './domain/omr';
import {
  NAME_REGION, STUDENT_CODE_REGION, VARIANT_CODE_REGION,
  codeForIndex, computeSheetGeometry,
  type SheetGeometry,
} from './domain/sheet-layout';
import { generateSheetsPdf, parseSheetQr, type SheetPageStudent } from './domain/sheet-pdf';
import { PaperGradingRepository, type PaperBatchRow, type PaperScanRow } from '@giaokhoa/db/repositories/paper-grading';

export const PAPER_COMPONENT = 'mod_quiz';
const GRADE_PAPER_CAP = 'quiz:gradepaper';

export interface ScanUploadOutcome {
  fileName: string;
  stored: boolean;
  reasons?: string[];
  scan?: PaperScan;
}

@Injectable()
export class PaperGradingService {
  constructor(
    private readonly repo: PaperGradingRepository,
    private readonly quiz: QuizService,
    private readonly enrol: EnrolService,
    private readonly users: UsersService,
    private readonly files: FilesService,
    private readonly config: SiteConfigService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly outbox: OutboxService,
  ) {}


  private async cmContextId(quiz: PinRow): Promise<string> {
    if (quiz.cmId) {
      const ctx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.MODULE, quiz.cmId);
      if (ctx) return ctx.id;
    }
    const courseCtx = await this.contexts.getByLevelInstance(CONTEXT_LEVELS.COURSE, quiz.course);
    if (!courseCtx) throw new NotFoundException({ message: `No context for quiz ${quiz.id}`, code: 'quiz.context_missing' });
    return courseCtx.id;
  }

  private async requireGradePaper(actorId: string, quiz: PinRow): Promise<void> {
    await this.evaluator.requireCapability(actorId, GRADE_PAPER_CAP, await this.cmContextId(quiz));
  }

  private async getBatchRow(pinId: string, batchId: string): Promise<PaperBatchRow> {
    const row = await this.repo.getBatch(batchId);
    if (!row || row.examPinId !== pinId) {
      throw new NotFoundException({ message: `Paper batch ${batchId} not found`, code: 'paper.batch_not_found' });
    }
    return row;
  }

  private async getScanRow(scanId: string): Promise<PaperScanRow> {
    const row = await this.repo.getScan(scanId);
    if (!row) throw new NotFoundException({ message: `Paper scan ${scanId} not found`, code: 'paper.scan_not_found' });
    return row;
  }

  private sortedLayout(batch: PaperBatchRow) {
    return [...batch.layout].sort((a, b) => a.slot - b.slot);
  }

  private statusFor(studentId: string | null, readings: PaperReading[]): PaperScanStatus {
    if (!studentId) return 'needs_identity';
    if (readings.some((r) => r.state === 'ambiguous')) return 'needs_review';
    return 'ready';
  }

  private batchView(row: PaperBatchRow): PaperBatch {
    return {
      id: row.id, pinId: row.examPinId, variantCode: row.variantCode,
      examCode: row.examCode, codeDigits: row.codeDigits,
      layout: row.layout, roster: row.roster, createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private geometryOf(batch: PaperBatchRow): SheetGeometry {
    const layout = this.sortedLayout(batch);
    return computeSheetGeometry(layout.map((l) => l.optionCount), batch.codeDigits);
  }

  private candidatesFrom(rows: PaperScanRow[], self: PaperScanRow, batch: PaperBatchRow): PaperRosterEntry[] {
    const held = new Set(rows
      .filter((s) => s.batchId === batch.id && s.id !== self.id && s.studentId)
      .map((s) => s.studentId!));
    return batch.roster.filter((e) => !held.has(e.userId));
  }

  private scanView(row: PaperScanRow, batch: PaperBatchRow | null, candidates: PaperRosterEntry[]): PaperScan {
    const layout = batch ? this.sortedLayout(batch) : [];
    const geometry = batch ? this.geometryOf(batch) : null;
    const student = row.studentId && batch ? batch.roster.find((r) => r.userId === row.studentId) : undefined;
    return {
      id: row.id, pinId: row.examPinId, batchId: row.batchId, sessionId: row.sessionId,
      status: row.status as PaperScanStatus,
      studentId: row.studentId, studentName: student?.displayName ?? null,
      identitySource: row.identitySource as PaperScan['identitySource'],
      identityCode: row.identityCode,
      variantCodeRead: row.variantCodeRead,
      fileId: row.fileId, warpedFileId: row.warpedFileId,
      rows: geometry ? geometry.rows.map((g, i) => ({ slot: layout[i]!.slot, centers: g.centers })) : [],
      identityCandidates: candidates,
      regions: { name: NAME_REGION, studentCode: STUDENT_CODE_REGION, variantCode: VARIANT_CODE_REGION },
      quality: row.quality, readings: row.readings, attemptId: row.attemptId,
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async scanViewFull(row: PaperScanRow): Promise<PaperScan> {
    const batch = row.batchId ? (await this.repo.getBatch(row.batchId)) ?? null : null;
    if (!batch) return this.scanView(row, null, []);
    const rows = await this.repo.listScansForPin(row.examPinId);
    return this.scanView(row, batch, this.candidatesFrom(rows, row, batch));
  }

  private async omrThresholds(): Promise<OmrThresholds> {
    const [fillDensity, blankDensity, minMargin] = await Promise.all([
      this.config.getValue<number>('mod_quiz', 'omrfilldensity'),
      this.config.getValue<number>('mod_quiz', 'omrblankdensity'),
      this.config.getValue<number>('mod_quiz', 'omrminmargin'),
    ]);
    return {
      fillDensity: fillDensity ?? DEFAULT_OMR_THRESHOLDS.fillDensity,
      blankDensity: blankDensity ?? DEFAULT_OMR_THRESHOLDS.blankDensity,
      minMargin: minMargin ?? DEFAULT_OMR_THRESHOLDS.minMargin,
    };
  }


  async createBatch(actorId: string, pinId: string, input: CreatePaperBatch): Promise<PaperBatch> {
    const { quiz, layout } = await this.quiz.resolvePaperLayout(actorId, pinId);
    const existing = await this.repo.listBatchesForPin(pinId);
    let variantCode = input.variantCode?.trim().toUpperCase();
    if (variantCode) {
      if (existing.some((b) => b.variantCode === variantCode)) {
        throw new ConflictException({ message: `Variant ${variantCode} already exists for this quiz`, code: 'paper.variant_exists' });
      }
    } else {
      variantCode = this.nextVariantCode(existing.map((b) => b.variantCode));
    }
    const codeDigits = input.codeDigits ?? 4;
    let examCode = input.examCode ?? null;
    if (examCode) {
      if (existing.some((b) => b.examCode === examCode)) {
        throw new ConflictException({ message: `Exam code ${examCode} already exists for this quiz`, code: 'paper.exam_code_exists' });
      }
    } else {
      examCode = this.nextExamCode(existing.map((b) => b.examCode));
    }

    const cmCtx = await this.cmContextId(quiz);
    const enrolments = await this.enrol.listEnrolmentsForCourse(quiz.course);
    const now = new Date();
    const activeUserIds = [...new Set(enrolments
      .filter((e) => e.status === 0 && (!e.timeEnd || e.timeEnd > now))
      .map((e) => e.userId))];
    const users = await this.users.getUsersByIds(activeUserIds);
    const nameById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.username]));
    const students: { userId: string; displayName: string }[] = [];
    for (const userId of activeUserIds) {
      if (await this.evaluator.hasCapability(userId, 'quiz:attempt', cmCtx)) {
        students.push({ userId, displayName: nameById.get(userId) ?? userId });
      }
    }
    students.sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi') || a.userId.localeCompare(b.userId));
    if (students.length > 999) {
      throw new UnprocessableEntityException({ message: 'Paper roster supports at most 999 students per batch', code: 'paper.roster_too_large' });
    }
    const roster = students.map((s, i) => ({ code: codeForIndex(i, codeDigits), userId: s.userId, displayName: s.displayName }));

    const row = await this.repo.insertBatch({ examPinId: pinId, variantCode, examCode, codeDigits, layout, roster, createdBy: actorId });
    return this.batchView(row);
  }

  private nextVariantCode(used: string[]): string {
    const taken = new Set(used);
    for (let round = 0; ; round++) {
      for (let c = 0; c < 26; c++) {
        const candidate = String.fromCharCode(65 + c) + (round === 0 ? '' : String(round));
        if (!taken.has(candidate)) return candidate;
      }
    }
  }

  private nextExamCode(used: (string | null)[]): string {
    let max = 1000;
    for (const code of used) {
      if (code && /^\d{4}$/.test(code)) max = Math.max(max, Number(code));
    }
    if (max + 1 > 9999) {
      throw new UnprocessableEntityException({ message: 'Exam code space exhausted for this quiz', code: 'paper.exam_code_exhausted' });
    }
    return String(max + 1).padStart(4, '0');
  }

  async listBatches(actorId: string, pinId: string): Promise<PaperBatch[]> {
    const quiz = await this.quiz.getPin(pinId);
    await this.requireGradePaper(actorId, quiz);
    const rows = await this.repo.listBatchesForPin(pinId);
    return rows.map((r) => this.batchView(r));
  }

  async getBatch(actorId: string, batchId: string): Promise<PaperBatch> {
    const row = await this.repo.getBatch(batchId);
    if (!row) throw new NotFoundException({ message: `Paper batch ${batchId} not found`, code: 'paper.batch_not_found' });
    const quiz = await this.quiz.getPin(row.examPinId);
    await this.requireGradePaper(actorId, quiz);
    return this.batchView(row);
  }

  async sheetsPdf(actorId: string, batchId: string, opts: { studentId?: string; kind?: string; copies?: number }): Promise<{ buffer: Buffer; fileName: string }> {
    const batch = await this.repo.getBatch(batchId);
    if (!batch) throw new NotFoundException({ message: `Paper batch ${batchId} not found`, code: 'paper.batch_not_found' });
    const quiz = await this.quiz.getPin(batch.examPinId);
    await this.requireGradePaper(actorId, quiz);
    let pages: (SheetPageStudent | null)[];
    let suffix: string;
    if (opts.studentId) {
      const entry = batch.roster.find((r) => r.userId === opts.studentId);
      if (!entry) throw new NotFoundException({ message: 'Student is not in this batch roster', code: 'paper.student_not_in_batch' });
      pages = [entry];
      suffix = entry.code;
    } else if (opts.kind === 'personalized') {
      if (!batch.roster.length) {
        throw new BadRequestException({ message: 'Batch roster is empty; print shared sheets instead', code: 'paper.empty_roster' });
      }
      pages = batch.roster;
      suffix = 'ca-nhan';
    } else {
      const copies = Math.min(200, Math.max(1, opts.copies ?? Math.max(batch.roster.length, 1)));
      pages = Array.from({ length: copies }, () => null);
      suffix = 'dung-chung';
    }
    const buffer = await generateSheetsPdf({
      quizName: quiz.name, variantCode: batch.variantCode, examCode: batch.examCode,
      codeDigits: batch.codeDigits, batchId: batch.id,
      layout: this.sortedLayout(batch), pages,
    });
    return { buffer, fileName: `phieu-tra-loi-${batch.variantCode}-${suffix}.pdf` };
  }


  private resolveIdentity(
    processed: ProcessedSheet,
    batch: PaperBatchRow,
    claimed: Set<string>,
  ): { studentId: string | null; identitySource: 'qr' | 'bubbles' | null; identityCode: string | null } {
    const rosterByUserId = new Map(batch.roster.map((r) => [r.userId, r]));
    let studentId: string | null = null;
    let identitySource: 'qr' | 'bubbles' | null = null;
    let identityCode: string | null = processed.bubbleCode?.code ?? null;
    const qr = parseSheetQr(processed.qrText);
    if (qr && qr.batchId === batch.id && qr.userId && rosterByUserId.has(qr.userId)) {
      studentId = qr.userId;
      identitySource = 'qr';
      identityCode = rosterByUserId.get(qr.userId)!.code;
    } else if (processed.bubbleCode?.checksumOk) {
      const entry = batch.roster.find((r) => r.code === processed.bubbleCode!.code);
      if (entry) {
        studentId = entry.userId;
        identitySource = 'bubbles';
        identityCode = entry.code;
      }
    }
    if (studentId && claimed.has(studentId)) {
      return { studentId: null, identitySource: null, identityCode };
    }
    return { studentId, identitySource, identityCode };
  }

  private mapReadings(processed: ProcessedSheet, batch: PaperBatchRow): PaperReading[] {
    const layout = this.sortedLayout(batch);
    return processed.readings.map((r) => ({
      slot: layout[r.slot - 1]!.slot,
      densities: r.densities, chosen: r.chosen, state: r.state, margin: r.margin,
      resolvedBy: r.resolvedBy,
      ...(r.pairChoices ? { pairChoices: r.pairChoices } : {}),
    }));
  }

  private pairSlotsOf(batch: PaperBatchRow): Set<number> {
    const out = new Set<number>();
    this.sortedLayout(batch).forEach((entry, i) => {
      if (entry.qtype === 'truefalse') out.add(i + 1);
    });
    return out;
  }

  private async ingestOne(
    actorId: string,
    quiz: PinRow,
    opts: {
      anchor: PaperBatchRow | null;
      batches: PaperBatchRow[];
      sessionId: string;
      thresholds: OmrThresholds;
      expiresAt: Date;
      cmCtx: string;
      claimedByBatch: Map<string, Set<string>>;
      file: { originalname: string; buffer: Buffer; mimetype: string };
    },
  ): Promise<ScanUploadOutcome> {
    const fileName = (opts.file.originalname || 'scan').split(/[\\/]/).pop()!;
    const routingBatch = opts.anchor ?? opts.batches[0]!;
    let processed: ProcessedSheet;
    try {
      processed = processSheetImage(opts.file.buffer, this.geometryOf(routingBatch), opts.thresholds, this.pairSlotsOf(routingBatch));
    } catch {
      return { fileName, stored: false, reasons: ['unreadable_image'] };
    }
    if (!processed.qualityOk) {
      return { fileName, stored: false, reasons: processed.qualityReasons };
    }

    let variantCodeRead = processed.variantCode?.code ?? null;
    let target: PaperBatchRow | undefined;
    if (variantCodeRead) {
      target = opts.batches.find((b) => b.examCode === variantCodeRead);
    }
    if (!target) {
      const qr = parseSheetQr(processed.qrText);
      if (qr) target = opts.batches.find((b) => b.id === qr.batchId);
    }
    if (!target && opts.anchor) target = opts.anchor;

    if (target && target.id !== routingBatch.id) {
      try {
        processed = processSheetImage(opts.file.buffer, this.geometryOf(target), opts.thresholds, this.pairSlotsOf(target));
        variantCodeRead = processed.variantCode?.code ?? variantCodeRead;
      } catch {
        return { fileName, stored: false, reasons: ['unreadable_image'] };
      }
    }

    let studentId: string | null = null;
    let identitySource: 'qr' | 'bubbles' | null = null;
    let identityCode: string | null = null;
    let readings: PaperReading[] = [];
    if (target) {
      const claimed = opts.claimedByBatch.get(target.id) ?? new Set<string>();
      const identity = this.resolveIdentity(processed, target, claimed);
      studentId = identity.studentId;
      identitySource = identity.identitySource;
      identityCode = identity.identityCode;
      if (studentId) claimed.add(studentId);
      opts.claimedByBatch.set(target.id, claimed);
      readings = this.mapReadings(processed, target);
    }

    const itemId = target?.id ?? quiz.id;
    const original = await this.files.upload({
      contextId: opts.cmCtx, component: PAPER_COMPONENT, fileArea: 'paper_scans', itemId,
      fileName, data: opts.file.buffer, mimeType: opts.file.mimetype, userId: actorId,
    });
    const warped = await this.files.upload({
      contextId: opts.cmCtx, component: PAPER_COMPONENT, fileArea: 'paper_warped', itemId,
      fileName: `warped-${fileName.replace(/\.[^.]+$/, '')}.png`, data: encodePng(processed.warped),
      mimeType: 'image/png', userId: actorId,
    });
    const scan = await this.repo.insertScan({
      batchId: target?.id ?? null, sessionId: opts.sessionId, examPinId: quiz.id,
      fileId: original.id, warpedFileId: warped.id,
      studentId, identitySource, identityCode, variantCodeRead,
      status: this.statusFor(studentId, readings),
      quality: processed.quality, readings, uploadedBy: actorId, expiresAt: opts.expiresAt,
    });
    return { fileName, stored: true, scan: await this.scanViewFull(scan) };
  }

  private async ingestUpload(
    actorId: string,
    quiz: PinRow,
    anchor: PaperBatchRow | null,
    files: { originalname: string; buffer: Buffer; mimetype: string }[],
  ): Promise<ScanUploadOutcome[]> {
    if (!files.length) throw new BadRequestException({ message: 'No image files were uploaded', code: 'paper.no_files' });
    const batches = await this.repo.listBatchesForPin(quiz.id);
    if (!batches.length) {
      throw new BadRequestException({ message: 'Quiz has no paper batches yet', code: 'paper.no_batches' });
    }
    const thresholds = await this.omrThresholds();
    const retentionMonths = (await this.config.getValue<number>('mod_quiz', 'paperscanretentionmonths')) ?? 18;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + retentionMonths);
    const cmCtx = await this.cmContextId(quiz);
    const sessionId = randomUUID();
    const claimedByBatch = new Map<string, Set<string>>();
    for (const s of await this.repo.listScansForPin(quiz.id)) {
      if (s.batchId && s.studentId) {
        const set = claimedByBatch.get(s.batchId) ?? new Set<string>();
        set.add(s.studentId);
        claimedByBatch.set(s.batchId, set);
      }
    }
    const outcomes: ScanUploadOutcome[] = [];
    for (const file of files) {
      outcomes.push(await this.ingestOne(actorId, quiz, {
        anchor, batches, sessionId, thresholds, expiresAt, cmCtx, claimedByBatch, file,
      }));
    }
    if (outcomes.length && outcomes.every((o) => !o.stored)) {
      const reasons = [...new Set(outcomes.flatMap((o) => o.reasons ?? []))];
      throw new UnprocessableEntityException({
        message: `All uploaded images were rejected by the quality gate: ${reasons.join(', ')}`,
        code: 'paper.all_images_rejected',
      });
    }
    return outcomes;
  }

  async uploadScans(actorId: string, batchId: string, files: { originalname: string; buffer: Buffer; mimetype: string }[]): Promise<ScanUploadOutcome[]> {
    const anchor = await this.repo.getBatch(batchId);
    if (!anchor) throw new NotFoundException({ message: `Paper batch ${batchId} not found`, code: 'paper.batch_not_found' });
    const quiz = await this.quiz.getPin(anchor.examPinId);
    await this.requireGradePaper(actorId, quiz);
    return this.ingestUpload(actorId, quiz, anchor, files);
  }

  async uploadSessionScans(actorId: string, pinId: string, files: { originalname: string; buffer: Buffer; mimetype: string }[]): Promise<ScanUploadOutcome[]> {
    const quiz = await this.quiz.getPin(pinId);
    await this.requireGradePaper(actorId, quiz);
    return this.ingestUpload(actorId, quiz, null, files);
  }


  async listScans(actorId: string, pinId: string, status?: string): Promise<PaperScan[]> {
    const quiz = await this.quiz.getPin(pinId);
    await this.requireGradePaper(actorId, quiz);
    if (status && !(PAPER_SCAN_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException({ message: `Unknown paper scan status ${status}`, code: 'paper.bad_status' });
    }
    const rows = await this.repo.listScansForPin(pinId);
    const batches = new Map((await this.repo.listBatchesForPin(pinId)).map((b) => [b.id, b]));
    return rows
      .filter((row) => !status || row.status === status)
      .map((row) => {
        const batch = row.batchId ? (batches.get(row.batchId) ?? null) : null;
        return this.scanView(row, batch, batch ? this.candidatesFrom(rows, row, batch) : []);
      });
  }

  async getScan(actorId: string, scanId: string): Promise<PaperScan> {
    const scan = await this.getScanRow(scanId);
    const quiz = await this.quiz.getPin(scan.examPinId);
    await this.requireGradePaper(actorId, quiz);
    return this.scanViewFull(scan);
  }

  async scanImage(actorId: string, scanId: string, kind: string): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
    const scan = await this.getScanRow(scanId);
    const quiz = await this.quiz.getPin(scan.examPinId);
    await this.requireGradePaper(actorId, quiz);
    const fileId = kind === 'warped' ? scan.warpedFileId : kind === 'original' ? scan.fileId : null;
    if (!fileId) throw new NotFoundException({ message: `No ${kind} image for this scan`, code: 'paper.image_not_found' });
    const { file, data } = await this.files.readContent(fileId);
    return { data, mimeType: file.mimeType ?? 'application/octet-stream', fileName: file.fileName };
  }

  async assignIdentity(actorId: string, scanId: string, studentId: string): Promise<PaperScan> {
    const scan = await this.getScanRow(scanId);
    if (scan.status === 'recorded') throw new ConflictException({ message: 'Scan is already recorded as an attempt', code: 'paper.already_recorded' });
    const quiz = await this.quiz.getPin(scan.examPinId);
    await this.requireGradePaper(actorId, quiz);
    if (!scan.batchId) {
      throw new BadRequestException({ message: 'Scan is not attached to a print batch yet; assign the batch first', code: 'paper.batch_required' });
    }
    const batch = await this.repo.getBatch(scan.batchId);
    if (!batch) throw new NotFoundException({ message: 'Paper batch of this scan no longer exists', code: 'paper.batch_not_found' });
    const entry = batch.roster.find((r) => r.userId === studentId);
    if (!entry) throw new BadRequestException({ message: 'Student is not in this batch roster', code: 'paper.student_not_in_roster' });
    const updated = await this.repo.updateScan(scan.id, {
      studentId, identitySource: 'manual', identityCode: entry.code,
      status: this.statusFor(studentId, scan.readings),
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'paper_identity_assigned',
      payload: {
        actorId, pinId: scan.examPinId, courseId: quiz.course, component: PAPER_COMPONENT,
        scanId: scan.id, batchId: batch.id, studentId,
        previousStudentId: scan.studentId, previousCode: scan.identityCode, newCode: entry.code,
      },
    });
    return this.scanViewFull(updated);
  }

  async assignBatch(actorId: string, scanId: string, batchId: string): Promise<PaperScan> {
    const scan = await this.getScanRow(scanId);
    if (scan.status === 'recorded') throw new ConflictException({ message: 'Scan is already recorded as an attempt', code: 'paper.already_recorded' });
    const quiz = await this.quiz.getPin(scan.examPinId);
    await this.requireGradePaper(actorId, quiz);
    const batch = await this.repo.getBatch(batchId);
    if (!batch || batch.examPinId !== scan.examPinId) {
      throw new NotFoundException({ message: `Paper batch ${batchId} not found`, code: 'paper.batch_not_found' });
    }

    let readings = scan.readings;
    let studentId: string | null = null;
    let identitySource: 'qr' | 'bubbles' | 'manual' | null = null;
    let identityCode = scan.identityCode;
    let variantCodeRead = scan.variantCodeRead;
    let reread = false;
    if (scan.warpedFileId) {
      try {
        const { data } = await this.files.readContent(scan.warpedFileId);
        const processed = processSheetImage(data, this.geometryOf(batch), await this.omrThresholds(), this.pairSlotsOf(batch));
        if (processed.qualityOk) {
          reread = true;
          readings = this.mapReadings(processed, batch);
          variantCodeRead = processed.variantCode?.code ?? variantCodeRead;
          const claimed = new Set(
            (await this.repo.listScansForPin(scan.examPinId))
              .filter((s) => s.batchId === batch.id && s.id !== scan.id && s.studentId)
              .map((s) => s.studentId!),
          );
          const identity = this.resolveIdentity(processed, batch, claimed);
          studentId = identity.studentId;
          identitySource = identity.identitySource;
          identityCode = identity.identityCode;
        }
      } catch {
      }
    }
    if (!reread) {
      identityCode = scan.batchId === batch.id ? scan.identityCode : null;
      studentId = scan.batchId === batch.id ? scan.studentId : null;
      identitySource = scan.batchId === batch.id ? (scan.identitySource as typeof identitySource) : null;
    }
    const machineReadVariantCode = variantCodeRead;
    const teacherConfirmedVariant = Boolean(
      batch.examCode && machineReadVariantCode && machineReadVariantCode !== batch.examCode,
    );
    if (teacherConfirmedVariant) variantCodeRead = batch.examCode;
    const updated = await this.repo.updateScan(scan.id, {
      batchId: batch.id, readings, studentId, identitySource, identityCode, variantCodeRead,
      status: this.statusFor(studentId, readings),
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'quiz', type: 'paper_batch_assigned',
      payload: {
        actorId, pinId: scan.examPinId, courseId: quiz.course, component: PAPER_COMPONENT,
        scanId: scan.id, batchId: batch.id, previousBatchId: scan.batchId,
        machineReadVariantCode, variantCodeRead, teacherConfirmedVariant,
        studentId, reread,
      },
    });
    return this.scanViewFull(updated);
  }

  async resolveReadings(actorId: string, scanId: string, input: ResolvePaperReadings): Promise<PaperScan> {
    const scan = await this.getScanRow(scanId);
    if (scan.status === 'recorded') throw new ConflictException({ message: 'Scan is already recorded as an attempt', code: 'paper.already_recorded' });
    const quiz = await this.quiz.getPin(scan.examPinId);
    await this.requireGradePaper(actorId, quiz);
    if (!scan.batchId) {
      throw new BadRequestException({ message: 'Scan is not attached to a print batch yet; assign the batch first', code: 'paper.batch_required' });
    }
    const batch = await this.repo.getBatch(scan.batchId);
    if (!batch) throw new NotFoundException({ message: 'Paper batch of this scan no longer exists', code: 'paper.batch_not_found' });
    const layoutBySlot = new Map(batch.layout.map((l) => [l.slot, l]));
    const readings = scan.readings.map((r) => ({ ...r }));
    for (const item of input.readings) {
      const reading = readings.find((r) => r.slot === item.slot);
      if (!reading) throw new BadRequestException({ message: `Slot ${item.slot} is not on this sheet`, code: 'paper.unknown_slot' });
      if (reading.state !== 'ambiguous') {
        throw new BadRequestException({ message: `Slot ${item.slot} is not ambiguous`, code: 'paper.reading_not_ambiguous' });
      }
      const layoutEntry = layoutBySlot.get(item.slot);
      if (layoutEntry?.qtype === 'truefalse') {
        if (!item.pairChoices || item.pairChoices.length !== layoutEntry.statementIds.length) {
          throw new BadRequestException({ message: `Slot ${item.slot} is a true/false cluster slot; resolve it per statement via pairChoices`, code: 'paper.pair_choices_required' });
        }
        reading.pairChoices = [...item.pairChoices];
        reading.chosen = null;
        reading.state = item.pairChoices.every((v) => v === null) ? 'blank' : 'filled';
        reading.resolvedBy = 'teacher';
        continue;
      }
      const optionCount = layoutEntry?.optionCount ?? 0;
      const chosen = item.chosen ?? null;
      if (chosen !== null && (chosen < 0 || chosen >= optionCount)) {
        throw new BadRequestException({ message: `Chosen option ${chosen} is out of range for slot ${item.slot}`, code: 'paper.choice_out_of_range' });
      }
      reading.chosen = chosen;
      reading.state = chosen === null ? 'blank' : 'filled';
      reading.resolvedBy = 'teacher';
    }
    const updated = await this.repo.updateScan(scan.id, {
      readings, status: this.statusFor(scan.studentId, readings),
    });
    return this.scanViewFull(updated);
  }

  async recordScan(actorId: string, scanId: string): Promise<PaperScan & { sumGrades: number | null }> {
    const scan = await this.getScanRow(scanId);
    if (scan.status === 'recorded') throw new ConflictException({ message: 'Scan is already recorded as an attempt', code: 'paper.already_recorded' });
    if (scan.status !== 'ready' || !scan.studentId) {
      throw new ConflictException({ message: 'Scan is not ready to record (identity or ambiguous readings unresolved)', code: 'paper.scan_not_ready' });
    }
    const quiz = await this.quiz.getPin(scan.examPinId);
    await this.requireGradePaper(actorId, quiz);
    if (!scan.batchId) {
      throw new ConflictException({ message: 'Scan is not attached to a print batch', code: 'paper.scan_not_ready' });
    }
    const batch = await this.repo.getBatch(scan.batchId);
    if (!batch) throw new NotFoundException({ message: 'Paper batch of this scan no longer exists', code: 'paper.batch_not_found' });
    if (scan.variantCodeRead && batch.examCode && scan.variantCodeRead !== batch.examCode) {
      throw new ConflictException({
        message: `Sheet exam code ${scan.variantCodeRead} does not match batch exam code ${batch.examCode}`,
        code: 'paper.variant_mismatch',
      });
    }

    const maxSlot = Math.max(...batch.layout.map((l) => l.slot));
    const responses: (string | null)[] = Array.from({ length: maxSlot }, () => null);
    for (const entry of batch.layout) {
      const reading = scan.readings.find((r) => r.slot === entry.slot);
      if (!reading) continue;
      if (entry.qtype === 'truefalse') {
        const answers: Record<string, boolean> = {};
        entry.statementIds.forEach((statementId, k) => {
          const choice = reading.pairChoices?.[k];
          if (choice === 0) answers[statementId] = true;
          else if (choice === 1) answers[statementId] = false;
        });
        if (Object.keys(answers).length > 0) {
          responses[entry.slot - 1] = encodeTrueFalseResponse(answers);
        }
        continue;
      }
      if (reading.chosen === null) continue;
      responses[entry.slot - 1] = entry.answerIds[reading.chosen]!;
    }
    const result = await this.quiz.recordPaperAttempt(actorId, scan.examPinId, {
      studentId: scan.studentId, layout: batch.layout, responses,
      scanId: scan.id, batchId: batch.id, variantCode: batch.variantCode,
    });
    const updated = await this.repo.updateScan(scan.id, { status: 'recorded', attemptId: result.attemptId });
    return { ...(await this.scanViewFull(updated)), sumGrades: result.sumGrades };
  }

  async deleteScan(actorId: string, scanId: string): Promise<void> {
    const scan = await this.getScanRow(scanId);
    if (scan.status === 'recorded') throw new ConflictException({ message: 'A recorded scan is grade evidence and cannot be deleted', code: 'paper.scan_recorded' });
    const quiz = await this.quiz.getPin(scan.examPinId);
    await this.requireGradePaper(actorId, quiz);
    await this.repo.deleteScan(scan.id);
    await this.files.deleteFile(scan.fileId).catch(() => undefined);
    if (scan.warpedFileId) await this.files.deleteFile(scan.warpedFileId).catch(() => undefined);
  }
}
