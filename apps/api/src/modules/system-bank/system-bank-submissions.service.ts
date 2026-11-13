/**
 * Luồng công bố câu hỏi trung tâm theo ba actor:
 * - Giáo viên lưu câu trong bank riêng như trước.
 * - Quản trị trung tâm chụp phiên bản, nội dung/đáp án/media rồi gửi.
 * - Biên tập viên hệ thống kiểm tra hàng chờ và duyệt/từ chối.
 * Mọi thao tác duyệt ghi vào kho ngân hàng; nguồn ở trung tâm không bị sửa.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { systemBankPackageSchema, type SystemBankPackage } from '@giaokhoa/contracts';
import { SystemBankCentreRepository } from '@giaokhoa/db/repositories/system-bank-centre';
import { SystemBankSubmissionsRepository, type SystemQuestionSubmissionRow } from '@giaokhoa/db/repositories/system-bank-submissions';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { tenantAls } from '../tenants/tenant-als';
import { QuestionBanksService } from '../questions/question-banks.service';
import { QuestionsService } from '../questions/questions.service';
import { checksumPackage, packageValidationError, verifyPackageChecksum } from './system-bank-package';
import { SystemBankMediaService } from './system-bank-media.service';

@Injectable()
export class SystemBankSubmissionsService {
  constructor(
    private readonly repo: SystemBankSubmissionsRepository,
    private readonly centreRepo: SystemBankCentreRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly questions: QuestionsService,
    private readonly banks: QuestionBanksService,
    private readonly media: SystemBankMediaService,
  ) {}

  /**
   * Gác quản trị TRUNG TÂM tại context tenant, không dùng quyền
   * quản trị platform. Không có tenant hiệu lực trả 403 trước khi đọc câu.
   * @returns Slug trung tâm đã được xác minh.
   */
  private async centreManager(actorId: string): Promise<{ tenantId: string; centreSlug: string }> {
    const tenantId = tenantAls.getStore()?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException({ message: 'Centre context required', code: 'system_bank.centre_context_required' });
    }
    const context = await this.contexts.getTenantContext(tenantId);
    if (!context) {
      throw new ForbiddenException({ message: 'Centre context required', code: 'system_bank.centre_context_required' });
    }
    await this.evaluator.requireCapability(actorId, 'tenant:manage', context.id);
    const centreSlug = tenantAls.getStore()?.spaceSlug ?? await this.centreRepo.resolveTenantSlug(tenantId);
    if (!centreSlug) {
      throw new ForbiddenException({ message: 'Centre slug unavailable', code: 'system_bank.centre_context_required' });
    }
    return { tenantId, centreSlug };
  }

  /**
   * Biên tập viên có quyền systembank:review tại context hệ thống,
   * tách biệt quyền quản trị tenant dùng để gửi. Cổng luôn chạy trước
   * khi lấy package có đáp án khỏi kho ngân hàng.
   */
  private async editor(actorId: string): Promise<void> {
    const system = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, 'systembank:review', system.id);
  }

  /**
   * Chụp đúng một version câu tại thời điểm gửi; không trả bản chụp
   * từ kho nguồn sau khi đã ghi. Không phát hành ở thao tác này.
   */
  async submit(actorId: string, questionId: string, license?: string): Promise<SystemQuestionSubmissionRow> {
    const { tenantId, centreSlug } = await this.centreManager(actorId);
    const view = await this.questions.getQuestion(questionId);
    const category = await this.questions.getCategory(view.question.category);
    if (!category.bankId) {
      throw new NotFoundException({ message: 'Question not found in centre bank', code: 'question.not_found' });
    }
    const bank = await this.banks.getBankOrThrow(category.bankId);
    if (bank.tenantId !== tenantId || bank.bankKind !== 'question' || bank.scope === 'platform') {
      throw new NotFoundException({ message: 'Question not found in centre bank', code: 'question.not_found' });
    }
    if (view.entry.status !== 'ready') {
      throw new BadRequestException({ message: 'Only ready questions can be submitted', code: 'system_bank.source_not_ready' });
    }
    const links = await this.questions.getCurriculumLinks(questionId);
    const raw: SystemBankPackage = {
      questionText: view.latestVersion.questionText,
      generalFeedback: view.latestVersion.generalFeedback ?? null,
      stimulusContent: view.stimulus?.content ?? null,
      answers: view.answers.map((answer) => ({
        answer: answer.answer, isCorrect: answer.isCorrect,
        feedback: answer.feedback ?? null, sortOrder: answer.sortOrder,
      })),
      answerKey: view.answerKey,
      options: view.options,
      outcomes: links.outcomes.map((outcome) => ({
        outcomeId: outcome.outcomeId,
        cognitiveLevel: outcome.cognitiveLevel as SystemBankPackage['outcomes'][number]['cognitiveLevel'],
      })),
      source: {
        centreSlug, questionId: view.question.id, versionId: view.latestVersion.id,
        versionNumber: view.latestVersion.version,
        authorId: view.question.originalAuthorId ?? view.question.createdBy,
        sourceKind: view.question.sourceKind,
        sourceRef: view.question.sourceRef,
        license: license?.trim() || null,
      },
    };
    const problem = packageValidationError(view.question.qtype, raw);
    if (problem) {
      throw new BadRequestException({ message: problem, code: 'system_bank.bad_package' });
    }
    const pkg = systemBankPackageSchema.parse(await this.media.snapshot(raw, category.contextId));
    const submitted = await this.repo.submit({
      centreSlug, sourceQuestionId: questionId, sourceVersionId: view.latestVersion.id,
      sourceVersionNumber: view.latestVersion.version,
      qtype: view.question.qtype, package: pkg, checksum: checksumPackage(pkg), submittedBy: actorId,
    });
    // Bản đã bị từ chối là terminal cho phiên bản nguồn này; retry
    // không đổi được snapshot/giấy phép. Chỉnh câu để sinh version mới
    // rồi gửi lại, giữ lịch sử quyết định của bản cũ bất biến.
    if (submitted.status === 'rejected') {
      throw new ConflictException({
        message: 'Rejected source version cannot be submitted again; create a new version',
        code: 'system_bank.submission_rejected_requires_new_version',
      });
    }
    return submitted;
  }

  /**
   * Liệt kê các câu sẵn sàng gửi thuộc bank riêng của trung tâm hiện tại,
   * bao gồm bank cá nhân của giáo viên khác để quản trị không cần chép UUID.
   * Chỉ trả metadata phục vụ bộ chọn; không chuyển đáp án qua API này.
   */
  async listSources(actorId: string): Promise<Array<{
    id: string; qtype: string; questionText: unknown; version: number;
  }>> {
    const { tenantId } = await this.centreManager(actorId);
    const sources: Array<{ id: string; qtype: string; questionText: unknown; version: number }> = [];
    for (const category of await this.questions.listCategories()) {
      if (!category.bankId) continue;
      const bank = await this.banks.getBankOrThrow(category.bankId);
      if (bank.tenantId !== tenantId || bank.bankKind !== 'question' || bank.scope === 'platform') continue;
      for (const view of await this.questions.listQuestions(category.id)) {
        if (view.entry.status !== 'ready') continue;
        sources.push({
          id: view.question.id, qtype: view.question.qtype,
          questionText: view.latestVersion.questionText, version: view.latestVersion.version,
        });
      }
    }
    return sources;
  }

  /** Quản trị chỉ xem lịch sử của trung tâm hiệu lực, không thấy hàng chờ B. */
  async listMine(actorId: string): Promise<SystemQuestionSubmissionRow[]> {
    const { centreSlug } = await this.centreManager(actorId);
    return this.repo.listForCentre(centreSlug);
  }

  /** Chỉ biên tập viên hệ thống được xem các bản gửi chưa duyệt. */
  async listPending(actorId: string): Promise<SystemQuestionSubmissionRow[]> {
    await this.editor(actorId);
    return this.repo.listPending();
  }

  /** Cổng người xem gói chờ duyệt không cấp cho học sinh hoặc trung tâm khác. */
  async getForReview(actorId: string, id: string): Promise<SystemQuestionSubmissionRow> {
    await this.editor(actorId);
    const row = await this.repo.get(id);
    if (!row) throw new NotFoundException({ message: 'Submission not found', code: 'system_bank.submission_not_found' });
    return row;
  }

  /**
   * Đọc byte ảnh trong bản chụp để biên tập viên thực sự xem được ảnh.
   * Cổng editor chạy trước khi tìm hash trong manifest; không cấp URL
   * công khai hay đọc file nguồn thuộc vòng đời trung tâm.
   */
  async readReviewMedia(actorId: string, id: string, hash: string) {
    const row = await this.getForReview(actorId, id);
    return this.media.readPreview(systemBankPackageSchema.parse(row.package), hash);
  }

  /**
   * Duyệt idempotent: checksum của gói chờ phải còn khớp trước khi ghi;
   * repository khoá một transaction và không tạo hai phiên bản khi retry.
   */
  async approve(actorId: string, id: string): Promise<SystemQuestionSubmissionRow> {
    const row = await this.getForReview(actorId, id);
    if (row.status === 'rejected') {
      throw new ConflictException({ message: 'Submission was rejected', code: 'system_bank.submission_reviewed' });
    }
    if (row.status === 'approved') return row;
    const pkg = systemBankPackageSchema.parse(row.package);
    if (!verifyPackageChecksum(pkg, row.checksum) || packageValidationError(row.qtype, pkg)) {
      throw new BadRequestException({ message: 'Submitted package is invalid', code: 'system_bank.checksum_mismatch' });
    }
    try {
      const reviewed = await this.repo.approve(id, actorId);
      if (!reviewed || reviewed.status === 'rejected') {
        throw new ConflictException({ message: 'Submission was rejected', code: 'system_bank.submission_reviewed' });
      }
      return reviewed;
    } catch (error) {
      if (error instanceof Error && error.message === 'system_bank.submission_source_conflict') {
        throw new ConflictException({ message: 'Published question cannot receive this source version', code: 'system_bank.submission_source_conflict' });
      }
      throw error;
    }
  }

  /** Từ chối kèm lý do, không phát hành bất kỳ version nào. */
  async reject(actorId: string, id: string, reason: string): Promise<SystemQuestionSubmissionRow> {
    await this.editor(actorId);
    const row = await this.repo.reject(id, actorId, reason);
    if (!row) throw new NotFoundException({ message: 'Submission not found', code: 'system_bank.submission_not_found' });
    if (row.status === 'approved') {
      throw new ConflictException({ message: 'Submission already approved', code: 'system_bank.submission_reviewed' });
    }
    return row;
  }
}
