/**
 * Chụp câu dùng cho đề/thi, tách khỏi ngân hàng editable. Chọn nguồn kiểm quyền
 * và version; giao bài sao đầy đủ phụ thuộc vào trung tâm trước khi pin sẵn sàng.
 * Không ghi dữ liệu học sinh hoặc mở giao dịch tại kho hệ thống.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { extractRichTextPlainText, systemBankPackageSchema, type RichTextDocument } from '@giaokhoa/contracts';
import type { ExamQuestionSnapshot } from '@giaokhoa/db';
import type { ExamSlotRow } from '@giaokhoa/db/repositories/exams';
import { QuestionsService } from '../questions/questions.service';
import { SystemBankService } from '../system-bank/system-bank.service';
import { SystemBankMediaService } from '../system-bank/system-bank-media.service';
import { checksumPackage, packageValidationError } from '../system-bank/system-bank-package';
import { assertSupportedQtype, normaliseQuestionContent } from '../questions/application/question-content-normalizer';

/** Điều phối bản chụp hai nguồn; mọi thao tác ghi chỉ nằm ở kho trung tâm hiện hành. */
@Injectable()
export class ExamQuestionSnapshotsService {
  constructor(
    private readonly questions: QuestionsService,
    private readonly systemBank: SystemBankService,
    private readonly media: SystemBankMediaService,
  ) {}

  /** Đọc đúng version công bố sau cổng quyền nguồn; không nhập câu vào bank đích. */
  async readSystem(actorId: string, questionId: string, versionNumber: number): Promise<ExamQuestionSnapshot> {
    const question = await this.systemBank.getQuestion(actorId, questionId);
    if (question.status !== 'published') {
      throw new BadRequestException({ code: 'system_bank.question_withdrawn' });
    }
    const version = await this.systemBank.getVersion(actorId, questionId, versionNumber);
    const pkg = systemBankPackageSchema.parse(version.package);
    if (checksumPackage(pkg) !== version.checksum) {
      throw new BadRequestException({ code: 'system_bank.checksum_mismatch' });
    }
    const error = packageValidationError(question.qtype, pkg);
    if (error) throw new BadRequestException({ code: 'system_bank.bad_package', message: error });
    assertSupportedQtype(question.qtype);
    /** Dùng cùng bộ chuẩn hoá của câu editable để gác rules và cấu trúc TF-A trước khi giao. */
    normaliseQuestionContent(question.qtype, {
      questionText: pkg.questionText as RichTextDocument,
      answers: pkg.answers.map((a) => ({ text: a.answer as RichTextDocument, correct: a.isCorrect, feedback: (a.feedback ?? undefined) as RichTextDocument | undefined })),
      guidance: (pkg.answerKey?.guidance ?? undefined) as RichTextDocument | undefined,
      solution: (pkg.answerKey?.solution ?? undefined) as never,
      options: pkg.options as never,
    });
    return {
      sourceDomain: 'bank-system', questionId, versionId: version.id, versionNumber,
      qtype: question.qtype, defaultMark: 1, checksum: version.checksum, package: pkg,
      answerIds: pkg.answers.map((_, i) => `${version.id}-${i + 1}`),
    };
  }

  /** Chụp version local sau cổng đọc; giữ nguyên id đáp án để tương thích lượt làm hiện hành. */
  async readLocal(actorId: string, questionId: string, versionId: string): Promise<ExamQuestionSnapshot> {
    const view = await this.questions.getQuestionForViewer(actorId, questionId);
    const content = await this.questions.getVersionContent(questionId, versionId);
    const stimulus = content.version.stimulusId ? await this.questions.getStimulus(content.version.stimulusId) : null;
    const pkg = systemBankPackageSchema.parse({
      questionText: content.version.questionText, generalFeedback: content.version.generalFeedback,
      stimulusContent: stimulus?.content ?? null, answers: content.answers.map((a) => ({
        answer: a.answer, isCorrect: a.isCorrect, feedback: a.feedback, sortOrder: a.sortOrder,
      })), answerKey: content.answerKey, options: content.options, outcomes: [],
    });
    return {
      sourceDomain: 'centre', questionId, versionId, versionNumber: content.version.version,
      qtype: view.question.qtype, defaultMark: content.version.defaultMark,
      checksum: checksumPackage(pkg), package: pkg, answerIds: content.answers.map((a) => a.id),
    };
  }

  /**
   * Chuẩn bị mọi slot vào miền trung tâm; lỗi quyền/version/hash/byte ném trước
   * khi pin sẵn sàng. Không dùng bản mới hơn bản đã chọn, không thay nguồn ngầm.
   */
  async prepare(actorId: string, slots: ExamSlotRow[], targetContextId: string, versionMode = 'pinned'): Promise<ExamQuestionSnapshot[] | null> {
    if (!slots.some((slot) => slot.sourceDomain === 'bank-system')) return null;
    if (versionMode !== 'pinned') throw new BadRequestException({ code: 'exam.shared_requires_pinned' });
    const snapshots: ExamQuestionSnapshot[] = [];
    for (const slot of slots) {
      const snapshot = slot.sourceDomain === 'bank-system'
        ? await this.readSystem(actorId, slot.questionId, slot.pinnedVersionNumber!)
        : await this.readLocal(actorId, slot.questionId, slot.pinnedVersionId!);
      if (snapshot.versionId !== slot.pinnedVersionId ||
        (slot.sourceSnapshot && snapshot.checksum !== slot.sourceSnapshot.checksum)) {
        throw new BadRequestException({ code: 'system_bank.checksum_mismatch' });
      }
      snapshots.push({ ...snapshot, package: await this.media.materialize(
        snapshot.package, targetContextId, actorId, snapshot.sourceDomain === 'centre', true,
      ) });
    }
    return snapshots;
  }

  /** Trích tên hiển thị từ nội dung đã chụp; không cần truy cập lại kho nguồn. */
  excerpt(snapshot: ExamQuestionSnapshot): string {
    return extractRichTextPlainText(snapshot.package.questionText as RichTextDocument).slice(0, 120);
  }
}
