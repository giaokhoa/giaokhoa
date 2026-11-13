/**
 * Service của kho ngân hàng hệ thống (issue #585): bản chính tập trung của Ngân hàng câu hỏi hệ thống trên database riêng phía platform.
 *
 * Luồng nghiệp vụ chính:
 * - Phát hành (quản trị platform): tạo câu kèm phiên bản đầu tiên,
 *   hoặc tạo phiên bản mới cho câu đã có — mỗi phiên bản mang gói tự đủ + checksum SHA-256 do server tự tính trên dạng chuẩn hoá của gói; nội dung phiên bản cũ không bao giờ bị ghi đè. Liên kết YCCĐ trong gói là ẢNH CHỤP tại thời điểm phát hành (bảng liên kết của kho nghiệp vụ gắn theo câu, không theo version): sửa liên kết mà không phát hành version mới thì gói cũ không đổi — muốn làm mới gói thì phát hành version mới.
 * - Kiểm chứng gói theo dạng câu ở mức thô (không lặp lại toàn bộ
 *   chuẩn hoá sâu của module câu hỏi — kiểm chứng Tiptap sâu xảy ra ở lúc nhập vào kho trung tâm qua `QuestionsService`):
 *   multichoice đúng 4 lựa chọn + đúng 1 đáp án đúng; truefalse TF-A không mang dòng đáp án; shortanswer ít nhất 1 đáp án và mọi dòng đều là đáp án được chấp nhận; essay không mang dòng đáp án.
 * - Rút câu (quản trị platform): đổi metadata trạng thái của câu
 *   thành `withdrawn` (tách khỏi nội dung phiên bản — các phiên bản cũ vẫn đọc lại nguyên vẹn), ghi sự kiện `question_withdrawn` vào nhật ký append-only, và trả về danh sách slug các trung tâm đã nhập câu để tầng trên phát thông báo (kênh sự kiện platform).
 * - Đọc: câu + từng phiên bản + phiên bản mới nhất, kèm checksum để
 *   phía nhập kiểm chứng trước khi ghi bản chụp. Vì gói chứa đáp án và khoá đáp án, đường đọc nội dung gói đi qua cổng người xem `question:useall` tại context hệ thống (xem `assertPackageViewer`) — khác đường khám phá chỉ trả metadata.
 *
 * Mọi thao tác đều cần kho ngân hàng đã cấu hình
 * (`SYSTEM_BANK_DATABASE_URL`); chưa cấu hình thì repository ném
 * `system_bank.not_configured` (503). Mọi thao tác ghi gác bằng capability quản trị platform hiện hữu (`tenant:manage` tại context hệ thống — site admin vượt qua cổng này theo lối tắt của evaluator); tầng này không sinh capability mới.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { sql as kyselySql } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SystemBankCentreRepository } from '@giaokhoa/db/repositories/system-bank-centre';
import { SystemBankRepository } from '@giaokhoa/db/repositories/system-bank';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContextsService } from '../access/contexts.service';
import { tenantAls } from '../tenants/tenant-als';
import { TenantDbService } from '../tenants/tenant-db.service';
import type { RichTextInput, SystemBankPackage } from '@giaokhoa/contracts';
import { QuestionsService, type QuestionContentInput } from '../questions/questions.service';
import { QuestionBanksService } from '../questions/question-banks.service';
import { canonicalizeJson, checksumPackage, packageValidationError, verifyPackageChecksum } from './system-bank-package';
import { assertProgrammePackageIntegrity, programmePackageChecksum, programmeNodesParentsFirst } from './programme-package-integrity';
import { SystemBankConnection } from './system-bank.connection';
import { SystemBankMediaService } from './system-bank-media.service';
import type {
  CreateSystemBankQuestionDto,
  CreateSystemBankVersionDto,
  CreateSystemOutcomePackageDto,
  DiscoverSystemBankQuestionsDto,
  ImportSystemBankQuestionDto,
  WithdrawSystemBankQuestionDto,
} from './dto/system-bank.dto';

/**
 * Bóc lỗi vi phạm unique của PostgreSQL (23505): qua Kysely lỗi pg ném THÔ — `code` nằm trực tiếp trên lỗi, không có `cause`; helper vẫn duyệt cả chuỗi `cause` (vòng đầu kiểm chính lỗi được ném) để tương thích các đường lỗi còn bọc qua bộ máy cũ ở tầng khác.
 */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  while (e !== null && typeof e === 'object') {
    if ((e as { code?: unknown }).code === '23505') {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class SystemBankService {
  constructor(
    private readonly repo: SystemBankRepository,
    private readonly centreRepo: SystemBankCentreRepository,
    private readonly connection: SystemBankConnection,
    private readonly evaluator: PermissionEvaluator,
    private readonly contexts: ContextsService,
    private readonly tenantDb: TenantDbService,
    private readonly questions: QuestionsService,
    private readonly banks: QuestionBanksService,
    @Optional() private readonly media?: SystemBankMediaService,
    @Optional() private readonly spaceDb?: SpaceDatabaseService,
  ) {}

  /** Kho ngân hàng đã được cấu hình kết nối hay chưa. */
  get isConfigured(): boolean {
    return this.connection.isConfigured;
  }

  /**
   * Gác quản trị platform: chỉ người giữ `tenant:manage` tại context hệ thống mới được phát hành/rút câu — cùng helper với bề mặt quản trị tenant và control plane hiện hữu.
   */
  private async assertPlatformManager(actorId: string): Promise<void> {
    const systemId = (await this.contexts.ensureSystemContext()).id;
    await this.evaluator.requireCapability(actorId, 'tenant:manage', systemId);
  }

  /**
   * Gác người xem cho các đường đọc NỘI DUNG GÓI (câu + từng phiên bản): gói mang đáp án và khoá đáp án nên đường đọc đi qua cổng người xem `question:useall` theo chuẩn cổng đọc câu hỏi của hệ
   * (issue #55). Ngữ cảnh gác là context HỆ THỐNG — câu hệ thống là
   * nội dung platform, không thuộc category hay ngữ cảnh của bất kỳ trung tâm nào (cùng ngữ cảnh mà đường phát hành gác bằng `tenant:manage` ở trên). Không có quyền thì trả 404 `system_bank.question_not_found` như câu không tồn tại: không lộ sự tồn tại của câu lẫn gói cho người không được xem (học sinh, phụ huynh không có `question:useall` trong registry capability).
   */
  private async assertPackageViewer(actorId: string, questionId: string): Promise<void> {
    const systemId = (await this.contexts.ensureSystemContext()).id;
    const canView = await this.evaluator
      .hasCapability(actorId, 'question:useall', systemId)
      .catch(() => false);
    if (!canView) {
      throw new NotFoundException({
        message: `System question ${questionId} not found`,
        code: 'system_bank.question_not_found',
      });
    }
  }

  /**
   * Gác người nhận sự kiện cho hai đường sự kiện phía trung tâm
   * (liệt kê sự kiện chưa ghi nhận + ghi nhận sự kiện): sự kiện rút
   * câu là thông báo vận hành của TRUNG TÂM, không phải dữ kiện của
   * từng thành viên — chỉ người giữ `question:useall` tại context
   * hệ thống (cùng cổng với các đường đọc nội dung gói, xem
   * `assertPackageViewer`) mới được xem và ghi nhận thay trung
   * tâm. Đường sự kiện không gắn với một câu cụ thể nên chỉ kiểm
   * capability thuần, không kiểm sự tồn tại của gói; trượt cổng thì
   * ném 403 `access.capability_denied` như các cổng
   * `requireCapability` khác trong module. Cổng luôn chạy TRƯỚC
   * mọi thao tác đọc/ghi của hai đường này: người trượt cổng không
   * thấy danh sách và tuyệt đối không để lại vết ghi nhận — nếu
   * không, bất kỳ thành viên nào của trung tâm (kể cả học sinh)
   * cũng ghi nhận thay được và sự kiện biến khỏi danh sách chờ của
   * giáo viên cùng trung tâm, thông báo rút câu bị tiêu thụ bởi
   * sai người.
   */
  private async assertEventViewer(actorId: string): Promise<void> {
    const systemId = (await this.contexts.ensureSystemContext()).id;
    await this.evaluator.requireCapability(actorId, 'question:useall', systemId);
  }

  /**
   * Kiểm chứng gói theo dạng câu ở mức thô (luật ở
   * `packageValidationError` trong `system-bank-package.ts`).
   * @throws BadRequestException `system_bank.bad_package` khi gói vi
   * phạm luật của dạng câu.
   */
  private assertPackageForQtype(qtype: string, pkg: SystemBankPackage): void {
    const error = packageValidationError(qtype, pkg);
    if (error) {
      throw new BadRequestException({ message: error, code: 'system_bank.bad_package' });
    }
  }

  /** Phát hành câu hỏi hệ thống mới kèm phiên bản đầu tiên (nguyên tử). */
  async publishQuestion(actorId: string, dto: CreateSystemBankQuestionDto) {
    await this.assertPlatformManager(actorId);
    this.assertPackageForQtype(dto.qtype, dto.package);
    const checksum = checksumPackage(dto.package);
    return this.repo.createQuestionWithFirstVersion({
      id: dto.id,
      qtype: dto.qtype,
      createdBy: actorId,
      package: dto.package,
      checksum,
    });
  }

  /** Phát hành phiên bản mới cho câu đã có (câu chưa rút mới được phát hành tiếp). */
  async publishVersion(actorId: string, questionId: string, dto: CreateSystemBankVersionDto) {
    await this.assertPlatformManager(actorId);
    const question = await this.repo.getQuestion(questionId);
    if (!question) {
      throw new NotFoundException({ message: `System question ${questionId} not found`, code: 'system_bank.question_not_found' });
    }
    if (question.status === 'withdrawn') {
      throw new BadRequestException({
        message: `System question ${questionId} is withdrawn and cannot receive new versions`,
        code: 'system_bank.question_withdrawn',
      });
    }
    this.assertPackageForQtype(question.qtype, dto.package);
    const checksum = checksumPackage(dto.package);
    return this.repo.createVersion(questionId, dto.package, checksum);
  }

  /**
   * Rút câu hỏi: đổi trạng thái + ghi sự kiện + trả về slug các trung
   * tâm đã nhập (để tầng trên phát thông báo qua kênh sự kiện
   * platform). Rút câu đã rút là thao tác idempotent ở mức trạng thái
   * nhưng vẫn ghi thêm một sự kiện — tránh rút trùng, service từ chối
   * rút lần hai.
   */
  async withdrawQuestion(actorId: string, questionId: string, dto: WithdrawSystemBankQuestionDto) {
    await this.assertPlatformManager(actorId);
    const question = await this.repo.getQuestion(questionId);
    if (!question) {
      throw new NotFoundException({ message: `System question ${questionId} not found`, code: 'system_bank.question_not_found' });
    }
    if (question.status === 'withdrawn') {
      throw new BadRequestException({
        message: `System question ${questionId} is already withdrawn`,
        code: 'system_bank.question_withdrawn',
      });
    }
    const updated = await this.repo.markWithdrawn(questionId, { reason: dto.reason, by: actorId });
    if (!updated) {
      throw new NotFoundException({ message: `System question ${questionId} not found`, code: 'system_bank.question_not_found' });
    }
    const event = await this.repo.recordEvent({
      type: 'question_withdrawn',
      sourceQuestionId: questionId,
      payload: { reason: dto.reason, withdrawnBy: actorId, withdrawnAt: new Date().toISOString() },
    });
    const notifiedCentres = await this.repo.listImporterSlugs(questionId);
    return { question: updated, event, notifiedCentres };
  }

  /**
   * Đọc một câu hỏi hệ thống (mọi trạng thái — cả câu đã rút vẫn
   * đọc được để đối chiếu). Qua cổng người xem gói trước khi đọc
   * (xem `assertPackageViewer`).
   */
  async getQuestion(actorId: string, questionId: string) {
    await this.assertPackageViewer(actorId, questionId);
    const question = await this.repo.getQuestion(questionId);
    if (!question) {
      throw new NotFoundException({ message: `System question ${questionId} not found`, code: 'system_bank.question_not_found' });
    }
    return question;
  }

  /** Đọc một phiên bản kèm checksum (phía nhập dùng để kiểm chứng gói trước khi ghi). Qua cổng người xem gói. */
  async getVersion(actorId: string, questionId: string, version: number) {
    await this.assertPackageViewer(actorId, questionId);
    const row = await this.repo.getVersionByNumber(questionId, version);
    if (!row) {
      throw new NotFoundException({
        message: `System question ${questionId} version ${version} not found`,
        code: 'system_bank.version_not_found',
      });
    }
    return row;
  }

  /** Liệt kê mọi phiên bản của một câu theo thứ tự số tăng dần. Qua cổng người xem gói. */
  async listVersions(actorId: string, questionId: string) {
    await this.getQuestion(actorId, questionId);
    return this.repo.listVersions(questionId);
  }

  /** Đọc phiên bản mới nhất của một câu (phía khám phá dùng để biết bản đang phát hành). Qua cổng người xem gói. */
  async getLatestVersion(actorId: string, questionId: string) {
    await this.getQuestion(actorId, questionId);
    const row = await this.repo.getLatestVersion(questionId);
    if (!row) {
      throw new NotFoundException({
        message: `System question ${questionId} has no versions`,
        code: 'system_bank.version_not_found',
      });
    }
    return row;
  }

  /**
   * Khám phá câu hỏi hệ thống đang phát hành: chỉ câu có trạng thái
   * `published` mới xuất hiện (câu đã rút biến khỏi khám phá ngay).
   * Kết quả trả định danh nguồn + danh sách mọi phiên bản của câu để
   * giáo viên chọn đúng phiên bản cần nhập. Lọc theo YCCĐ/mức độ
   * khớp khi BẤT KỲ phiên bản nào của câu mang liên kết đó (phiên bản
   * cũ vẫn nhập được). Không sinh capability mới: đường này chỉ yêu
   * cầu người gọi đã xác thực và đang ở trong ngữ cảnh một trung tâm
   * (tenant hiệu lực); cổng `question:add` áp ở lúc nhập, không áp
   * ở lúc xem.
   */
  async discover(query: DiscoverSystemBankQuestionsDto) {
    const store = tenantAls.getStore();
    if (!store?.tenantId && !store?.spaceSlug) {
      throw new ForbiddenException({
        message: 'System bank discovery requires a centre context',
        code: 'system_bank.centre_context_required',
      });
    }
    const entries = await this.repo.listPublishedQuestionsWithVersions({
      qtype: query.qtype,
      outcomeId: query.outcomeId,
      cognitiveLevel: query.cognitiveLevel,
    });
    const total = entries.length;
    const page = entries.slice(query.offset, query.offset + query.limit);
    return {
      items: page.map((entry) => ({
        id: entry.question.id,
        qtype: entry.question.qtype,
        status: entry.question.status,
        createdAt: entry.question.createdAt,
        versions: entry.versions.map((version) => ({
          version: version.version,
          checksum: version.checksum,
          createdAt: version.createdAt,
        })),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /**
   * Suy slug trung tâm của request hiện tại cho dòng importer: ưu
   * tiên slug kho riêng trong ngữ cảnh ALS (trung tâm đã ở kho riêng),
   * nếu không thì tra slug của tenant hiệu lực trong kho nghiệp vụ
   * (thế giới kho chung). Không suy được thì fail-closed — nhập bản
   * chụp bắt buộc phải gắn với đúng một trung tâm.
   */
  private async resolveCentreSlug(): Promise<string> {
    const store = tenantAls.getStore();
    if (store?.spaceSlug) return store.spaceSlug;
    if (store?.tenantId) {
      const slug = await this.centreRepo.resolveTenantSlug(store.tenantId);
      if (slug) return slug;
    }
    throw new BadRequestException({
      message: 'System bank import requires a centre context',
      code: 'system_bank.centre_context_required',
    });
  }

  /**
   * Nhập bản chụp một phiên bản câu hỏi hệ thống vào kho trung tâm
   * (đường duy nhất đưa câu hệ thống vào đề/bank của trung tâm —
   * đường thi không bao giờ đọc trực tiếp từ kho ngân hàng):
   * 1. Câu phải đang phát hành; phiên bản vắng thì lấy mới nhất.
   * 2. Tính lại checksum của gói và đối chiếu với checksum đã lưu:
   *    lệch thì từ chối, không ghi gì vào kho trung tâm.
   * 3. Mọi YCCĐ trong gói phải đã có trong bản cài YCCĐ cục bộ của
   *    trung tâm — thiếu thì fail-closed kèm danh sách id thiếu (trung
   *    tâm cập nhật gói YCCĐ trước rồi nhập lại), không nhập nửa vời.
   * 4. Đích nhập theo đúng đường copy câu hiện hữu: mặc định bank cá
   *    nhân của người nhập; đích tường minh phải thuộc về bank đó;
   *    cổng `question:add` tại category đích.
   * 5. Ghi dòng importer SAU khi đích và cổng quyền đã qua, TRƯỚC
   *    khi ghi câu vào kho trung tâm (upsert idempotent): nhập bị từ
   *    chối ở đích/quyền thì KHÔNG để lại dòng importer — trung tâm
   *    chưa từng nhập không bị thông báo rút câu oan. Lỗi tạo câu
   *    sau điểm này để lại dòng importer thừa lành tính (thông báo
   *    rút câu tới trung tâm chưa nhập thành công), đối chiếu được
   *    bằng dòng truy vết nhập phía trung tâm vốn chỉ ghi khi tạo
   *    câu xong.
   * 6. Tạo câu trung tâm qua `QuestionsService` (đi qua chuẩn hoá nội
   *    dung + cổng quyền như câu soạn tay) — ngữ liệu trong gói (nếu
   *    có) được tạo mới trong category đích trước — gắn các liên kết
   *    YCCĐ của gói, rồi ghi dòng truy vết nhập (kind `pristine`,
   *    phiên bản nguyên trạng = version 1 của câu mới).
   * Hai kho (ngân hàng + trung tâm) không có transaction chung: thứ
   * tự trên bảo đảm lỗi ở bước nào cũng để lại trạng thái lành tính
   * và ghi rõ trong thân PR.
   */
  async importSystemQuestion(actorId: string, dto: ImportSystemBankQuestionDto) {
    const centreSlug = await this.resolveCentreSlug();
    const question = await this.repo.getQuestion(dto.sourceQuestionId);
    if (!question) {
      throw new NotFoundException({
        message: `System question ${dto.sourceQuestionId} not found`,
        code: 'system_bank.question_not_found',
      });
    }
    if (question.status !== 'published') {
      throw new BadRequestException({
        message: `System question ${dto.sourceQuestionId} is withdrawn and cannot be imported`,
        code: 'system_bank.question_withdrawn',
      });
    }
    const version = dto.sourceVersionNumber !== undefined
      ? await this.repo.getVersionByNumber(dto.sourceQuestionId, dto.sourceVersionNumber)
      : await this.repo.getLatestVersion(dto.sourceQuestionId);
    if (!version) {
      throw new NotFoundException({
        message: `System question ${dto.sourceQuestionId} version ${dto.sourceVersionNumber ?? 'latest'} not found`,
        code: 'system_bank.version_not_found',
      });
    }
    const pkg = version.package as SystemBankPackage;
    if (!verifyPackageChecksum(pkg, version.checksum)) {
      throw new BadRequestException({
        message: `System question ${dto.sourceQuestionId} version ${version.version} failed checksum verification`,
        code: 'system_bank.checksum_mismatch',
      });
    }
    const missingOutcomes: string[] = [];
    for (const outcome of pkg.outcomes) {
      if (!(await this.centreRepo.outcomeExists(outcome.outcomeId))) {
        missingOutcomes.push(outcome.outcomeId);
      }
    }
    if (missingOutcomes.length > 0) {
      throw new BadRequestException({
        message: `System bank import blocked: centre has not installed outcomes: ${missingOutcomes.join(', ')}`,
        code: 'system_bank.outcome_not_installed',
      });
    }
    const targetBank = dto.targetBankId
      ? await this.banks.getBankOrThrow(dto.targetBankId)
      : await this.banks.ensurePersonalBank(actorId, 'question', { forCopy: true });
    if (await this.banks.isForeignPersonalBank(actorId, targetBank)) {
      throw new NotFoundException({ message: `Question bank ${targetBank.id} not found`, code: 'question.bank_not_found' });
    }
    let targetCategory;
    if (dto.targetCategoryId) {
      targetCategory = await this.questions.getCategory(dto.targetCategoryId);
      if (!(await this.banks.categoryBelongsToBank(targetCategory, targetBank))) {
        throw new BadRequestException({
          message: 'Target category does not belong to the target bank',
          code: 'question.copy_target_category_mismatch',
        });
      }
    } else {
      targetCategory = await this.banks.defaultCategoryOfBank(targetBank);
    }
    await this.evaluator.requireCapability(actorId, 'question:add', targetCategory.contextId);
    // Bản công bố giữ ref ảnh theo hash của bank-system; khi nhập,
    // tái tạo file của trung tâm đích từ byte đã sao độc lập.
    // Chạy sau kiểm quyền để không tạo file khi yêu cầu bị từ chối.
    const importPkg = this.media
      ? await this.media.materialize(pkg, targetCategory.contextId, actorId)
      : pkg;
    // Chỉ khi đích và cổng quyền đã qua mới ghi dòng importer (bước
    // 5 trong flow ở đầu hàm): nhập bị từ chối ở trên không để lại
    // vết nhập nào ở phía ngân hàng.
    await this.repo.recordImporter({
      sourceQuestionId: dto.sourceQuestionId,
      centreSlug,
      importedBy: actorId,
    });
    const stimulusId = importPkg.stimulusContent
      ? (await this.questions.createStimulus(actorId, {
          categoryId: targetCategory.id,
          content: importPkg.stimulusContent as RichTextInput,
        })).id
      : null;
    // Kho gốc lưu các trường rich-text rỗng ở dạng null, trong khi
    // QuestionsService nhận "không khai báo" (undefined), không nhận
    // null ở options để đưa qua toRichTextDocument. Giữ nguyên gói
    // công bố bất biến, chỉ chuẩn hoá bản nhập của trung tâm đích.
    const importOptions = importPkg.options ? { ...importPkg.options } : undefined;
    if (importOptions) {
      for (const key of ['correctFeedback', 'incorrectFeedback', 'graderInfo', 'responseTemplate']) {
        if (importOptions[key] === null) delete importOptions[key];
      }
    }
    const content: QuestionContentInput = {
      questionText: importPkg.questionText as RichTextInput,
      generalFeedback: (importPkg.generalFeedback ?? undefined) as RichTextInput | undefined,
      guidance: (importPkg.answerKey?.guidance ?? undefined) as RichTextInput | undefined,
      stimulusId,
      answers: importPkg.answers.map((answer) => ({
        text: answer.answer as RichTextInput,
        correct: answer.isCorrect,
        feedback: (answer.feedback ?? undefined) as RichTextInput | undefined,
      })),
      options: importOptions as QuestionContentInput['options'],
      solution: importPkg.answerKey?.solution
        ? (importPkg.answerKey.solution as QuestionContentInput['solution'])
        : undefined,
    };
    const created = await this.questions.createQuestion(actorId, {
      categoryId: targetCategory.id,
      qtype: question.qtype,
      ...content,
    });
    for (const outcome of importPkg.outcomes) {
      await this.questions.attachOutcome(actorId, created.question.id, outcome.outcomeId, outcome.cognitiveLevel);
    }
    const importRow = await this.centreRepo.insertImportRow({
      questionId: created.question.id,
      sourceQuestionId: dto.sourceQuestionId,
      sourceVersionId: version.id,
      sourceVersionNumber: version.version,
      packageChecksum: version.checksum,
      importedVersionNumber: 1,
      importedBy: actorId,
      kind: 'pristine',
    });
    return { question: created, import: importRow, source: { questionId: question.id, version: version.version } };
  }

  /**
   * Liệt kê các sự kiện kho ngân hàng mà trung tâm hiện tại CHƯA ghi
   * nhận — đường giao thông báo phía trung tâm (hiện tại là sự kiện
   * rút câu):
   * 1. Suy slug trung tâm của request (fail-closed khi không có ngữ
   *    cảnh trung tâm, như đường nhập).
   * 2. Chỉ sự kiện về các câu CHÍNH trung tâm này đã nhập mới thuộc
   *    diện giao: tập câu lấy từ sổ importer phía ngân hàng, sự
   *    kiện lấy từ nhật ký append-only theo tập câu đó.
   * 3. Loại các sự kiện đã có vết ghi nhận của chính trung tâm này
   *    (bảng receipts trong kho trung tâm) — trung tâm khác ghi
   *    nhận không làm sự kiện biến khỏi danh sách của trung tâm này.
   * Trung tâm biết định danh sự kiện TỪ CHÍNH danh sách này rồi gọi
   * đường ghi nhận; không cần (và không có) kênh nào khác để biết id
   * sự kiện. Trước mọi bước trên, người gọi phải qua cổng
   * `assertEventViewer` (`question:useall` tại context hệ thống):
   * danh sách là thông báo vận hành của trung tâm, không mở cho
   * mọi thành viên của trung tâm.
   */
  async listPendingEvents(actorId: string) {
    await this.assertEventViewer(actorId);
    const centreSlug = await this.resolveCentreSlug();
    const questionIds = await this.repo.listImportedQuestionIds(centreSlug);
    if (questionIds.length === 0) return [];
    const events = await this.repo.listEventsForQuestions(questionIds);
    if (events.length === 0) return [];
    const received = new Set(await this.centreRepo.listEventReceiptEventIds(centreSlug));
    return events.filter((event) => !received.has(event.id));
  }

  /**
   * Ghi nhận trung tâm đã nhận một sự kiện kho ngân hàng (hiện tại là
   * sự kiện rút câu): idempotent theo cặp sự kiện + slug trung tâm.
   * Trung tâm gọi sau khi nhận thông báo rút câu qua kênh sự kiện
   * platform; vết này để platform đối chiếu trung tâm nào đã nhận.
   * Người gọi phải qua cổng `assertEventViewer` (`question:useall`
   * tại context hệ thống) TRƯỚC khi ghi: trượt cổng thì không có
   * vết ghi nhận nào được tạo, sự kiện vẫn nằm nguyên trong danh
   * sách chờ của trung tâm.
   */
  async acknowledgeEvent(actorId: string, eventId: string) {
    await this.assertEventViewer(actorId);
    const centreSlug = await this.resolveCentreSlug();
    return this.centreRepo.insertEventReceipt({ eventId, centreSlug });
  }

  /**
   * Quản trị trung tâm có kho vật lý riêng mới được gửi/cài gói.
   * Kho chung không bảo đảm A và B giữ phiên bản độc lập nên từ chối.
   */
  private async assertCentrePackageManager(actorId: string): Promise<{ centreSlug: string; centreContextId: string }> {
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
    if (!centreSlug || !this.spaceDb || (await this.spaceDb.resolveTarget(centreSlug)).mode !== 'dedicated') {
      throw new ForbiddenException({
        message: 'Installing programme packages requires a dedicated centre store',
        code: 'system_bank.dedicated_centre_required',
      });
    }
    return { centreSlug, centreContextId: context.id };
  }

  /** Biên tập viên quản lý hàng chờ ở quyền hệ thống, tách người gửi. */
  private async assertProgrammeReviewer(actorId: string): Promise<void> {
    const system = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, 'systembank:review', system.id);
  }

  /**
   * Quản trị gửi ảnh chụp chương trình ở kho riêng vào hàng chờ.
   * Nguồn và định danh không bị sửa khi biên tập viên duyệt về sau.
   */
  async createOutcomePackage(actorId: string, dto: CreateSystemOutcomePackageDto) {
    const { centreSlug } = await this.assertCentrePackageManager(actorId);
    const snapshot = await this.tenantDb.withCurrent(async (tx) => {
      // Chụp cây chương trình bằng truy vấn Kysely trên handle định
      // tuyến (hạng mục G10, issue #650): danh sách cột tường minh có
      // bí danh camelCase khớp hình dạng dòng mà phần dựng gói phía
      // dưới đang dùng; các tập id rỗng được chặn trước bằng guard
      // độ dài như bản bộ máy cũ — không phát truy vấn `in ()`.
      const subjectColumns = [
        'id',
        'context_id as contextId',
        'name',
        'slug',
        'position',
        'created_at as createdAt',
        'updated_at as updatedAt',
      ] as const;
      const subjectRows =
        dto.scope === 'all'
          ? await tx.selectFrom('subjects').select(subjectColumns).execute()
          : await tx.selectFrom('subjects').select(subjectColumns).where('slug', '=', dto.scope).execute();
      if (dto.scope !== 'all' && subjectRows.length === 0) {
        throw new NotFoundException({
          message: `Subject ${dto.scope} not found in centre programme`,
          code: 'curriculum.subject_not_found',
        });
      }
      const subjectIds = subjectRows.map((row) => row.id);
      const curriculumRows =
        subjectIds.length === 0
          ? []
          : await tx
              .selectFrom('curricula')
              .select(['id', 'subject_id as subjectId', 'grade', 'created_at as createdAt', 'updated_at as updatedAt'])
              .where('subject_id', 'in', subjectIds)
              .execute();
      const curriculumIds = curriculumRows.map((row) => row.id);
      const nodeRows =
        curriculumIds.length === 0
          ? []
          : await tx
              .selectFrom('curriculum_nodes')
              .select([
                'id',
                'curriculum_id as curriculumId',
                'parent_id as parentId',
                'title',
                'kind',
                'position',
                'duration_periods as durationPeriods',
                'duration_percent as durationPercent',
                'created_at as createdAt',
                'updated_at as updatedAt',
              ])
              .where('curriculum_id', 'in', curriculumIds)
              .execute();
      const nodeIds = nodeRows.map((row) => row.id);
      const outcomeRows =
        nodeIds.length === 0
          ? []
          : await tx
              .selectFrom('learning_outcomes')
              .select([
                'id',
                'node_id as nodeId',
                'position',
                'content',
                'source_kind as sourceKind',
                'source_ref as sourceRef',
                'tenant_id as tenantId',
                'derived_from_id as derivedFromId',
                'retired_at as retiredAt',
                'created_at as createdAt',
                'updated_at as updatedAt',
              ])
              .where('node_id', 'in', nodeIds)
              .where('tenant_id', 'is', null)
              .where('retired_at', 'is', null)
              .execute();
      return { subjectRows, curriculumRows, nodeRows, outcomeRows };
    });
    const subjectById = new Map(snapshot.subjectRows.map((row) => [row.id, row]));
    const packageCurricula = snapshot.curriculumRows.map((row) => ({
      curriculumId: row.id,
      subjectSlug: subjectById.get(row.subjectId)?.slug ?? '',
      subjectName: subjectById.get(row.subjectId)?.name ?? '',
      subjectPosition: subjectById.get(row.subjectId)?.position ?? 1,
      grade: row.grade,
    }));
    const packageNodes = snapshot.nodeRows.map((row) => ({
      nodeId: row.id,
      curriculumId: row.curriculumId,
      parentId: row.parentId,
      title: row.title,
      kind: row.kind,
      position: row.position,
      durationPeriods: row.durationPeriods,
      durationPercent: row.durationPercent,
    }));
    const packageOutcomes = snapshot.outcomeRows.map((row) => ({
      outcomeId: row.id,
      nodeId: row.nodeId,
      position: row.position,
      content: row.content,
      sourceKind: row.sourceKind,
      sourceRef: row.sourceRef,
    }));
    const items = { curricula: packageCurricula, nodes: packageNodes, outcomes: packageOutcomes, mappings: dto.mappings };
    const checksum = programmePackageChecksum(items);
    try {
      assertProgrammePackageIntegrity({
        version: dto.version, scope: dto.scope, checksum,
        outcomeCount: packageOutcomes.length, centreSlug,
      }, items);
    } catch (error) {
      throw new BadRequestException({ message: String(error), code: 'system_bank.bad_package' });
    }
    try {
      const pkg = await this.repo.createPackageWithItems({
        version: dto.version,
        scope: dto.scope,
        checksum,
        outcomeCount: packageOutcomes.length,
        createdBy: actorId,
        centreSlug,
        curricula: packageCurricula,
        nodes: packageNodes,
        outcomes: packageOutcomes,
        mappings: dto.mappings,
      });
      return { package: pkg, counts: { curricula: packageCurricula.length, nodes: packageNodes.length, outcomes: packageOutcomes.length } };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message: `Outcome package version ${dto.version} already exists`,
          code: 'system_bank.package_version_exists',
        });
      }
      throw err;
    }
  }

  /** Khám phá: chỉ trả các phiên bản đã được biên tập viên phê duyệt. */
  async listOutcomePackages() {
    return this.repo.listPackages();
  }

  /** Trung tâm xem các phiên bản chính mình gửi và trạng thái duyệt. */
  async listMyOutcomePackages(actorId: string) {
    const { centreSlug } = await this.assertCentrePackageManager(actorId);
    return this.repo.listCentrePackages(centreSlug);
  }

  /** Bản cài ở kho riêng trung tâm, kèm checksum và phiên bản trước. */
  async listInstalledOutcomePackages(actorId: string) {
    await this.assertCentrePackageManager(actorId);
    return this.centreRepo.listOutcomePackageInstalls();
  }

  /** Hàng chờ kiểm duyệt, chỉ khả dụng cho biên tập viên hệ thống. */
  async listPendingOutcomePackages(actorId: string) {
    await this.assertProgrammeReviewer(actorId);
    return this.repo.listPendingPackages();
  }

  /** Đọc bản gửi đầy đủ của biên tập viên, không công bố trước duyệt. */
  async getOutcomePackageForReview(actorId: string, version: string) {
    await this.assertProgrammeReviewer(actorId);
    const pkg = await this.repo.getPackageByVersion(version);
    if (!pkg) throw new NotFoundException({ message: 'Package not found', code: 'system_bank.package_not_found' });
    return { package: pkg, ...await this.repo.getPackageItems(pkg.id) };
  }

  /** Quyết định xuất bản/từ chối; gói sai checksum hoặc quan hệ không thể được duyệt. */
  async reviewOutcomePackage(actorId: string, version: string, approve: boolean, reason?: string) {
    await this.assertProgrammeReviewer(actorId);
    const pkg = await this.repo.getPackageByVersion(version);
    if (!pkg) throw new NotFoundException({ message: 'Package not found', code: 'system_bank.package_not_found' });
    if (approve) {
      const items = await this.repo.getPackageItems(pkg.id);
      try {
        assertProgrammePackageIntegrity(pkg, items);
      } catch (error) {
        throw new BadRequestException({ message: String(error), code: 'system_bank.bad_package' });
      }
    }
    if (!approve && !reason?.trim()) {
      throw new BadRequestException({ message: 'Rejection reason is required', code: 'system_bank.rejection_reason_required' });
    }
    try {
      return await this.repo.reviewPackage(version, actorId, approve, reason?.trim() ?? null);
    } catch (error) {
      if (error instanceof Error && error.message === 'system_bank.package_already_reviewed') {
        throw new ConflictException({ message: 'Package was already reviewed', code: 'system_bank.package_already_reviewed' });
      }
      throw error;
    }
  }

  /** Đọc đầy đủ một bản phát hành, che nội dung bản đang chờ hoặc từ chối. */
  async getOutcomePackage(version: string) {
    const pkg = await this.repo.getPackageByVersion(version);
    if (!pkg || pkg.status !== 'published') {
      throw new NotFoundException({ message: `Outcome package ${version} not found`, code: 'system_bank.package_not_found' });
    }
    return { package: pkg, ...await this.repo.getPackageItems(pkg.id) };
  }

  /**
   * Cài bản phát hành vào riêng kho vật lý của trung tâm.
   * Toàn bộ kiểm tra định danh, cây, YCCĐ và vết cài nằm trong một
   * transaction. Giữ nguyên dữ liệu đã được câu/đề tham chiếu:
   * nếu cùng id nhưng khác nội dung, dừng và rollback, không upsert.
   */
  async installOutcomePackage(actorId: string, version: string) {
    const { centreContextId } = await this.assertCentrePackageManager(actorId);
    const pkg = await this.repo.getPackageByVersion(version);
    if (!pkg || pkg.status !== 'published') {
      throw new NotFoundException({ message: `Outcome package ${version} not found`, code: 'system_bank.package_not_found' });
    }
    const items = await this.repo.getPackageItems(pkg.id);
    try {
      assertProgrammePackageIntegrity(pkg, items);
    } catch (error) {
      throw new BadRequestException({ message: String(error), code: 'system_bank.bad_package' });
    }

    return this.tenantDb.withCurrent(async (tx) => {
      // Khoá mỗi transaction cài gói trên chính kho đích; hai kho A/B
      // độc lập nên có thể chọn phiên bản riêng mà không chặn nhau.
      await kyselySql`select pg_advisory_xact_lock(17, 17)`.execute(tx);
      const already = await this.centreRepo.getOutcomePackageInstallByVersion(pkg.version, tx);
      if (already) {
        if (already.packageChecksum && already.packageChecksum !== pkg.checksum) {
          throw new ConflictException({
            message: 'Already installed package checksum differs', code: 'system_bank.package_conflict',
          });
        }
        // Dòng cài trước migration #17 chưa có checksum. Khi tái thử,
        // bổ sung riêng checksum sau khi đã xác thực bản nguồn; tuyệt đối
        // không chèn lại cây và không đổi mốc installed_at đã lưu.
        if (!already.packageChecksum) {
          await tx.updateTable('outcome_package_installs')
            .set({ package_checksum: pkg.checksum })
            .where('id', '=', already.id).execute();
        }
        return { install: { ...already, packageChecksum: pkg.checksum }, package: pkg, unchanged: true,
          counts: { curricula: items.curricula.length, nodes: items.nodes.length, outcomes: items.outcomes.length } };
      }

      const subjects = new Map<string, { id: string; contextId: string }>();
      // Quyền tenant:manage đã được kiểm tra trước khi mở transaction.
      // Môn mới thuộc context trung tâm, không đòi quyền quản trị hệ thống.
      for (const curriculum of items.curricula) {
        if (subjects.has(curriculum.subjectSlug)) continue;
        const existing = await this.centreRepo.findSubjectBySlug(curriculum.subjectSlug, tx);
        if (!existing && !curriculum.subjectName) {
          throw new BadRequestException({
            message: `Package has no source subject snapshot for ${curriculum.subjectSlug}`,
            code: 'system_bank.subject_not_installed',
          });
        }
        const subject = existing ?? await this.centreRepo.insertSubject({
          contextId: centreContextId, name: curriculum.subjectName!,
          slug: curriculum.subjectSlug, position: curriculum.subjectPosition,
        }, tx);
        subjects.set(curriculum.subjectSlug, { id: subject.id, contextId: subject.contextId });
      }

      for (const curriculum of items.curricula) {
        const subject = subjects.get(curriculum.subjectSlug)!;
        const byGrade = await this.centreRepo.findCurriculumBySubjectGrade(subject.id, curriculum.grade, tx);
        const byId = await tx.selectFrom('curricula').select(['id', 'subject_id', 'grade'])
          .where('id', '=', curriculum.curriculumId).executeTakeFirst();
        if ((byGrade && byGrade.id !== curriculum.curriculumId)
          || (byId && (byId.subject_id !== subject.id || byId.grade !== curriculum.grade))) {
          throw new ConflictException({
            message: `Curriculum identity conflict for ${curriculum.subjectSlug}/${curriculum.grade}`,
            code: 'system_bank.curriculum_conflict',
          });
        }
      }
      for (const node of items.nodes) {
        const existing = await tx.selectFrom('curriculum_nodes').selectAll()
          .where('id', '=', node.nodeId).executeTakeFirst();
        if (existing && (existing.curriculum_id !== node.curriculumId
          || existing.parent_id !== node.parentId
          || existing.title !== node.title || existing.kind !== node.kind
          || existing.position !== node.position
          || existing.duration_periods !== node.durationPeriods
          || existing.duration_percent !== node.durationPercent)) {
          throw new ConflictException({
            message: `Programme node id ${node.nodeId} conflicts with existing content`,
            code: 'system_bank.node_conflict',
          });
        }
      }
      for (const outcome of items.outcomes) {
        const existing = await tx.selectFrom('learning_outcomes').selectAll()
          .where('id', '=', outcome.outcomeId).executeTakeFirst();
        if (existing && (existing.node_id !== outcome.nodeId
          || existing.position !== outcome.position
          || existing.tenant_id !== null || existing.source_kind !== outcome.sourceKind
          || existing.source_ref !== outcome.sourceRef
          || canonicalizeJson(existing.content) !== canonicalizeJson(outcome.content))) {
          throw new ConflictException({
            message: `Outcome id ${outcome.outcomeId} conflicts with existing content`,
            code: 'system_bank.outcome_conflict',
          });
        }
      }

      for (const curriculum of items.curricula) {
        await this.centreRepo.upsertCurriculum({
          id: curriculum.curriculumId,
          subjectId: subjects.get(curriculum.subjectSlug)!.id,
          grade: curriculum.grade,
        }, tx);
      }
      for (const node of programmeNodesParentsFirst(items)) {
        await this.centreRepo.upsertCurriculumNode({
          id: node.nodeId, curriculumId: node.curriculumId, parentId: node.parentId,
          title: node.title, kind: node.kind, position: node.position,
          durationPeriods: node.durationPeriods, durationPercent: node.durationPercent,
        }, tx);
      }
      for (const outcome of items.outcomes) {
        await this.centreRepo.upsertLearningOutcome({
          id: outcome.outcomeId, nodeId: outcome.nodeId, position: outcome.position,
          content: outcome.content, sourceKind: outcome.sourceKind, sourceRef: outcome.sourceRef,
        }, tx);
      }
      const previous = await this.centreRepo.getOutcomePackageInstall(pkg.scope, tx);
      const install = await this.centreRepo.recordOutcomePackageInstall({
        packageVersion: pkg.version, packageChecksum: pkg.checksum,
        previousVersion: previous?.packageVersion ?? null,
        scope: pkg.scope, installedBy: actorId,
      }, tx);
      return { install, package: pkg, unchanged: false,
        counts: { curricula: items.curricula.length, nodes: items.nodes.length, outcomes: items.outcomes.length } };
    });
  }
}
