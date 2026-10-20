import { randomUUID } from 'node:crypto';
import {
  imageIdSchema,
  imageRefSchema,
  MAX_IMAGE_BYTES,
  tikzImageSourceSchema,
  type ImageMimeType,
  type ImageRef,
  type TikzImageSource,
} from '@giaokhoa/shared/images';
import { imageSize } from 'image-size';
import type { AuthorizationService } from '../authorization/service.js';
import { ClientError } from '../common/client-error.js';
import type { ImagesRepository } from './repository.js';
import type { ImageStorage } from './storage.js';
import { sanitizeAndInspectSvg } from './svg-sanitizer.js';

const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;

const rasterImageTypes = {
  png: { mimeType: 'image/png', extension: 'png' },
  jpg: { mimeType: 'image/jpeg', extension: 'jpg' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
} as const;

const svgImageType = { mimeType: 'image/svg+xml', extension: 'svg' } as const;

export type UploadedImageFile = {
  buffer: Uint8Array;
  originalname: string;
  size: number;
};

export type CreatedImage = {
  imageId: string;
  imageVariantId: string | null;
  width: number;
  height: number;
  mimeType: ImageMimeType;
};

export type StoredImage = {
  body: Uint8Array;
  mimeType: string;
  byteSize: number;
  etag?: string;
};

function invalid(message: string): never {
  throw new ClientError('invalid', 'image_invalid', message);
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

function parseTikzSource(input: unknown): TikzImageSource | undefined {
  if (
    input === undefined ||
    input === null ||
    (typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0)
  ) {
    return undefined;
  }

  const parsed = tikzImageSourceSchema.safeParse(input);
  if (!parsed.success) invalid('Metadata TikZ không hợp lệ');
  return parsed.data;
}

function inspectOriginalImage(file: UploadedImageFile | undefined, sourceInput: unknown) {
  if (!file?.buffer?.length) invalid('Chưa chọn ảnh');
  if (file.size > MAX_IMAGE_BYTES) invalid('Ảnh không được vượt quá 8 MB');

  let dimensions: ReturnType<typeof imageSize>;
  try {
    dimensions = imageSize(file.buffer);
  } catch {
    invalid('File ảnh không hợp lệ');
  }

  const source = parseTikzSource(sourceInput);
  if (dimensions.type === 'svg') {
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
    if (sanitized.length > MAX_IMAGE_BYTES) {
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
  return { file, imageType, width, height, source: undefined };
}

function inspectRasterImage(file: UploadedImageFile | undefined) {
  const image = inspectOriginalImage(file, undefined);
  if (image.imageType.mimeType === 'image/svg+xml') {
    invalid('Không thể tạo crop variant từ SVG');
  }
  return image;
}

export class ImagesService {
  constructor(
    private readonly repository: ImagesRepository,
    private readonly storage: ImageStorage,
    private readonly authorization: AuthorizationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createImage(
    file: UploadedImageFile | undefined,
    userId: string,
    sourceInput?: unknown,
  ): Promise<CreatedImage> {
    const image = inspectOriginalImage(file, sourceInput);
    const storageKey = `images/originals/${randomUUID()}.${image.imageType.extension}`;
    await this.storage.put(storageKey, image.file.buffer, image.imageType.mimeType);

    try {
      const stored = await this.repository.create(
        {
          createdByUserId: userId,
          storageKey,
          mimeType: image.imageType.mimeType,
          byteSize: image.file.size,
          width: image.width,
          height: image.height,
          originalFilename: image.file.originalname.slice(0, 500),
        },
        image.source,
      );

      return {
        imageId: stored.id,
        imageVariantId: null,
        width: stored.width,
        height: stored.height,
        mimeType: image.imageType.mimeType,
      };
    } catch (cause) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw cause;
    }
  }

  async createImageVariant(
    imageId: string,
    file: UploadedImageFile | undefined,
    userId: string,
  ): Promise<CreatedImage> {
    const parsedImageId = imageIdSchema.safeParse(imageId);
    if (!parsedImageId.success)
      throw new ClientError('not_found', 'image_not_found', 'Ảnh không tồn tại');

    const image = await this.repository.findOwned(parsedImageId.data, userId);
    if (!image || image.mimeType === 'image/svg+xml')
      throw new ClientError('not_found', 'image_not_found', 'Ảnh không tồn tại');

    const variantImage = inspectRasterImage(file);
    const storageKey = `images/derived/${image.id}/${randomUUID()}.${variantImage.imageType.extension}`;
    await this.storage.put(storageKey, variantImage.file.buffer, variantImage.imageType.mimeType);

    try {
      const variant = await this.repository.createVariant({
        imageId: image.id,
        storageKey,
        mimeType: variantImage.imageType.mimeType,
        byteSize: variantImage.file.size,
        width: variantImage.width,
        height: variantImage.height,
        filename: variantImage.file.originalname.slice(0, 500),
      });

      return {
        imageId: image.id,
        imageVariantId: variant.id,
        width: variant.width,
        height: variant.height,
        mimeType: variantImage.imageType.mimeType,
      };
    } catch (cause) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw cause;
    }
  }

  async getImageSource(id: string, userId: string): Promise<TikzImageSource> {
    const parsedId = imageIdSchema.safeParse(id);
    if (!parsedId.success)
      throw new ClientError('not_found', 'image_source_not_found', 'Nguồn ảnh không tồn tại');

    const source = await this.repository.findSourceOwned(parsedId.data, userId);
    if (!source)
      throw new ClientError('not_found', 'image_source_not_found', 'Nguồn ảnh không tồn tại');

    const parsed = tikzImageSourceSchema.safeParse(source);
    if (!parsed.success)
      throw new ClientError('not_found', 'image_source_not_found', 'Nguồn ảnh không tồn tại');
    return parsed.data;
  }

  async discardImages(refs: ImageRef[], userId: string): Promise<void> {
    const parsed = imageRefSchema.array().max(100).safeParse(refs);
    if (!parsed.success)
      throw new ClientError('invalid', 'image_refs_invalid', 'Danh sách ảnh cần dọn không hợp lệ');

    const unique = new Map(
      parsed.data.map((ref) => [`${ref.imageId}:${ref.imageVariantId ?? ''}`, ref]),
    );
    const storageKeys = await this.repository.discardOrphans([...unique.values()], userId);
    const result = await this.deleteQueuedObjects(storageKeys);
    if (result.failed) {
      throw new Error(`Không thể xóa ${result.failed} ảnh khỏi storage; GC sẽ thử lại.`, {
        cause: result.error,
      });
    }
  }

  async collectOrphanImages(cutoff: Date): Promise<number> {
    while ((await this.repository.queueExpiredOrphans(cutoff)).length) {
      // Mỗi lô lưu đồng thời việc xóa metadata và các khóa storage cần xóa bền vững.
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
   * Chủ ảnh hoặc người nhận bài giao có ảnh trong phần đề được xem binary.
   * Quyền xem ảnh ở đây không bao gồm ảnh chỉ xuất hiện trong guidance/solution.
   */
  async getImage(id: string, userId: string): Promise<StoredImage> {
    const parsedId = imageIdSchema.safeParse(id);
    if (!parsedId.success)
      throw new ClientError('not_found', 'image_not_found', 'Ảnh không tồn tại');

    const owned = await this.repository.findOwned(parsedId.data, userId);
    const image = owned ?? (await this.repository.find(parsedId.data));
    if (!image) throw new ClientError('not_found', 'image_not_found', 'Ảnh không tồn tại');
    if (!owned) await this.assertAssignedImageAccess(parsedId.data, null, userId);

    return this.getStoredImage(image.storageKey, image.mimeType, image.byteSize);
  }

  async getImageVariant(
    imageId: string,
    imageVariantId: string,
    userId: string,
  ): Promise<StoredImage> {
    const parsedImageId = imageIdSchema.safeParse(imageId);
    const parsedImageVariantId = imageIdSchema.safeParse(imageVariantId);
    if (!parsedImageId.success || !parsedImageVariantId.success) {
      throw new ClientError('not_found', 'image_not_found', 'Ảnh không tồn tại');
    }

    const owned = await this.repository.findVariantOwned(
      parsedImageId.data,
      parsedImageVariantId.data,
      userId,
    );
    const variant =
      owned ?? (await this.repository.findVariant(parsedImageId.data, parsedImageVariantId.data));
    if (!variant) throw new ClientError('not_found', 'image_not_found', 'Ảnh không tồn tại');
    if (!owned)
      await this.assertAssignedImageAccess(parsedImageId.data, parsedImageVariantId.data, userId);

    return this.getStoredImage(variant.storageKey, variant.mimeType, variant.byteSize);
  }

  private async assertAssignedImageAccess(
    imageId: string,
    imageVariantId: string | null,
    userId: string,
  ): Promise<void> {
    const classIds = await this.repository.assignedImageClasses(
      imageId,
      imageVariantId,
      userId,
      new Date(),
    );
    for (const classId of classIds) {
      const decision = await this.authorization.authorize({
        actorId: userId,
        capability: 'assignment:view_assigned',
        context: { kind: 'class', resourceKey: classId },
      });
      if (decision.allowed) return;
    }
    throw new ClientError('not_found', 'image_not_found', 'Ảnh không tồn tại');
  }

  private async getStoredImage(
    storageKey: string,
    mimeType: string,
    byteSize: number,
  ): Promise<StoredImage> {
    const object = await this.storage.get(storageKey);
    if (!object.body) throw new ClientError('not_found', 'image_not_found', 'Ảnh không tồn tại');

    return { body: object.body, mimeType, byteSize, etag: object.etag };
  }
}
