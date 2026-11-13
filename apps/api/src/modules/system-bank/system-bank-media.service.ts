/**
 * Sao chép nội dung ảnh giữa miền trung tâm và miền bank-system.
 * Bản công bố giữ manifest/hash cùng byte vật lý độc lập; đường nhập
 * tái tạo metadata của trung tâm đích thay vì giữ fileId của nơi gửi.
 */
import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SYSTEM_FILE_DOMAIN } from '@giaokhoa/db';
import type { SystemBankPackage } from '@giaokhoa/contracts';
import { FilesService, QUESTION_FILE_CONTENT_SRC_PATTERN, QUESTION_IMAGE_MAX_BYTES, questionFileContentSrc, sniffImageMimeType } from '../files/files.service';
import { OBJECT_STORAGE, sha256Hex, type ObjectStorage } from '../files/storage';

const BANK_IMAGE_PREFIX = 'bank-media://';

/**
 * Khoá riêng của bản CÔNG BỐ trong cùng miền vật lý bank-system.
 * Ở trung tâm thuộc kho chung, file riêng cũng có miền bank-system;
 * nếu dùng nguyên contentHash, job dọn file riêng có thể xoá ảnh đã
 * công bố vì không có dòng metadata file trong kho trung tâm làm pin.
 * Dẫn xuất khoá riêng từ hash đã xác minh để dọn nguồn không chạm tới.
 */
export function publicationMediaStorageKey(contentHash: string): string {
  return createHash('sha256').update(`system-bank-publications/${contentHash}`).digest('hex');
}
type ImageAttrs = { src: string };

/** Duyệt mọi tài liệu Tiptap lồng trong gói, chỉ sửa thuộc tính ảnh. */
function imageAttrs(value: unknown): ImageAttrs[] {
  const found: ImageAttrs[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const item = node as Record<string, unknown>;
    if (item.type === 'image' && item.attrs && typeof item.attrs === 'object') {
      const attrs = item.attrs as Record<string, unknown>;
      if (typeof attrs.src !== 'string') {
        throw new BadRequestException({ message: 'Invalid image reference', code: 'system_bank.invalid_media' });
      }
      found.push(attrs as ImageAttrs);
    }
    Object.values(item).forEach(visit);
  };
  visit(value);
  return found;
}

@Injectable()
export class SystemBankMediaService {
  constructor(
    private readonly files: FilesService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Đọc file nguồn ở đúng miền sở hữu của trung tâm, xác thực hash byte,
   * sao vào bank-system rồi thay fileId bằng hash bền. Nếu file không hợp
   * lệ thì từ chối toàn bộ lần gửi; không tạo bản công bố thiếu ảnh.
   */
  async snapshot(pkg: SystemBankPackage, sourceContextId: string): Promise<SystemBankPackage> {
    const result = structuredClone(pkg);
    const manifest = new Map<string, NonNullable<SystemBankPackage['media']>[number]>();
    for (const attrs of imageAttrs(result)) {
      const match = QUESTION_FILE_CONTENT_SRC_PATTERN.exec(attrs.src);
      if (!match) {
        throw new BadRequestException({ message: 'Image must reference an owned file', code: 'system_bank.invalid_media' });
      }
      const file = await this.files.getFile(match[1]!);
      if (file.component !== 'question' || file.contextId !== sourceContextId ||
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimeType ?? '')) {
        throw new BadRequestException({ message: 'Image does not belong to source question', code: 'system_bank.invalid_media' });
      }
      const bytes = await this.storage.get(file.storageDomain, file.contentHash);
      if (sha256Hex(bytes) !== file.contentHash || bytes.length > QUESTION_IMAGE_MAX_BYTES ||
        sniffImageMimeType(bytes) !== file.mimeType) {
        throw new BadRequestException({ message: 'Source image checksum or format mismatch', code: 'system_bank.invalid_media' });
      }
      await this.storage.put(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(file.contentHash), bytes);
      manifest.set(file.contentHash, {
        contentHash: file.contentHash, fileName: file.fileName,
        mimeType: file.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
      });
      attrs.src = BANK_IMAGE_PREFIX + file.contentHash;
    }
    result.media = [...manifest.values()];
    return result;
  }

  /**
   * Trả byte ảnh đã sao vào miền bank-system cho màn duyệt, khi hash
   * có trong manifest bản gửi. Luôn kiểm tra checksum và MIME thực
   * trước khi controller trả dữ liệu với cache private/no-store.
   */
  async readPreview(pkg: SystemBankPackage, contentHash: string): Promise<{ data: Buffer; mimeType: string }> {
    const item = pkg.media?.find((file) => file.contentHash === contentHash);
    if (!item) {
      throw new BadRequestException({ message: 'Image missing from submission', code: 'system_bank.invalid_media' });
    }
    const data = await this.storage.get(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(contentHash));
    if (sha256Hex(data) !== contentHash || data.length > QUESTION_IMAGE_MAX_BYTES ||
      sniffImageMimeType(data) !== item.mimeType) {
      throw new BadRequestException({ message: 'Published image checksum or format mismatch', code: 'system_bank.invalid_media' });
    }
    return { data, mimeType: item.mimeType };
  }

  /**
   * Đọc bản công bố từ kho vật lý bank-system, so hash từng đối tượng,
   * tạo file logic ở kho đích trước khi giao nội dung cho QuestionsService.
   * Gói nguồn không bị sửa; mọi lần nhập có bản sao file độc lập.
   */
  async materialize(pkg: SystemBankPackage, targetContextId: string, actorId: string, localSource = false, immutable = false): Promise<SystemBankPackage> {
    const result = structuredClone(pkg);
    const manifest = new Map((result.media ?? []).map((file) => [file.contentHash, file]));
    const copied = new Map<string, string>();
    const verified = new Map<string, Buffer>();
    for (const item of manifest.values()) {
      const bytes = await this.storage.get(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(item.contentHash))
        .catch(() => { throw new BadRequestException({ code: 'system_bank.invalid_media' }); });
      if (sha256Hex(bytes) !== item.contentHash || bytes.length > QUESTION_IMAGE_MAX_BYTES || sniffImageMimeType(bytes) !== item.mimeType) {
        throw new BadRequestException({ code: 'system_bank.invalid_media' });
      }
      verified.set(item.contentHash, bytes);
    }
    for (const attrs of imageAttrs(result)) {
      if (localSource) {
        const match = QUESTION_FILE_CONTENT_SRC_PATTERN.exec(attrs.src);
        if (!match) throw new BadRequestException({ code: 'system_bank.invalid_media' });
        const file = await this.files.getFile(match[1]!);
        const bytes = await this.storage.get(file.storageDomain, file.contentHash);
        if (file.component !== 'question' || sha256Hex(bytes) !== file.contentHash ||
          bytes.length > QUESTION_IMAGE_MAX_BYTES || sniffImageMimeType(bytes) !== file.mimeType) {
          throw new BadRequestException({ code: 'system_bank.invalid_media' });
        }
        const copy = await this.files.upload({ contextId: targetContextId, component: 'question',
          fileArea: immutable ? 'exam_snapshot' : 'question', fileName: file.fileName, mimeType: file.mimeType!, data: bytes, userId: actorId });
        attrs.src = questionFileContentSrc(copy.id);
        continue;
      }
      if (!attrs.src.startsWith(BANK_IMAGE_PREFIX)) {
        throw new BadRequestException({ message: 'Published image has unsafe source', code: 'system_bank.invalid_media' });
      }
      const hash = attrs.src.slice(BANK_IMAGE_PREFIX.length);
      const item = manifest.get(hash);
      if (!item) {
        throw new BadRequestException({ message: 'Published image missing from manifest', code: 'system_bank.invalid_media' });
      }
      let fileId = copied.get(hash);
      if (!fileId) {
        const bytes = verified.get(hash)!;
        if (sha256Hex(bytes) !== hash || bytes.length > QUESTION_IMAGE_MAX_BYTES ||
          sniffImageMimeType(bytes) !== item.mimeType) {
          throw new BadRequestException({ message: 'Published image checksum or format mismatch', code: 'system_bank.invalid_media' });
        }
        const file = await this.files.upload({
          contextId: targetContextId, component: 'question', fileArea: immutable ? 'exam_snapshot' : 'question',
          fileName: item.fileName, mimeType: item.mimeType, data: bytes, userId: actorId,
        });
        fileId = file.id;
        copied.set(hash, file.id);
      }
      attrs.src = questionFileContentSrc(fileId);
    }
    return result;
  }
}
