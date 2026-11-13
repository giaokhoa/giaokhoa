import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { FilesRepository, type FileRow } from '@giaokhoa/db/repositories/files';
import { FileSigningService } from './file-signing.service';
import { OBJECT_STORAGE, sha256Hex, type ObjectStorage } from './storage';
import { Inject } from '@nestjs/common';
import { fileDomainForSpace, LEGACY_FILE_DOMAIN, SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { tenantAls } from '../tenants/tenant-als';

export const FILE_CLEANUP_QUEUE = 'file-cleanup';
export interface UploadInput {
  contextId: string; component: string; fileArea: string; itemId?: string;
  filePath?: string; fileName: string; data: Buffer; mimeType?: string; userId?: string;
}

/** Trần dung lượng cho MỘT ảnh nhúng trong nội dung câu hỏi (8 MB — ngang bản gốc giaokhoa). */
export const QUESTION_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Định danh bền của một file trong nội dung rich text: đường content có gác quyền của chính module files. Nội dung câu hỏi lưu dạng này (không lưu URL ký — URL ký hết hạn sau 300 giây); khi phục vụ người đọc, tầng phục vụ gọi `resolveQuestionImageUrls` để thay bằng URL ký còn hạn.
 */
export function questionFileContentSrc(fileId: string): string {
  return `/api/v1/files/${fileId}/content`;
}
export const QUESTION_FILE_CONTENT_SRC_PATTERN = /^\/api\/v1\/files\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/content$/;

/**
 * Nhận diện loại ảnh raster bằng MAGIC BYTES của chính nội dung — không tin
 * mimetype do client khai (bài học từ bản gốc giaokhoa: chỉ tin byte thật).
 * Trả null khi không phải PNG/JPEG/WebP/GIF.
 */
export function sniffImageMimeType(data: Buffer): string | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (data.length >= 6 && data.subarray(0, 4).toString('ascii') === 'GIF8'
    && (data[4] === 0x37 || data[4] === 0x39) && data[5] === 0x61) return 'image/gif';
  return null;
}

/**
 * Facade của FilesModule (Moodle core_files). Các bản ghi logic trong `files` trỏ tới
 * các byte vật lý được định địa chỉ theo nội dung; nội dung giống hệt chỉ được lưu một lần TRONG CÙNG MIỀN, không gộp giữa các kho. File không bao giờ public theo đường dẫn: một lần
 * tải xuống yêu cầu kiểm tra capability của context file trước, rồi hoặc dùng một
 * URL đã ký ngắn hạn hoặc một luồng stream có guard.
 */
@Injectable()
/**
 * Dịch vụ file kiểu Moodle: upload, dedup theo contentHash, tải xuống theo quyền context,
 * URL ký tạm thời và dọn nội dung vật lý khi refcount về 0.
 * Đối chiếu Moodle: lib/filelib.php và files/classes (file_storage).
 */
export class FilesService {
  constructor(
    private readonly repo: FilesRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly evaluator: PermissionEvaluator,
    private readonly signing: FileSigningService,
    @InjectQueue(FILE_CLEANUP_QUEUE) private readonly cleanupQueue: Queue,
    @Optional() private readonly spaceDb?: SpaceDatabaseService,
  ) {}

  /**
   * Tải file lên: kiểm quyền tại context, tính hash, lưu nội dung (dedup) + metadata.
   */
  async upload(input: UploadInput): Promise<FileRow> {
    if (!input.fileName || input.fileName.includes('/') || input.fileName.includes('\\')) {
      throw new BadRequestException({ message: 'Invalid filename', code: 'file.invalid_filename' });
    }
    const contentHash = sha256Hex(input.data);
    const storageDomain = await this.currentStorageDomain();
    await this.storage.put(storageDomain, contentHash, input.data); // put() chỉ dedupe trong cùng miền
    return this.repo.insert({
      contentHash, storageDomain, contextId: input.contextId, component: input.component, fileArea: input.fileArea,
      itemId: input.itemId ?? null, filePath: input.filePath ?? '/', fileName: input.fileName,
      userId: input.userId, fileSize: input.data.length, mimeType: input.mimeType,
    });
  }

  /**
   * Tải MỘT ảnh nhúng cho nội dung câu hỏi (component 'question'): kiểm dung
   * lượng và loại ảnh bằng magic bytes TRƯỚC khi chạm kho lưu trữ — file
   * không phải ảnh raster bị từ chối dù đuôi tên/mimetype khai là ảnh.
   * Quyền tại context đích do controller gác bằng cổng files:upload như mọi
   * đường tải lên khác.
   */
  async uploadQuestionImage(input: {
    contextId: string; fileArea: string; itemId?: string;
    fileName: string; data: Buffer; userId?: string;
  }): Promise<FileRow> {
    if (input.data.length === 0) {
      throw new BadRequestException({ message: 'Empty file', code: 'file.empty' });
    }
    if (input.data.length > QUESTION_IMAGE_MAX_BYTES) {
      throw new BadRequestException({ message: 'Question image exceeds 8 MB', code: 'file.image_too_large' });
    }
    const mimeType = sniffImageMimeType(input.data);
    if (!mimeType) {
      throw new BadRequestException({ message: 'Only PNG, JPEG, WebP or GIF images are allowed in question content', code: 'file.not_image' });
    }
    return this.upload({
      contextId: input.contextId, component: 'question', fileArea: input.fileArea,
      itemId: input.itemId, fileName: input.fileName, data: input.data, mimeType, userId: input.userId,
    });
  }

  /**
   * Thay các node ảnh trong một tài liệu rich text (hoặc cấu trúc lồng nhau
   * bất kỳ chứa tài liệu) có `src` là định danh bền của file câu hỏi bằng URL
   * ký còn hạn. CHỈ dùng ở các bề mặt đã tự gác quyền đọc câu hỏi cho người
   * xem (chi tiết câu hỏi cho người đọc, view bài làm) — hàm này KHÔNG tự
   * kiểm files:view tại context của file, vì người đọc hợp lệ của một câu
   * (học sinh đang làm bài) không có quyền tại context bank của giáo viên;
   * cổng của bề mặt phục vụ thay thế cổng đó. File không tồn tại hoặc không
   * thuộc component 'question' thì giữ nguyên src.
   */
  async resolveQuestionImageUrls<T>(doc: T): Promise<T> {
    if (doc === null || typeof doc !== 'object') return doc;
    const clone = structuredClone(doc);
    const imageAttrs: Record<string, unknown>[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (value && typeof value === 'object') {
        const rec = value as Record<string, unknown>;
        if (rec.type === 'image' && rec.attrs && typeof rec.attrs === 'object') {
          const attrs = rec.attrs as Record<string, unknown>;
          if (typeof attrs.src === 'string' && QUESTION_FILE_CONTENT_SRC_PATTERN.test(attrs.src)) imageAttrs.push(attrs);
        }
        Object.values(rec).forEach(walk);
      }
    };
    walk(clone);
    await Promise.all(imageAttrs.map(async (attrs) => {
      const match = QUESTION_FILE_CONTENT_SRC_PATTERN.exec(attrs.src as string);
      if (!match) return;
      const file = await this.repo.getById(match[1]);
      if (!file || file.component !== 'question' || !(await this.canAccessDomain(file))) return;
      const target = await this.signing.createDownloadTarget(await this.fileForSigning(file));
      attrs.src = target.url;
    }));
    return clone;
  }

  /**
   * Lấy metadata file; ném files.not_found khi vắng.
   */
  async getFile(id: string): Promise<FileRow> {
    const row = await this.repo.getById(id);
    if (!row || !(await this.canAccessDomain(row))) throw new NotFoundException({ message: `File ${id} not found`, code: 'file.not_found' });
    return row;
  }
  /**
   * Miền vật lý lấy từ ID bất biến của sổ trung tâm (khu công cộng có ID riêng).
   * Không dùng hostname/slug trong khoá; mất sổ khi đã có slug thì fail-closed.
   */
  private async currentStorageDomain(): Promise<string> {
    const slug = tenantAls.getStore()?.spaceSlug;
    if (!slug) return SYSTEM_FILE_DOMAIN;
    if (!this.spaceDb) throw new Error('file.space_resolver_missing');
    const target = await this.spaceDb.resolveTarget(slug);
    return fileDomainForSpace(target.spaceId);
  }

  /**
   * Hàng legacy trước migration không có miền vật lý: byte vẫn nằm tại
   * bố cục hash cũ. Chỉ khôi phục quyền đọc của context gốc nếu đúng
   * tenant sở hữu; không coi mọi file legacy là của Trang chính.
   *
   * Request ở host trung tâm phải khớp tenant mang slug đã xác nhận
   * trong sổ; đọc tenant qua đúng handle định tuyến trong scope
   * platform TẠM THỜI (không cấp scope này cho caller).
   * Chữ ký URL và capability vẫn được kiểm tra ở lớp gọi.
   */
  private async canReadLegacy(file: FileRow): Promise<boolean> {
    if (typeof this.repo.getContextTenantId !== 'function') return false;
    const ownerId = await this.repo.getContextTenantId(file.contextId);
    if (ownerId === undefined) return false; // context không tồn tại
    const store = tenantAls.getStore();
    const slug = store?.spaceSlug;
    if (!slug) {
      // Trên host gốc, chỉ cấp cho context toàn cục hoặc đúng tenant
      // hiệu lực đã được TenantGuard xác minh; không có phiên thì không
      // được đoán chủ sở hữu của một context trung tâm.
      return ownerId === null || (!!store?.tenantId && ownerId === store.tenantId);
    }
    if (!this.spaceDb) return false;
    const target = await this.spaceDb.resolveTarget(slug);
    // Đối chiếu chủ thật trong database đích, không dựa vào tên miền
    // tự khai hoặc tenantId của khách ẩn danh tải qua URL có chữ ký.
    const tenant = await tenantAls.run({ platform: true, spaceSlug: slug, spaceId: store?.spaceId }, async () =>
      this.spaceDb!.routedKysely.selectFrom('tenants')
        .select(['id', 'kind']).where('slug', '=', slug).executeTakeFirst(),
    );
    if (!tenant) return false;
    if (ownerId === tenant.id) return true;
    // Kho riêng chỉ có thể chứa context toàn cục của chính kho đó.
    // Kho chung tuyệt đối không dùng context toàn cục để vượt miền.
    return ownerId === null && target.mode === 'dedicated';
  }

  /**
   * Legacy giữ key vật lý cũ để tương thích, nhưng chữ ký HMAC phải
   * mang miền sở hữu ĐANG PHỤC VỤ. Không tái sử dụng chữ ký legacy ở
   * một host khác, kể cả khi hai database có cùng file id.
   */
  private async fileForSigning(file: FileRow): Promise<FileRow & { signingDomain?: string }> {
    return file.storageDomain === LEGACY_FILE_DOMAIN
      ? { ...file, signingDomain: await this.currentStorageDomain() }
      : file;
  }

  /** Chặn metadata từ miền khác, kể cả các trung tâm dùng chung database. */
  private async canAccessDomain(file: FileRow): Promise<boolean> {
    if (file.storageDomain === LEGACY_FILE_DOMAIN) return this.canReadLegacy(file);
    return file.storageDomain === await this.currentStorageDomain();
  }

  /** Số tham chiếu đúng miền sở hữu, không gộp file khác kho có cùng hash. */
  async refcount(contentHash: string): Promise<number> {
    return this.repo.countByHash(contentHash, await this.currentStorageDomain());
  }
  /**
   * Khoá lưu trữ vật lý suy từ miền sở hữu và contentHash.
   */
  physicalKey(contentHash: string, storageDomain = SYSTEM_FILE_DOMAIN): string { return this.storage.keyFor(storageDomain, contentHash); }
  /**
   * Nội dung vật lý còn trên kho lưu trữ hay không.
   */
  async physicalExists(contentHash: string, storageDomain = SYSTEM_FILE_DOMAIN): Promise<boolean> { return this.storage.exists(storageDomain, contentHash); }

  /**
   * Xoá bản ghi file; enqueue job chỉ khi refcount của cùng miền về 0.
   *
   * Luồng: lấy bản ghi → (khi có `actor`) áp chốt khoá bài nộp → xoá bản
   * ghi → đếm lại tham chiếu cùng miền và contentHash: còn tham chiếu
   * thì byte vật lý giữ nguyên; refcount về 0 thì enqueue job cho worker.
   * JobId gắn với ID bản ghi vừa xoá: khử trùng cùng sự kiện nhưng cho
   * phép dọn lại khi nội dung trùng được tải lên rồi xoá ở vòng sau.
   *
   * Hai chế độ xoá, phân biệt bằng tham số `actor`:
   * - **Người dùng khởi tạo** (handler `DELETE /files/:id` truyền
   *   `actor`): nếu tệp đang gắn với một bài nộp, khoá bài nộp được áp
   *   ngay tại đây qua {@link assertSubmissionLockForDelete}. Điểm chốt
   *   phải nằm ở đường xoá dùng chung này vì đây là đường mọi yêu cầu
   *   xoá của người dùng đều đi qua: chỉ gác ở route của module Bài tập
   *   thì một yêu cầu trực tiếp tới endpoint tệp dùng chung sẽ vượt qua
   *   toàn bộ chốt sở hữu/trạng thái của bài nộp.
   * - **Hệ thống nội bộ** (không truyền `actor`): các luồng dọn dẹp đã
   *   có cổng riêng ở tầng gọi (xoá bài tập kèm dọn tệp, gỡ tệp bài nộp
   *   qua route của module Bài tập sau khi đã qua chốt của chính module
   *   đó, listener sự kiện vòng đời course module, xoá dữ liệu riêng
   *   tư, dọn tệp quét của module chấm giấy) — giữ nguyên hành vi xoá
   *   vô điều kiện như trước.
   *
   * @param id id bản ghi tệp cần xoá.
   * @param actor người dùng khởi tạo yêu cầu xoá; vắng mặt = xoá nội bộ
   * của hệ thống.
   * @returns contentHash của tệp và refcount sau khi xoá.
   * @throws NotFoundException `file.not_found` khi tệp không tồn tại;
   * các mã lỗi của chốt bài nộp xem {@link assertSubmissionLockForDelete}.
   */
  async deleteFile(id: string, actor?: { id: string }): Promise<{ deleted: true; contentHash: string; refcount: number }> {
    const row = await this.getFile(id);
    if (actor) await this.assertSubmissionLockForDelete(row, actor);
    await this.repo.deleteById(id);
    const refcount = await this.repo.countByHash(row.contentHash, row.storageDomain);
    if (refcount === 0 && row.storageDomain !== LEGACY_FILE_DOMAIN) {
      const spaceSlug = tenantAls.getStore()?.spaceSlug;
      await this.cleanupQueue.add(
        'cleanup-orphan',
        { contentHash: row.contentHash, storageDomain: row.storageDomain, ...(spaceSlug ? { spaceSlug } : {}) },
        // ID của lần xóa (file record) khử trùng job cùng sự kiện,
        // nhưng không chặn cleanup của lần upload/xóa mới có cùng hash.
        { jobId: ['orphan', row.storageDomain, row.contentHash, row.id].join('-'), attempts: 3 },
      );
    }
    return { deleted: true, contentHash: row.contentHash, refcount };
  }

  /**
   * Chốt khoá bài nộp cho đường xoá tệp do người dùng khởi tạo: tệp đang
   * gắn với một bài nộp thì chỉ được xoá khi vượt qua đúng ba chốt mà
   * module Bài tập áp ở đường gỡ tệp của chính nó
   * (`AssignmentsService.removeSubmissionFile`), theo đúng thứ tự và mã
   * lỗi của đường đó:
   *
   * 1. **Sở hữu:** bài nộp chứa tệp phải là của chính người gọi. Đường
   *    Bài tập tra bài nộp theo người gọi nên tệp của người khác không
   *    bao giờ tới được bước gỡ; tại đây điều đó tương ứng lỗi
   *    `assign.submission_file_not_found` (404) — tệp không thuộc bài
   *    nộp nào của người gọi.
   * 2. **Đã trả bài:** gói chấm thuộc lần nộp hiện hành của bài nộp
   *    (attempt number khớp) đã ở trạng thái `released` thì ném
   *    `assign.already_graded` (409) — bài đã trả là chứng cứ chấm,
   *    khoá hẳn.
   * 3. **Đã chốt nộp:** bài nộp không ở trạng thái `draft` thì ném
   *    `assign.submission_finalized` (409) — muốn đổi tệp phải mở lại
   *    bài nộp về nháp trước.
   *
   * Bài nộp chứa tệp được xác định bằng dòng liên kết trong
   * `assign_submission_files`; phòng khi dòng liên kết vắng mặt, bản
   * ghi tệp tự khai là tệp bài nộp (component `mod_assign`, file area
   * `submission_files`, item id là id bài nộp) cũng được tra trực tiếp
   * tới bài nộp đó. Tệp không gắn bài nộp nào thì hàm này không chặn
   * gì — hành vi xoá giữ nguyên như trước.
   */
  private async assertSubmissionLockForDelete(file: FileRow, actor: { id: string }): Promise<void> {
    const linked = await this.repo.listSubmissionLinks(file.id);
    const submissions = new Map(linked.map((s) => [s.submissionId, s]));
    if (file.component === 'mod_assign' && file.fileArea === 'submission_files' && file.itemId && !submissions.has(file.itemId)) {
      const byItem = await this.repo.getSubmission(file.itemId);
      if (byItem) submissions.set(byItem.submissionId, byItem);
    }
    for (const s of submissions.values()) {
      if (s.userId !== actor.id) {
        throw new NotFoundException({ message: `File ${file.id} is not part of this submission`, code: 'assign.submission_file_not_found' });
      }
      const grade = await this.repo.getGradeForSubmission(s.assignmentId, s.userId);
      if (grade && grade.attemptNumber === s.attemptNumber && grade.status === 'released') {
        throw new ConflictException({ message: 'Submission has been returned and is locked', code: 'assign.already_graded' });
      }
      if (s.status !== 'draft') {
        throw new ConflictException({ message: 'Submission is finalized; reopen it before changing files', code: 'assign.submission_finalized' });
      }
    }
  }

  /** Phía worker: chỉ xoá byte vật lý nếu hash vẫn không còn ai tham chiếu tại thời điểm thực thi. */
  /**
   * Dọn một nội dung vật lý mồ côi theo hash (worker file-cleanup gọi).
   */
  async cleanupOrphan(contentHash: string, storageDomain?: string): Promise<boolean> {
    const domain = storageDomain ?? await this.currentStorageDomain();
    if (domain === LEGACY_FILE_DOMAIN) throw new Error('file.legacy_cleanup_forbidden');
    if ((await this.repo.countByHash(contentHash, domain)) > 0) return false;
    await this.storage.delete(domain, contentHash);
    return true;
  }

  /**
   * Kiểm quyền xem file tại context của nó.
   */
  async assertCanView(file: FileRow, actor: { id: string; username?: string }): Promise<void> {
    await this.evaluator.requireCapability(actor.id, 'files:view', file.contextId, { isGuest: actor.username === 'guest' });
  }
  /**
   * Kiểm quyền tải file lên context đích.
   */
  async assertCanUpload(contextId: string, actor: { id: string; username?: string }): Promise<void> {
    await this.evaluator.requireCapability(actor.id, 'files:upload', contextId, { isGuest: actor.username === 'guest' });
  }

  /** Cấp URL đã ký có kiểm tra capability: việc kiểm tra diễn ra TẠI ĐÂY (phía server), chữ ký chỉ vận chuyển kết quả trong thời gian ngắn.
   * Bản thân việc cấp được uỷ quyền cho FileSigningService, service này trả về URL presigned của S3 khi
   * adapter lưu trữ hỗ trợ (driver=s3) và trả về URL API kiểu HMAC trong trường hợp còn lại (driver=local, không đổi). */
  /**
   * Tạo URL tải có ký + hạn dùng (presigned khi driver S3, HMAC khi local).
   */
  async createSignedUrl(fileId: string, userId: string, isGuest = false): Promise<{ url: string; expiresAt: number }> {
    const file = await this.getFile(fileId);
    await this.evaluator.requireCapability(userId, 'files:view', file.contextId, { isGuest });
    return this.signing.createDownloadTarget(await this.fileForSigning(file));
  }
  /**
   * Kiểm chữ ký URL (ủy quyền cho FileSigningService).
   */
  async verifySignature(fileId: string, token: string | undefined): Promise<void> {
    const file = await this.getFile(fileId);
    const domain = file.storageDomain === LEGACY_FILE_DOMAIN
      ? await this.currentStorageDomain() : file.storageDomain;
    this.signing.verify(fileId, domain, token);
  }
  /**
   * Đọc nội dung file (sau kiểm quyền) để trả về/tải xuống.
   */
  async readContent(fileId: string): Promise<{ file: FileRow; data: Buffer }> {
    const file = await this.getFile(fileId);
    const data = await this.storage.get(file.storageDomain, file.contentHash);
    return { file, data };
  }
  /**
   * Liệt kê file trong context.
   */
  async listByContext(contextId: string): Promise<FileRow[]> { const rows = await this.repo.listByContext(contextId); const matches = await Promise.all(rows.map(async (file) => (await this.canAccessDomain(file)) ? file : null)); return matches.filter((row): row is FileRow => row !== null); }
}
