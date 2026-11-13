import { BadRequestException, Injectable } from '@nestjs/common';
import { extractRichTextPlainText, systemBankPackageSchema, type RichTextDocument } from '@giaokhoa/contracts';
import type { ExamQuestionSnapshot } from '@giaokhoa/db';
import type { ExamSlotRow } from '@giaokhoa/db/repositories/exams';
import { QuestionsService } from '../questions/questions.service';
import { QuestionBanksService } from '../questions/question-banks.service';
import { SystemBankService } from '../system-bank/system-bank.service';
import { SystemBankMediaService } from '../system-bank/system-bank-media.service';
import { checksumPackage, packageValidationError } from '../system-bank/system-bank-package';
import { assertSupportedQtype, normaliseQuestionContent } from '../questions/application/question-content-normalizer';

@Injectable()
export class ExamQuestionSnapshotsService {
  constructor(
    private readonly questions: QuestionsService,
    private readonly questionBanks: QuestionBanksService,
    private readonly systemBank: SystemBankService,
    private readonly media: SystemBankMediaService,
  ) {}

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

  async readLocal(actorId: string, questionId: string, versionId: string): Promise<ExamQuestionSnapshot> {
    await this.questionBanks.assertCanUseQuestionInExam(actorId, questionId);
    const view = await this.questions.getQuestion(questionId);
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

  async prepare(actorId: string, slots: ExamSlotRow[], targetContextId: string, versionMode = 'pinned', preparationId?: string, allowEmbeddedSystem = false): Promise<ExamQuestionSnapshot[] | null> {
    if (!slots.some((slot) => slot.sourceDomain === 'bank-system')) return null;
    if (versionMode !== 'pinned') throw new BadRequestException({ code: 'exam.shared_requires_pinned' });
    const snapshots: ExamQuestionSnapshot[] = [];
    for (const slot of slots) {
      const snapshot = slot.sourceDomain === 'bank-system'
        ? allowEmbeddedSystem && slot.sourceSnapshot?.package
          ? slot.sourceSnapshot
          : await this.readSystem(actorId, slot.questionId, slot.pinnedVersionNumber!)
        : await this.readLocal(actorId, slot.questionId, slot.pinnedVersionId!);
      const verifiedPackage = systemBankPackageSchema.parse(snapshot.package);
      if (checksumPackage(verifiedPackage) !== snapshot.checksum ||
        packageValidationError(snapshot.qtype, verifiedPackage) ||
        snapshot.questionId !== slot.questionId ||
        snapshot.versionNumber !== slot.pinnedVersionNumber ||
        snapshot.versionId !== slot.pinnedVersionId ||
        (slot.sourceSnapshot && snapshot.checksum !== slot.sourceSnapshot.checksum)) {
        throw new BadRequestException({ code: 'system_bank.checksum_mismatch' });
      }
      snapshots.push({ ...snapshot, package: await this.media.materialize(
        snapshot.package, targetContextId, actorId, snapshot.sourceDomain === 'centre', true, preparationId,
      ) });
    }
    return snapshots;
  }

  excerpt(snapshot: ExamQuestionSnapshot): string {
    return extractRichTextPlainText(snapshot.package.questionText as RichTextDocument).slice(0, 120);
  }
}
