import { createHash, randomUUID } from 'node:crypto';
import {
  fileIdSchema,
  fileRefSchema,
  MAX_FILE_BYTES,
  tikzFileSourceSchema,
  type FileMimeType,
  type FileRef,
  type TikzFileSource,
} from '@giaokhoa/shared/files';
import { imageSize } from 'image-size';
import type { AuthorizationService } from '../authorization/service.js';
import { ClientError } from '../common/client-error.js';
import type { FilesRepository } from './repository.js';
import type { FileStorage } from './storage.js';
import { sanitizeAndInspectSvg } from './svg-sanitizer.js';

const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;

const rasterImageTypes = {
  png: { mimeType: 'image/png', extension: 'png' },
  jpg: { mimeType: 'image/jpeg', extension: 'jpg' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
} as const;

const svgImageType = { mimeType: 'image/svg+xml', extension: 'svg' } as const;

export type UploadedFile = {
  buffer: Uint8Array;
  originalname: string;
  size: number;
};

export type CreatedFile = {
  fileId: string;
  variantFileId: string | null;
  width: number;
  height: number;
  mimeType: FileMimeType;
};

export type StoredFile = {
  body: Uint8Array;
  mimeType: string;
  byteSize: number;
  etag?: string;
};

function invalid(message: string): never {
  throw new ClientError('invalid', 'file_invalid', message);
}

function validateDimensions(width: number | undefined, height: number | undefined) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !width ||
    !height ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    invalid('Kích thước ảnh không hợp lệ hoặc quá lớn');
  }
  return { width, height };
}

function parseTikzSource(input: unknown): TikzFileSource | undefined {
  if (
    input === undefined ||
    input === null ||
    (typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0)
  ) {
    return undefined;
  }

  const parsed = tikzFileSourceSchema.safeParse(input);
  if (!parsed.success) invalid('Metadata TikZ không hợp lệ');
  return parsed.data;
}

function inspectOriginalImage(file: UploadedFile | undefined, sourceInput: unknown) {
  if (!file?.buffer?.length) invalid('Chưa chọn ảnh');
  if (file.size > MAX_FILE_BYTES || file.buffer.length > MAX_FILE_BYTES)
    invalid('Ảnh không được vượt quá 8 MB');

  let dimensions: ReturnType<typeof imageSize>;
  try {
    dimensions = imageSize(file.buffer);
  } catch {
    invalid('File ảnh không hợp lệ');
  }

  const source = parseTikzSource(sourceInput);
  if (dimensions.type === 'svg') {
    // SVG dựng ở trình duyệt vẫn là đầu vào không tin cậy: máy chủ yêu cầu
    // nguồn TikZ riêng và tự làm sạch dữ liệu SVG trước khi lưu.
    if (!source) invalid('SVG chỉ được tạo từ TikZ');

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      invalid('SVG phải dùng UTF-8 hợp lệ');
    }

    let inspected: ReturnType<typeof sanitizeAndInspectSvg>;
    try {
      inspected = sanitizeAndInspectSvg(text);
    } catch (cause) {
      invalid(cause instanceof Error ? cause.message : 'SVG không hợp lệ');
    }

    const sanitized = new TextEncoder().encode(inspected.svg);
    if (sanitized.length > MAX_FILE_BYTES) {
      invalid('SVG sau khi làm sạch không được vượt quá 8 MB');
    }

    const { width, height } = validateDimensions(inspected.width, inspected.height);
    return {
      file: { ...file, buffer: sanitized, size: sanitized.length },
      imageType: svgImageType,
      width,
      height,
      source,
    };
  }

  if (source) invalid('Metadata TikZ chỉ dùng được với SVG');

  const imageType = dimensions.type
    ? rasterImageTypes[dimensions.type as keyof typeof rasterImageTypes]
    : undefined;
  if (!imageType) invalid('Chỉ hỗ trợ ảnh PNG, JPEG, WebP và SVG được tạo từ TikZ');

  const { width, height } = validateDimensions(dimensions.width, dimensions.height);
  return {
    file: { ...file, size: file.buffer.length },
    imageType,
    width,
    height,
    source: undefined,
  };
}

function inspectRasterImage(file: UploadedFile | undefined) {
  const image = inspectOriginalImage(file, undefined);
  if (image.imageType.mimeType === 'image/svg+xml') {
    invalid('Không thể tạo crop variant từ SVG');
  }
  return image;
}

/** Điều phối lưu trữ nhị phân, làm sạch nội dung, kiểm tra quyền và thu gom tệp qua hàng đợi bền vững. */
export class FilesService {
  constructor(
    private readonly repository: FilesRepository,
    private readonly storage: FileStorage,
    private readonly authorization: AuthorizationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Xác thực ảnh trước khi ghi, dự phòng lệnh xóa trước khi tải lên và chỉ tin nội dung SVG đã làm sạch. */
  async createFile(
    file: UploadedFile | undefined,
    userId: string,
    sourceInput?: unknown,
  ): Promise<CreatedFile> {
    const image = inspectOriginalImage(file, sourceInput);
    const contentHash = createHash('sha256').update(image.file.buffer).digest('hex');
    // Các lượt tải lên cùng mã băm SHA-256 vẫn dùng khóa lưu trữ riêng;
    // chỉ cơ sở dữ liệu quyết định đối tượng nhị phân nào được dùng chung.
    // Ghi nhận ý định tải lên trước khi lưu tệp để có thể thu gom nếu tiến trình dừng đột ngột.
    const storageKey = `files/objects/${randomUUID()}.${image.imageType.extension}`;
    await this.repository.reserveUpload(storageKey);
    await this.storage.put(storageKey, image.file.buffer, image.imageType.mimeType);

    let stored: Awaited<ReturnType<FilesRepository['create']>>;
    try {
      stored = await this.repository.create(
        {
          createdByUserId: userId,
          contentHash,
          storageKey,
          mimeType: image.imageType.mimeType,
          byteSize: image.file.size,
          width: image.width,
          height: image.height,
          originalFilename: image.file.originalname.slice(0, 500),
          parentFileId: null,
        },
        image.source,
      );
    } catch (cause) {
      try {
        await this.storage.delete(storageKey);
        await this.repository.acknowledgeDeletion(storageKey);
      } catch {
        // Ý định tải lên đã được lưu; tác vụ thu gom sẽ xử lý nếu việc xóa tức thời thất bại.
      }
      throw cause;
    }

    // Cơ sở dữ liệu giữ một đối tượng nhị phân cho cùng mã băm SHA-256;
    // đối tượng vừa tải lên trùng lặp chỉ là tạm thời.
    if (stored.storageKey !== storageKey) {
      try {
        await this.storage.delete(storageKey);
        await this.repository.acknowledgeDeletion(storageKey);
      } catch {
        // Hàng đợi xóa sẽ thử lại nếu xóa đối tượng trùng lặp thất bại.
      }
    }
    return {
      fileId: stored.id,
      variantFileId: null,
      width: stored.width,
      height: stored.height,
      mimeType: image.imageType.mimeType,
    };
  }

  /** Chỉ chủ ảnh gốc được tạo ảnh cắt; biến thể không được là SVG hoặc dùng ảnh biến thể làm cha. */
  async createVariant(
    fileId: string,
    file: UploadedFile | undefined,
    userId: string,
  ): Promise<CreatedFile> {
    const parsedId = fileIdSchema.safeParse(fileId);
    if (!parsedId.success)
      throw new ClientError('not_found', 'file_not_found', 'Ảnh không tồn tại');

    const original = await this.repository.findOwned(parsedId.data, userId);
    if (!original || original.parentFileId !== null || original.mimeType === 'image/svg+xml')
      throw new ClientError('not_found', 'file_not_found', 'Ảnh không tồn tại');

    const image = inspectRasterImage(file);
    const contentHash = createHash('sha256').update(image.file.buffer).digest('hex');
    const storageKey = `files/objects/${randomUUID()}.${image.imageType.extension}`;
    await this.repository.reserveUpload(storageKey);
    await this.storage.put(storageKey, image.file.buffer, image.imageType.mimeType);

    let variant: Awaited<ReturnType<FilesRepository['createVariant']>>;
    try {
      variant = await this.repository.createVariant({
        createdByUserId: userId,
        contentHash,
        storageKey,
        mimeType: image.imageType.mimeType,
        byteSize: image.file.size,
        width: image.width,
        height: image.height,
        originalFilename: image.file.originalname.slice(0, 500),
        parentFileId: original.id,
      });
    } catch (cause) {
      try {
        await this.storage.delete(storageKey);
        await this.repository.acknowledgeDeletion(storageKey);
      } catch {
        // Ý định tải lên đã được lưu; tác vụ thu gom sẽ xử lý nếu việc xóa tức thời thất bại.
      }
      throw cause;
    }

    if (variant.storageKey !== storageKey) {
      try {
        await this.storage.delete(storageKey);
        await this.repository.acknowledgeDeletion(storageKey);
      } catch {
        // Hàng đợi xóa sẽ thử lại nếu xóa đối tượng trùng lặp thất bại.
      }
    }
    return {
      fileId: original.id,
      variantFileId: variant.id,
      width: variant.width,
      height: variant.height,
      mimeType: image.imageType.mimeType,
    };
  }

  /** Nguồn TikZ riêng tư hơn ảnh đã dựng: không cấp cho người chỉ có quyền xem ảnh trong đề. */
  async getSource(id: string, userId: string): Promise<TikzFileSource> {
    const parsedId = fileIdSchema.safeParse(id);
    if (!parsedId.success)
      throw new ClientError('not_found', 'file_source_not_found', 'Nguồn ảnh không tồn tại');

    const source = await this.repository.findSourceOwned(parsedId.data, userId);
    if (!source)
      throw new ClientError('not_found', 'file_source_not_found', 'Nguồn ảnh không tồn tại');

    const parsed = tikzFileSourceSchema.safeParse(source);
    if (!parsed.success)
      throw new ClientError('not_found', 'file_source_not_found', 'Nguồn ảnh không tồn tại');
    return parsed.data;
  }

  /** Chỉ gỡ tệp nháp do người dùng sở hữu; tác vụ lưu trữ thất bại vẫn còn bản ghi để thu gom lại. */
  async discardFiles(refs: FileRef[], userId: string): Promise<void> {
    const parsed = fileRefSchema.array().max(100).safeParse(refs);
    if (!parsed.success)
      throw new ClientError('invalid', 'file_refs_invalid', 'Danh sách ảnh cần dọn không hợp lệ');

    const unique = new Map(
      parsed.data.map((ref) => [`${ref.fileId}:${ref.variantFileId ?? ''}`, ref]),
    );
    const storageKeys = await this.repository.discardOrphans([...unique.values()], userId);
    const result = await this.deleteQueuedObjects(storageKeys);
    if (result.failed) {
      throw new Error(`Không thể xóa ${result.failed} ảnh khỏi storage; GC sẽ thử lại.`, {
        cause: result.error,
      });
    }
  }

  /** Thu gom hai giai đoạn: xóa bản ghi tệp hết hạn rồi xử lý các khóa lưu trữ đang chờ xóa. */
  async collectOrphanFiles(cutoff: Date): Promise<number> {
    while ((await this.repository.queueExpiredOrphans(cutoff)).processed > 0) {
      // Nhiều bản ghi tệp có thể cùng dùng một đối tượng nhị phân,
      // nên lô đã xử lý không nhất thiết phát sinh khóa lưu trữ cần xóa.
    }

    let deleted = 0;
    let failed = 0;
    let firstError: unknown;
    let afterStorageKey: string | undefined;

    while (true) {
      const storageKeys = await this.repository.listPendingDeletions(afterStorageKey);
      if (!storageKeys.length) break;

      const result = await this.deleteQueuedObjects(storageKeys);
      deleted += result.deleted;
      failed += result.failed;
      firstError ??= result.error;
      // Bỏ qua khóa xóa thất bại trong lượt này để tránh lặp vô hạn;
      // hàng đợi vẫn giữ các khóa chưa được xác nhận để thu gom lần sau.
      afterStorageKey = storageKeys[storageKeys.length - 1];
    }

    if (failed) {
      throw new Error(
        `Không thể xóa ${failed} ảnh khỏi storage (${deleted} ảnh đã xóa); GC sẽ thử lại.`,
        {
          cause: firstError,
        },
      );
    }
    return deleted;
  }

  private async deleteQueuedObjects(storageKeys: string[]) {
    let deleted = 0;
    let failed = 0;
    let firstError: unknown;

    for (const storageKey of storageKeys) {
      try {
        await this.storage.delete(storageKey);
        await this.repository.acknowledgeDeletion(storageKey);
        deleted++;
      } catch (error) {
        failed++;
        firstError ??= error;
      }
    }
    return { deleted, failed, error: firstError };
  }

  /**
   * Chủ sở hữu được xem ảnh của mình; người nhận bài chỉ được xem ảnh thuộc
   * nội dung đề hoặc lời giải đã công bố. Quyền xem ảnh cắt không đồng nghĩa
   * với quyền đọc ảnh gốc, nội dung hướng dẫn hay nguồn TikZ.
   */
  async getFile(id: string, userId: string): Promise<StoredFile> {
    const parsedId = fileIdSchema.safeParse(id);
    if (!parsedId.success)
      throw new ClientError('not_found', 'file_not_found', 'Ảnh không tồn tại');

    const owned = await this.repository.findOwned(parsedId.data, userId);
    const image = owned ?? (await this.repository.find(parsedId.data));
    if (!image || image.parentFileId !== null)
      throw new ClientError('not_found', 'file_not_found', 'Ảnh không tồn tại');
    if (!owned) await this.assertAssignedFileAccess(parsedId.data, null, userId);

    return this.getStoredFile(image.storageKey, image.mimeType, image.byteSize);
  }

  /** Đọc ảnh biến thể phải chứng minh cả quan hệ với ảnh gốc lẫn quyền đối với nội dung được giao. */
  async getVariant(fileId: string, variantFileId: string, userId: string): Promise<StoredFile> {
    const parsedImageId = fileIdSchema.safeParse(fileId);
    const parsedImageVariantId = fileIdSchema.safeParse(variantFileId);
    if (!parsedImageId.success || !parsedImageVariantId.success) {
      throw new ClientError('not_found', 'file_not_found', 'Ảnh không tồn tại');
    }

    const owned = await this.repository.findVariantOwned(
      parsedImageId.data,
      parsedImageVariantId.data,
      userId,
    );
    const variant =
      owned ?? (await this.repository.findVariant(parsedImageId.data, parsedImageVariantId.data));
    if (!variant) throw new ClientError('not_found', 'file_not_found', 'Ảnh không tồn tại');
    if (!owned)
      await this.assertAssignedFileAccess(parsedImageId.data, parsedImageVariantId.data, userId);

    return this.getStoredFile(variant.storageKey, variant.mimeType, variant.byteSize);
  }

  /** Chỉ xét nội dung đề được giao hoặc lời giải đã công bố, không suy quyền từ vị trí tệp đơn thuần. */
  private async assertAssignedFileAccess(
    fileId: string,
    variantFileId: string | null,
    userId: string,
  ): Promise<void> {
    const classIds = await this.repository.assignedFileClasses(
      fileId,
      variantFileId,
      userId,
      this.now(),
    );
    for (const classId of classIds) {
      const decision = await this.authorization.authorize({
        actorId: userId,
        capability: 'assignment:view_assigned',
        context: { kind: 'class', resourceKey: classId },
      });
      if (decision.allowed) return;
    }
    // Người đã rời lớp chỉ đọc lời giải của lượt đã nộp; thành viên đang
    // hoạt động vẫn phải có quyền xem kết quả tại thời điểm yêu cầu.
    const released = await this.repository.releasedSolutionFileClasses(
      fileId,
      variantFileId,
      userId,
      this.now(),
    );
    for (const { classId, enrolmentStatus } of released) {
      if (enrolmentStatus === 'left') return;
      const decision = await this.authorization.authorize({
        actorId: userId,
        capability: 'result:view_own',
        context: { kind: 'class', resourceKey: classId },
      });
      if (decision.allowed) return;
    }
    throw new ClientError('not_found', 'file_not_found', 'Ảnh không tồn tại');
  }

  private async getStoredFile(
    storageKey: string,
    mimeType: string,
    byteSize: number,
  ): Promise<StoredFile> {
    const object = await this.storage.get(storageKey);
    if (!object.body) throw new ClientError('not_found', 'file_not_found', 'Ảnh không tồn tại');

    return { body: object.body, mimeType, byteSize, etag: object.etag };
  }
}
