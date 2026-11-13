/**
 * Luồng học liệu riêng → quản trị gửi → hệ thống duyệt → giáo viên ghim
 * phiên bản vào khoá. Byte công bố có miền/khoá riêng; mọi đường học viên
 * đọc nội dung hoặc media đều kiểm tra lại khoá, module và audience.
 */
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

/** Điều phối hai kho theo từng thao tác độc lập; không mở giao dịch đồng thời trên hai handle. */
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

  /** Cổng quản trị trung tâm, tách quyền gửi khỏi quyền biên tập hệ thống. */
  private async manager(actorId: string): Promise<string> {
    const tenantId = tenantAls.getStore()?.tenantId;
    const context = tenantId ? await this.contexts.getTenantContext(tenantId) : null;
    if (!tenantId || !context) throw new ForbiddenException({ message: 'Centre context required', code: 'system_bank.centre_context_required' });
    await this.evaluator.requireCapability(actorId, 'tenant:manage', context.id);
    const slug = tenantAls.getStore()?.spaceSlug ?? await this.centre.resolveTenantSlug(tenantId);
    if (!slug) throw new ForbiddenException({ message: 'Centre context required', code: 'system_bank.centre_context_required' });
    return slug;
  }

  /** Người duyệt phải có systembank:review tại hệ thống trước khi đọc bản chụp. */
  private async editor(actorId: string): Promise<void> {
    await this.evaluator.requireCapability(actorId, 'systembank:review', (await this.contexts.ensureSystemContext()).id);
  }

  /** Giáo viên có gán vai thật cho quyền dùng kho; học sinh không đọc qua id phiên bản/media ngân hàng. */
  private async teacher(actorId: string): Promise<void> {
    if (!tenantAls.getStore()?.tenantId || !(await this.evaluator.hasCapabilityFromRealAssignmentAnywhere(actorId, 'contentbank:upload'))) {
      throw new ForbiddenException({ message: 'Material library access denied', code: 'access.capability_denied' });
    }
  }

  /**
   * Liên kết công bố chỉ là tham chiếu web ngoài, không phải byte bất biến.
   * Loại nguồn nội bộ/đường riêng, host nội bộ và URL có token phiên; chỉ
   * tài liệu upload mới được sao byte vào ngân hàng bảo đảm tồn tại độc lập.
   */
  private assertPublicExternalReference(externalUrl: string): void {
    let url: URL;
    try { url = new URL(externalUrl); } catch { this.invalid(); }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['https:', 'http:'].includes(url.protocol)
      || url.username || url.password || isIP(host)
      || host === 'localhost' || /\.(?:localhost|local|internal|home\.arpa)$/.test(host)) this.invalid();
    // Host gốc và các tên miền con của hệ là nguồn do trung tâm kiểm soát;
    // không nhận URL này thay cho bản sao tệp công bố.
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

  /** Danh sách nguồn cùng tenant cho quản trị, kể cả học liệu riêng của giáo viên khác. */
  async sources(actorId: string) {
    await this.manager(actorId);
    return this.library.listFor(actorId);
  }

  /**
   * Chụp metadata và byte ngay khi gửi. Không công bố category câu hỏi hoặc
   * URL nội bộ có thể bị thu hồi; tác giả/nguồn/giấy phép phải tự đủ.
   * @throws BadRequestException nếu nguồn không tự đủ hoặc media sai chủ sở hữu/hash.
   */
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
    const submission = await this.repo.submit(actorId, parsed.data, checksumPackage(parsed.data));
    if (submission.status === 'rejected') throw new ConflictException({ message: 'Change the source before resubmitting', code: 'system_bank.submission_rejected_requires_new_version' });
    return submission;
  }

  /** Lịch sử chỉ thuộc tenant đang gửi; không cho quản trị A xem bản gửi B. */
  async mine(actorId: string) { return this.repo.submissions(await this.manager(actorId)); }

  /** Hàng chờ hệ thống chỉ trả sau cổng biên tập. */
  async pending(actorId: string) { await this.editor(actorId); return this.repo.submissions(); }

  /** Đọc ID bản gửi qua cổng biên tập, kể cả khi đã duyệt hoặc từ chối. */
  async forReview(actorId: string, id: string) {
    await this.editor(actorId);
    const row = await this.repo.submission(id);
    if (!row) this.notFound();
    return row;
  }

  /** Duyệt kiểm lại package, checksum và byte; quyết định cũ không bị thay khi retry. */
  async review(actorId: string, id: string, reason?: string) {
    const row = await this.forReview(actorId, id);
    if ((reason && row.status === 'approved') || (!reason && row.status === 'rejected')) {
      throw new ConflictException({ message: 'Submission already reviewed', code: 'system_bank.submission_reviewed' });
    }
    if (!reason) {
      const pkg = this.verified(row.package, row.checksum);
      if (pkg.file) await this.readFile(pkg);
    }
    const reviewed = await this.repo.review(id, actorId, reason);
    if (!reviewed || (reason ? reviewed.status !== 'rejected' : reviewed.status !== 'approved')) {
      throw new ConflictException({ message: 'Submission already reviewed', code: 'system_bank.submission_reviewed' });
    }
    return reviewed;
  }

  /** Khám phá các phiên bản đã duyệt; quyền kho không tự cấp quyền học viên. */
  async discover(actorId: string) { await this.teacher(actorId); return this.repo.discover(); }

  /** Giáo viên đọc đúng phiên bản đã chọn, không có route cập nhật bản công bố. */
  async versionForTeacher(actorId: string, materialId: string, version: number) {
    await this.teacher(actorId);
    return this.version(materialId, version);
  }

  /** Đọc và xác minh phiên bản cho cổng giáo viên hoặc cổng khoá đã kiểm quyền. */
  private async version(materialId: string, version: number): Promise<SystemMaterialVersion> {
    const row = await this.repo.version(materialId, version);
    if (!row) this.notFound();
    return { ...row, package: this.verified(row.package, row.checksum) };
  }

  /**
   * Ghim phiên bản vào một vỏ mod_resource. Chỉ ghi dấu tiếp nhận ở trung tâm;
   * không thêm importer, courseId hay userId của người học vào bank-system.
   */
  async use(actorId: string, input: UseSystemMaterial) {
    await this.teacher(actorId);
    await this.courses.getCourse(input.courseId);
    await this.evaluator.requireCapability(actorId, 'course:manageactivities', await this.courses.courseContextId(input.courseId));
    const row = await this.version(input.materialId, input.version);
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
      /** Nếu gắn instance thất bại, dọn cả module/context qua đúng luồng sự kiện của khoá. */
      if (createdCmId) await this.courses.deleteCm(actorId, createdCmId);
      await this.references.remove(id);
      throw error;
    }
  }

  /** Trả pin để ContentService ngăn sửa nội dung của bản tiếp nhận. */
  reference(resourceId: string) { return this.references.get(resourceId); }

  /**
   * Gác khoá và availability (gồm nhóm, section ẩn, module ẩn/lịch mở) trước
   * mọi lần đọc từ ngân hàng; URL media của học sinh đi qua chính cổng này.
   */
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

  /** Media xem trước chỉ đọc sau cổng biên tập hoặc giáo viên, không có URL public/HMAC dùng lại giữa người xem. */
  async preview(actorId: string, id: string, version?: number) {
    const row = version === undefined ? await this.forReview(actorId, id) : await this.versionForTeacher(actorId, id, version);
    return this.readFile(this.verified(row.package, row.checksum));
  }

  /** Xác minh byte độc lập và metadata trước khi phục vụ, kể cả sau khi nguồn bị dọn. */
  async readFile(pkg: SystemMaterialPackage) {
    if (!pkg.file) this.notFound();
    const data = await this.storage.get(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(pkg.file.contentHash));
    if (sha256Hex(data) !== pkg.file.contentHash || data.length !== pkg.file.fileSize) this.invalid();
    return { data, file: pkg.file };
  }

  /** Checksum dùng canonical JSON chung của ngân hàng, ổn định qua thứ tự khoá JSONB. */
  private verified(value: unknown, checksum: string): SystemMaterialPackage {
    const parsed = systemMaterialPackageSchema.safeParse(value);
    if (!parsed.success || checksumPackage(parsed.data) !== checksum) this.invalid();
    return parsed.data;
  }

  /** Lỗi ổn định được catalog i18n dịch ở biên HTTP. */
  private invalid(): never { throw new BadRequestException({ message: 'Invalid material package or media', code: 'system_material.invalid_package' }); }

  /** Không tiết lộ nội dung khi ID hoặc phiên bản không tồn tại. */
  private notFound(): never { throw new NotFoundException({ message: 'Material not found', code: 'system_material.not_found' }); }
}
