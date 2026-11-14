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

  get isConfigured(): boolean {
    return this.connection.isConfigured;
  }

  private async assertPlatformManager(actorId: string): Promise<void> {
    const systemId = (await this.contexts.ensureSystemContext()).id;
    await this.evaluator.requireCapability(actorId, 'tenant:manage', systemId);
  }

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
    const question = await this.repo.getQuestion(questionId);
    if (!question || question.status !== 'withdrawn') return;
    const canManage = await this.evaluator.hasCapability(actorId, 'tenant:manage', systemId).catch(() => false);
    if (canManage) return;
    const centreSlug = await this.resolveCentreSlug();
    const used = await this.repo.listImportedQuestionIds(centreSlug);
    if (!used.includes(questionId)) {
      throw new NotFoundException({
        message: `System question ${questionId} not found`,
        code: 'system_bank.question_not_found',
      });
    }
  }

  private async assertEventViewer(actorId: string): Promise<void> {
    const systemId = (await this.contexts.ensureSystemContext()).id;
    const tenantId = tenantAls.getStore()?.tenantId;
    const centre = tenantId ? await this.contexts.getTenantContext(tenantId) : null;
    const [questions, content, exams, manager] = await Promise.all([
      this.evaluator.hasCapability(actorId, 'question:useall', systemId),
      this.evaluator.hasCapabilityFromRealAssignmentAnywhere(actorId, 'contentbank:upload'),
      this.evaluator.hasCapabilityFromRealAssignmentAnywhere(actorId, 'exam:use'),
      centre ? this.evaluator.hasCapability(actorId, 'tenant:manage', centre.id) : false,
    ]);
    if (!questions && !content && !exams && !manager) {
      await this.evaluator.requireCapability(actorId, 'question:useall', systemId);
    }
  }

  private assertPackageForQtype(qtype: string, pkg: SystemBankPackage): void {
    const error = packageValidationError(qtype, pkg);
    if (error) {
      throw new BadRequestException({ message: error, code: 'system_bank.bad_package' });
    }
  }

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
    const result = await this.repo.markWithdrawn(questionId, { reason: dto.reason, by: actorId });
    if (!result) {
      throw new NotFoundException({ message: `System question ${questionId} not found`, code: 'system_bank.question_not_found' });
    }
    const notifiedCentres = await this.repo.listImporterSlugs(questionId);
    return { ...result, notifiedCentres };
  }

  async getQuestion(actorId: string, questionId: string) {
    await this.assertPackageViewer(actorId, questionId);
    const question = await this.repo.getQuestion(questionId);
    if (!question) {
      throw new NotFoundException({ message: `System question ${questionId} not found`, code: 'system_bank.question_not_found' });
    }
    return question;
  }

  private async visibleWithdrawnVersionNumbers(actorId: string, questionId: string): Promise<Set<number> | null> {
    const source = await this.repo.getQuestion(questionId);
    if (source?.status !== 'withdrawn') return null;
    const systemId = (await this.contexts.ensureSystemContext()).id;
    if (await this.evaluator.hasCapability(actorId, 'tenant:manage', systemId).catch(() => false)) return null;
    const imports = await this.centreRepo.listImportsBySource(questionId);
    return new Set(imports.map((row) => row.sourceVersionNumber));
  }

  async getVersion(actorId: string, questionId: string, version: number) {
    await this.assertPackageViewer(actorId, questionId);
    const allowed = await this.visibleWithdrawnVersionNumbers(actorId, questionId);
    if (allowed && !allowed.has(version)) {
      throw new NotFoundException({ code: 'system_bank.version_not_found' });
    }
    const row = await this.repo.getVersionByNumber(questionId, version);
    if (!row) {
      throw new NotFoundException({
        message: `System question ${questionId} version ${version} not found`,
        code: 'system_bank.version_not_found',
      });
    }
    return row;
  }

  async listVersions(actorId: string, questionId: string) {
    await this.getQuestion(actorId, questionId);
    const allowed = await this.visibleWithdrawnVersionNumbers(actorId, questionId);
    const versions = await this.repo.listVersions(questionId);
    return allowed ? versions.filter((row) => allowed.has(row.version)) : versions;
  }

  async getLatestVersion(actorId: string, questionId: string) {
    await this.getQuestion(actorId, questionId);
    const allowed = await this.visibleWithdrawnVersionNumbers(actorId, questionId);
    const versions = allowed ? await this.repo.listVersions(questionId) : null;
    const pinned = versions?.filter((row) => allowed!.has(row.version))
      .sort((a, b) => b.version - a.version)[0];
    const row = allowed ? pinned ?? null : await this.repo.getLatestVersion(questionId);
    if (!row) {
      throw new NotFoundException({
        message: `System question ${questionId} has no versions`,
        code: 'system_bank.version_not_found',
      });
    }
    return row;
  }

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

  async importSystemQuestion(actorId: string, dto: ImportSystemBankQuestionDto) {
    const centreSlug = await this.resolveCentreSlug();
    const question = await this.repo.getQuestion(dto.sourceQuestionId);
    if (!question) {
      throw new NotFoundException({
        message: `System question ${dto.sourceQuestionId} not found`,
        code: 'system_bank.question_not_found',
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
    if (question.status !== 'published') {
      const previousImports = await this.centreRepo.listImportsBySource(dto.sourceQuestionId);
      if (!previousImports.some((entry) => entry.sourceVersionId === version.id)) {
        throw new BadRequestException({
          message: `System question ${dto.sourceQuestionId} is withdrawn and cannot be imported`,
          code: 'system_bank.question_withdrawn',
        });
      }
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
    const importPkg = this.media
      ? await this.media.materialize(pkg, targetCategory.contextId, actorId)
      : pkg;
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

  async listUsedQuestionVersions(actorId: string) {
    await this.assertEventViewer(actorId);
    await this.resolveCentreSlug();
    const imports = await this.centreRepo.listImports();
    const visible = await Promise.all(imports.map(async (entry) => {
      try {
        await this.questions.getQuestionForViewer(actorId, entry.questionId);
      } catch {
        return null;
      }
      const source = await this.repo.getQuestion(entry.sourceQuestionId);
      const latest = await this.repo.getLatestVersion(entry.sourceQuestionId);
      return {
        ...entry,
        sourceStatus: source?.status ?? 'unavailable',
        latestVersionNumber: latest?.version ?? null,
        hasNewVersion: latest !== null && latest.version > entry.sourceVersionNumber,
      };
    }));
    return visible.filter((entry) => entry !== null);
  }

  async getUsedQuestionVersion(actorId: string, questionId: string) {
    await this.questions.getQuestionForViewer(actorId, questionId);
    const entry = await this.centreRepo.getImportRow(questionId);
    if (!entry) {
      throw new NotFoundException({ code: 'system_bank.import_not_found' });
    }
    const source = await this.repo.getQuestion(entry.sourceQuestionId);
    const latest = await this.repo.getLatestVersion(entry.sourceQuestionId);
    return {
      ...entry,
      sourceStatus: source?.status ?? 'unavailable',
      latestVersionNumber: latest?.version ?? null,
      hasNewVersion: latest !== null && latest.version > entry.sourceVersionNumber,
    };
  }

  private async relevantEvents(centreSlug: string) {
    const [questionIds, materials, examVersionIds, packages] = await Promise.all([
      this.repo.listImportedQuestionIds(centreSlug),
      this.centreRepo.listMaterialReferences(),
      this.centreRepo.listSharedExamVersionIds(),
      this.centreRepo.listOutcomePackageInstalls(),
    ]);
    const exams = await this.repo.listExamSourcesForVersions(examVersionIds);
    const keys: Array<{ kind: 'exam' | 'material' | 'programme'; key: string }> = [
      ...materials.map((material) => ({ kind: 'material' as const, key: material.materialId })),
      ...exams.map((exam) => ({ kind: 'exam' as const, key: `${exam.centreSlug}/${exam.sourceExamId}` })),
      ...packages.map((pkg) => ({ kind: 'programme' as const, key: pkg.scope })),
    ];
    const [questions, resources] = await Promise.all([
      this.repo.listEventsForQuestions(questionIds),
      this.repo.listResourceEvents(keys),
    ]);
    return [...questions, ...resources].sort((a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  }

  async listPendingEvents(actorId: string) {
    await this.assertEventViewer(actorId);
    const centreSlug = await this.resolveCentreSlug();
    const [events, receipts] = await Promise.all([
      this.relevantEvents(centreSlug),
      this.centreRepo.listEventReceiptEventIds(centreSlug),
    ]);
    const received = new Set(receipts);
    return events.filter((event) => !received.has(event.id));
  }

  async acknowledgeEvent(actorId: string, eventId: string) {
    await this.assertEventViewer(actorId);
    const centreSlug = await this.resolveCentreSlug();
    const events = await this.relevantEvents(centreSlug);
    if (!events.some((event) => event.id === eventId)) {
      throw new NotFoundException({ code: 'system_bank.event_not_found' });
    }
    return this.centreRepo.insertEventReceipt({ eventId, centreSlug });
  }

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

  private async assertProgrammeReviewer(actorId: string): Promise<void> {
    if (tenantAls.getStore()?.spaceSlug) {
      throw new ForbiddenException({
        message: 'Programme review is only available at the platform',
        code: 'system_bank.review_platform_only',
      });
    }
    const system = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, 'systembank:review', system.id);
  }

  async createOutcomePackage(actorId: string, dto: CreateSystemOutcomePackageDto) {
    const { centreSlug } = await this.assertCentrePackageManager(actorId);
    const snapshot = await this.tenantDb.withCurrent(async (tx) => {
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

  async listOutcomePackages() {
    return this.repo.listPackages();
  }

  async listMyOutcomePackages(actorId: string) {
    const { centreSlug } = await this.assertCentrePackageManager(actorId);
    return this.repo.listCentrePackages(centreSlug);
  }

  async listInstalledOutcomePackages(actorId: string) {
    await this.assertCentrePackageManager(actorId);
    return this.centreRepo.listOutcomePackageInstalls();
  }

  async listPendingOutcomePackages(actorId: string) {
    await this.assertProgrammeReviewer(actorId);
    return this.repo.listPendingPackages();
  }

  async getOutcomePackageForReview(actorId: string, version: string) {
    await this.assertProgrammeReviewer(actorId);
    const pkg = await this.repo.getPackageByVersion(version);
    if (!pkg) throw new NotFoundException({ message: 'Package not found', code: 'system_bank.package_not_found' });
    return { package: pkg, ...await this.repo.getPackageItems(pkg.id) };
  }

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

  async withdrawOutcomePackage(actorId: string, version: string, reason: string) {
    await this.assertProgrammeReviewer(actorId);
    const result = await this.repo.withdrawPackage(version, actorId, reason);
    if (!result) throw new ConflictException({ code: 'system_bank.package_not_published' });
    return result;
  }

  async getOutcomePackage(version: string) {
    const pkg = await this.repo.getPackageByVersion(version);
    const installed = pkg?.status === 'withdrawn' && tenantAls.getStore()?.tenantId
      ? await this.centreRepo.getOutcomePackageInstallByVersion(version) : null;
    if (!pkg || (pkg.status !== 'published' && !installed)) {
      throw new NotFoundException({ message: `Outcome package ${version} not found`, code: 'system_bank.package_not_found' });
    }
    return { package: pkg, ...await this.repo.getPackageItems(pkg.id) };
  }

  async installOutcomePackage(actorId: string, version: string) {
    const { centreContextId } = await this.assertCentrePackageManager(actorId);
    const pkg = await this.repo.getPackageByVersion(version);
    const alreadyInstalled = pkg?.status === 'withdrawn'
      ? await this.centreRepo.getOutcomePackageInstallByVersion(version) : null;
    if (!pkg || (pkg.status !== 'published' && !alreadyInstalled)) {
      throw new NotFoundException({ message: `Outcome package ${version} not found`, code: 'system_bank.package_not_found' });
    }
    const items = await this.repo.getPackageItems(pkg.id);
    try {
      assertProgrammePackageIntegrity(pkg, items);
    } catch (error) {
      throw new BadRequestException({ message: String(error), code: 'system_bank.bad_package' });
    }

    return this.tenantDb.withCurrent(async (tx) => {
      await kyselySql`select pg_advisory_xact_lock(17, 17)`.execute(tx);
      const already = await this.centreRepo.getOutcomePackageInstallByVersion(pkg.version, tx);
      if (already) {
        if (already.packageChecksum && already.packageChecksum !== pkg.checksum) {
          throw new ConflictException({
            message: 'Already installed package checksum differs', code: 'system_bank.package_conflict',
          });
        }
        if (!already.packageChecksum) {
          await tx.updateTable('outcome_package_installs')
            .set({ package_checksum: pkg.checksum })
            .where('id', '=', already.id).execute();
        }
        return { install: { ...already, packageChecksum: pkg.checksum }, package: pkg, unchanged: true,
          counts: { curricula: items.curricula.length, nodes: items.nodes.length, outcomes: items.outcomes.length } };
      }

      const subjects = new Map<string, { id: string; contextId: string }>();
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
