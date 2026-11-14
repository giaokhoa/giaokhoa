import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isIP } from 'node:net';
import { systemMaterialPackageSchema, type SystemMaterialPackage, type SystemMaterialVersion, type UseSystemMaterial } from '@giaokhoa/contracts';
import { SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import { SystemMaterialsRepository } from '@giaokhoa/db/repositories/system-materials';
import { SystemMaterialReferencesRepository, type SystemMaterialReference } from '@giaokhoa/db/repositories/system-material-references';
import { SystemBankCentreRepository } from '@giaokhoa/db/repositories/system-bank-centre';
import { ContextsService } from '../access/contexts.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContentBankService } from '../content-bank/content-bank.service';
import { CoursesService } from '../courses/courses.service';
import { FilesService } from '../files/files.service';
import { OBJECT_STORAGE, sha256Hex, type ObjectStorage } from '../files/storage';
import { tenantAls } from '../tenants/tenant-als';
import { checksumPackage } from './system-bank-package';
import { publicationMediaStorageKey } from './system-bank-media.service';

@Injectable()
export class SystemMaterialsService {
  constructor(
    private readonly repo: SystemMaterialsRepository,
    private readonly references: SystemMaterialReferencesRepository,
    private readonly centre: SystemBankCentreRepository,
    private readonly library: ContentBankService,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly courses: CoursesService,
    private readonly files: FilesService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private async manager(actorId: string): Promise<string> {
    const tenantId = tenantAls.getStore()?.tenantId;
    const context = tenantId ? await this.contexts.getTenantContext(tenantId) : null;
    if (!tenantId || !context) throw new ForbiddenException({ message: 'Centre context required', code: 'system_bank.centre_context_required' });
    await this.evaluator.requireCapability(actorId, 'tenant:manage', context.id);
    const slug = tenantAls.getStore()?.spaceSlug ?? await this.centre.resolveTenantSlug(tenantId);
    if (!slug) throw new ForbiddenException({ message: 'Centre context required', code: 'system_bank.centre_context_required' });
    return slug;
  }

  private async editor(actorId: string): Promise<void> {
    await this.evaluator.requireCapability(actorId, 'systembank:review', (await this.contexts.ensureSystemContext()).id);
  }

  private async teacher(actorId: string): Promise<void> {
    if (!tenantAls.getStore()?.tenantId || !(await this.evaluator.hasCapabilityFromRealAssignmentAnywhere(actorId, 'contentbank:upload'))) {
      throw new ForbiddenException({ message: 'Material library access denied', code: 'access.capability_denied' });
    }
  }

  private assertPublicExternalReference(externalUrl: string): void {
    let url: URL;
    try { url = new URL(externalUrl); } catch { this.invalid(); }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['https:', 'http:'].includes(url.protocol)
      || url.username || url.password || isIP(host)
      || host === 'localhost' || /\.(?:localhost|local|internal|home\.arpa)$/.test(host)) this.invalid();
    const configuredBase = process.env.BETTER_AUTH_URL;
    if (configuredBase) {
      let baseHost: string;
      try { baseHost = new URL(configuredBase).hostname.toLowerCase(); } catch { this.invalid(); }
      if (host === baseHost || host.endsWith(`.${baseHost}`)) this.invalid();
    }
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { this.invalid(); }
    if (/(?:^|\/)(?:api|files?|courses?|content-bank|private|storage|students?|login|sign-?in|auth|sessions?)(?:\/|$)/i.test(path)) this.invalid();
    if ([...url.searchParams.keys()].some((key) => /^(?:token|access_token|auth|authorization|session|sessionid|sig|signature|expires|x-amz-.*)$/i.test(key))) this.invalid();
  }

  async sources(actorId: string) {
    await this.manager(actorId);
    return this.library.listFor(actorId);
  }

  async submit(actorId: string, contentId: string) {
    const centreSlug = await this.manager(actorId);
    const row = await this.library.get(contentId);
    if (row.questionCategoryId || (!row.fileId && !row.externalUrl)) this.invalid();
    let file: SystemMaterialPackage['file'] = null;
    if (row.fileId) {
      const owned = await this.files.getFile(row.fileId);
      if (owned.contextId !== row.contextId || owned.component !== 'core_contentbank' || owned.itemId !== row.id) this.invalid();
      const { data } = await this.files.readContent(owned.id);
      if (sha256Hex(data) !== owned.contentHash || data.length !== owned.fileSize) this.invalid();
      await this.storage.put(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(owned.contentHash), data);
      file = { contentHash: owned.contentHash, fileName: owned.fileName, mimeType: owned.mimeType ?? 'application/octet-stream', fileSize: data.length };
    }
    const externalUrl = file ? null : row.externalUrl;
    if (externalUrl) this.assertPublicExternalReference(externalUrl);
    const parsed = systemMaterialPackageSchema.safeParse({
      name: row.name, resourceType: row.resourceType, description: row.description,
      language: row.language, subjectId: row.subjectId, grade: row.grade, level: row.level,
      curriculumNodeId: row.curriculumNodeId, outcomeIds: row.outcomeIds ?? [], file, externalUrl,
      source: { centreSlug, contentId, originalAuthor: row.originalAuthor, sourceKind: row.sourceKind,
        sourceCitation: row.sourceCitation, license: row.license },
    });
    if (!parsed.success) this.invalid();
    let submission;
    try {
      submission = await this.repo.submit(actorId, parsed.data, checksumPackage(parsed.data));
    } catch (error) {
      if (error instanceof Error && error.message === 'system_material.source_withdrawn') {
        throw new ConflictException({ code: 'system_material.source_withdrawn' });
      }
      throw error;
    }
    if (submission.status === 'rejected') throw new ConflictException({ message: 'Change the source before resubmitting', code: 'system_bank.submission_rejected_requires_new_version' });
    return submission;
  }

  async mine(actorId: string) { return this.repo.submissions(await this.manager(actorId)); }

  async pending(actorId: string) { await this.editor(actorId); return this.repo.submissions(); }

  async forReview(actorId: string, id: string) {
    await this.editor(actorId);
    const row = await this.repo.submission(id);
    if (!row) this.notFound();
    return row;
  }

  async review(actorId: string, id: string, reason?: string) {
    const row = await this.forReview(actorId, id);
    if ((reason && row.status === 'approved') || (!reason && row.status === 'rejected')) {
      throw new ConflictException({ message: 'Submission already reviewed', code: 'system_bank.submission_reviewed' });
    }
    if (!reason) {
      const pkg = this.verified(row.package, row.checksum);
      if (pkg.file) await this.readFile(pkg);
    }
    let reviewed;
    try {
      reviewed = await this.repo.review(id, actorId, reason);
    } catch (error) {
      if (error instanceof Error && error.message === 'system_material.source_withdrawn') {
        throw new ConflictException({ code: 'system_material.source_withdrawn' });
      }
      throw error;
    }
    if (!reviewed || (reason ? reviewed.status !== 'rejected' : reviewed.status !== 'approved')) {
      throw new ConflictException({ message: 'Submission already reviewed', code: 'system_bank.submission_reviewed' });
    }
    return reviewed;
  }

  async discover(actorId: string) { await this.teacher(actorId); return this.repo.discover(); }

  async publishedForReview(actorId: string) { await this.editor(actorId); return this.repo.discover(); }

  async listUsed(actorId: string) {
    await this.teacher(actorId);
    const references = await this.references.list();
    return Promise.all(references.map(async (reference) => ({
      ...reference,
      sourceStatus: (await this.repo.status(reference.materialId)) ?? 'unavailable',
      latestVersion: await this.repo.latestVersion(reference.materialId),
    })));
  }

  async withdraw(actorId: string, materialId: string, reason: string) {
    await this.editor(actorId);
    const result = await this.repo.withdraw(materialId, reason);
    if (!result) throw new ConflictException({ code: 'system_material.not_published' });
    return result;
  }

  async versionForTeacher(actorId: string, materialId: string, version: number) {
    await this.teacher(actorId);
    const status = await this.repo.status(materialId);
    if (status === 'withdrawn' && !(await this.references.hasVersion(materialId, version))) this.notFound();
    return this.version(materialId, version);
  }

  private async version(materialId: string, version: number): Promise<SystemMaterialVersion> {
    const row = await this.repo.version(materialId, version);
    if (!row) this.notFound();
    return { ...row, package: this.verified(row.package, row.checksum) };
  }

  async use(actorId: string, input: UseSystemMaterial) {
    await this.teacher(actorId);
    await this.courses.getCourse(input.courseId);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courses.courseContextId(input.courseId));
    const row = await this.versionForTeacher(actorId, input.materialId, input.version);
    const id = await this.references.insert(input.courseId, row.package.name, row);
    let createdCmId: string | undefined;
    try {
      const cm = await this.courses.createCm(actorId, input.courseId, {
        sectionId: input.sectionId, component: 'mod_resource', instanceId: id, name: row.package.name,
        completion: row.package.file ? 1 : 0, completionManual: Boolean(row.package.file),
      });
      createdCmId = cm.id;
      await this.references.attach(id, cm.id);
      return { resourceId: id, cmId: cm.id, materialId: input.materialId, version: input.version, checksum: row.checksum };
    } catch (error) {
      if (createdCmId) await this.courses.deleteCm(actorId, createdCmId);
      await this.references.remove(id);
      throw error;
    }
  }

  reference(resourceId: string) { return this.references.get(resourceId); }

  async forCourse(actorId: string, resource: { id: string; course: string; cmId: string | null }, reference?: SystemMaterialReference) {
    await this.courses.assertCourseAccess(actorId, resource.course);
    if (!resource.cmId) this.notFound();
    const cm = await this.courses.getCm(resource.cmId);
    if (cm.instanceId !== resource.id || cm.course !== resource.course || cm.component !== 'mod_resource') this.notFound();
    if (!(await this.courses.checkCmAccess(actorId, cm)).available) {
      throw new ForbiddenException({ message: 'Activity unavailable', code: 'availability.not_available' });
    }
    const pin = reference ?? await this.references.get(resource.id);
    if (!pin) this.notFound();
    const row = await this.version(pin.materialId, pin.version);
    if (row.checksum !== pin.checksum) this.invalid();
    return row;
  }

  async preview(actorId: string, id: string, version?: number) {
    const row = version === undefined ? await this.forReview(actorId, id) : await this.versionForTeacher(actorId, id, version);
    return this.readFile(this.verified(row.package, row.checksum));
  }

  async readFile(pkg: SystemMaterialPackage) {
    if (!pkg.file) this.notFound();
    const data = await this.storage.get(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(pkg.file.contentHash));
    if (sha256Hex(data) !== pkg.file.contentHash || data.length !== pkg.file.fileSize) this.invalid();
    return { data, file: pkg.file };
  }

  private verified(value: unknown, checksum: string): SystemMaterialPackage {
    const parsed = systemMaterialPackageSchema.safeParse(value);
    if (!parsed.success || checksumPackage(parsed.data) !== checksum) this.invalid();
    return parsed.data;
  }

  private invalid(): never { throw new BadRequestException({ message: 'Invalid material package or media', code: 'system_material.invalid_package' }); }

  private notFound(): never { throw new NotFoundException({ message: 'Material not found', code: 'system_material.not_found' }); }
}
