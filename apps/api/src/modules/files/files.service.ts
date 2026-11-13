import { InjectQueue } from '@nestjs/bullmq';
import { ForbiddenException, BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
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

export const QUESTION_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export function questionFileContentSrc(fileId: string): string {
  return `/api/v1/files/${fileId}/content`;
}
export const QUESTION_FILE_CONTENT_SRC_PATTERN = /^\/api\/v1\/files\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/content$/;

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

@Injectable()
export class FilesService {
  constructor(
    private readonly repo: FilesRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly evaluator: PermissionEvaluator,
    private readonly signing: FileSigningService,
    @InjectQueue(FILE_CLEANUP_QUEUE) private readonly cleanupQueue: Queue,
    @Optional() private readonly spaceDb?: SpaceDatabaseService,
  ) {}

  async upload(input: UploadInput): Promise<FileRow> {
    if (!input.fileName || input.fileName.includes('/') || input.fileName.includes('\\')) {
      throw new BadRequestException({ message: 'Invalid filename', code: 'file.invalid_filename' });
    }
    const contentHash = sha256Hex(input.data);
    const storageDomain = await this.currentStorageDomain();
    await this.storage.put(storageDomain, contentHash, input.data);
    return this.repo.insert({
      contentHash, storageDomain, contextId: input.contextId, component: input.component, fileArea: input.fileArea,
      itemId: input.itemId ?? null, filePath: input.filePath ?? '/', fileName: input.fileName,
      userId: input.userId, fileSize: input.data.length, mimeType: input.mimeType,
    });
  }

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

  async getFile(id: string): Promise<FileRow> {
    const row = await this.repo.getById(id);
    if (!row || !(await this.canAccessDomain(row))) throw new NotFoundException({ message: `File ${id} not found`, code: 'file.not_found' });
    return row;
  }
  private async currentStorageDomain(): Promise<string> {
    const slug = tenantAls.getStore()?.spaceSlug;
    if (!slug) return SYSTEM_FILE_DOMAIN;
    if (!this.spaceDb) throw new Error('file.space_resolver_missing');
    const target = await this.spaceDb.resolveTarget(slug);
    return fileDomainForSpace(target.spaceId);
  }

  private async canReadLegacy(file: FileRow): Promise<boolean> {
    if (typeof this.repo.getContextTenantId !== 'function') return false;
    const ownerId = await this.repo.getContextTenantId(file.contextId);
    if (ownerId === undefined) return false;
    const store = tenantAls.getStore();
    const slug = store?.spaceSlug;
    if (!slug) {
      return ownerId === null || (!!store?.tenantId && ownerId === store.tenantId);
    }
    if (!this.spaceDb) return false;
    const target = await this.spaceDb.resolveTarget(slug);
    const tenant = await tenantAls.run({ platform: true, spaceSlug: slug, spaceId: store?.spaceId, spaceHandle: store?.spaceHandle }, async () =>
      this.spaceDb!.routedKysely.selectFrom('tenants')
        .select(['id', 'kind']).where('slug', '=', slug).executeTakeFirst(),
    );
    if (!tenant) return false;
    if (ownerId === tenant.id) return true;
    return ownerId === null && target.mode === 'dedicated';
  }

  private async signatureScope(file: FileRow, ownerTenantId?: string): Promise<string> {
    const domain = file.storageDomain === LEGACY_FILE_DOMAIN
      ? await this.currentStorageDomain() : file.storageDomain;
    return ownerTenantId
      ? `${domain}.contentbank.${ownerTenantId}.${tenantAls.getStore()?.spaceSlug ?? 'root'}`
      : domain;
  }

  private async fileForSigning(file: FileRow): Promise<FileRow & { signingDomain?: string }> {
    if (file.storageDomain !== LEGACY_FILE_DOMAIN && file.component !== 'core_contentbank') return file;
    const owner = file.component === 'core_contentbank' ? tenantAls.getStore()?.tenantId : undefined;
    return { ...file, signingDomain: await this.signatureScope(file, owner) };
  }

  private async canAccessDomain(file: FileRow): Promise<boolean> {
    if (file.component === 'core_contentbank') {
      const owner = file.itemId ? await this.repo.contentBankTenant(file.itemId) : undefined;
      if (!owner || owner !== tenantAls.getStore()?.tenantId) return false;
      if (file.storageDomain === LEGACY_FILE_DOMAIN) return true;
    }
    if (file.storageDomain === LEGACY_FILE_DOMAIN) return this.canReadLegacy(file);
    return file.storageDomain === await this.currentStorageDomain();
  }

  async refcount(contentHash: string): Promise<number> {
    return this.repo.countByHash(contentHash, await this.currentStorageDomain());
  }
  physicalKey(contentHash: string, storageDomain = SYSTEM_FILE_DOMAIN): string { return this.storage.keyFor(storageDomain, contentHash); }
  async physicalExists(contentHash: string, storageDomain = SYSTEM_FILE_DOMAIN): Promise<boolean> { return this.storage.exists(storageDomain, contentHash); }

  async deleteFile(id: string, actor?: { id: string }): Promise<{ deleted: true; contentHash: string; refcount: number }> {
    const row = await this.getFile(id);
    if (actor && row.fileArea === 'exam_snapshot') throw new ForbiddenException({ code: 'file.snapshot_locked' });
    if (actor) await this.assertSubmissionLockForDelete(row, actor);
    await this.repo.deleteById(id);
    const refcount = await this.repo.countByHash(row.contentHash, row.storageDomain);
    if (refcount === 0 && row.storageDomain !== LEGACY_FILE_DOMAIN) {
      const spaceSlug = tenantAls.getStore()?.spaceSlug;
      await this.cleanupQueue.add(
        'cleanup-orphan',
        { contentHash: row.contentHash, storageDomain: row.storageDomain, ...(spaceSlug ? { spaceSlug } : {}) },
        { jobId: ['orphan', row.storageDomain, row.contentHash, row.id].join('-'), attempts: 3 },
      );
    }
    return { deleted: true, contentHash: row.contentHash, refcount };
  }

  async cleanupExamSnapshotFiles(itemId: string): Promise<void> {
    for (const file of await this.repo.listExamSnapshotFiles(itemId)) {
      await this.deleteFile(file.id);
    }
  }

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

  async cleanupOrphan(contentHash: string, storageDomain?: string): Promise<boolean> {
    const domain = storageDomain ?? await this.currentStorageDomain();
    if (domain === LEGACY_FILE_DOMAIN) throw new Error('file.legacy_cleanup_forbidden');
    if ((await this.repo.countByHash(contentHash, domain)) > 0) return false;
    await this.storage.delete(domain, contentHash);
    return true;
  }

  async assertCanView(file: FileRow, actor: { id: string; username?: string }): Promise<void> {
    await this.evaluator.requireCapability(actor.id, 'files:view', file.contextId, { isGuest: actor.username === 'guest' });
  }
  async assertCanUpload(contextId: string, actor: { id: string; username?: string }): Promise<void> {
    await this.evaluator.requireCapability(actor.id, 'files:upload', contextId, { isGuest: actor.username === 'guest' });
  }

  async createSignedUrl(fileId: string, userId: string, isGuest = false): Promise<{ url: string; expiresAt: number }> {
    const file = await this.getFile(fileId);
    await this.evaluator.requireCapability(userId, 'files:view', file.contextId, { isGuest });
    return this.signing.createDownloadTarget(await this.fileForSigning(file));
  }
  async readSignedContent(fileId: string, token: string | undefined): Promise<{ file: FileRow; data: Buffer }> {
    const requestScope = tenantAls.getStore();
    const slug = requestScope?.spaceSlug;
    const platformScope = {
      platform: true,
      ...(slug ? {
        spaceSlug: slug, spaceId: requestScope?.spaceId, spaceHandle: requestScope?.spaceHandle,
      } : {}),
    };
    const file = await tenantAls.run(platformScope, async () => this.repo.getById(fileId));
    if (!file) throw new NotFoundException({ message: `File ${fileId} not found`, code: 'file.not_found' });

    const owner = file.component === 'core_contentbank' && file.itemId
      ? await tenantAls.run(platformScope, () => this.repo.contentBankTenant(file.itemId!))
      : undefined;
    if (file.component === 'core_contentbank' && !owner) {
      throw new NotFoundException({ message: `File ${fileId} not found`, code: 'file.not_found' });
    }
    if (file.storageDomain !== LEGACY_FILE_DOMAIN && file.storageDomain !== await this.currentStorageDomain()) {
      throw new NotFoundException({ message: `File ${fileId} not found`, code: 'file.not_found' });
    }
    this.signing.verify(fileId, await this.signatureScope(file, owner), token);

    if (file.component === 'core_contentbank') {
      if (slug) {
        if (!this.spaceDb) throw new NotFoundException({ message: `File ${fileId} not found`, code: 'file.not_found' });
        const tenant = await tenantAls.run(platformScope, () =>
          this.spaceDb!.routedKysely.selectFrom('tenants').select('id').where('slug', '=', slug).executeTakeFirst());
        if (!tenant || tenant.id !== owner) {
          throw new NotFoundException({ message: `File ${fileId} not found`, code: 'file.not_found' });
        }
      }
    } else if (!(await this.canAccessDomain(file))) {
      throw new NotFoundException({ message: `File ${fileId} not found`, code: 'file.not_found' });
    }
    return { file, data: await this.storage.get(file.storageDomain, file.contentHash) };
  }
  async readContent(fileId: string): Promise<{ file: FileRow; data: Buffer }> {
    const file = await this.getFile(fileId);
    const data = await this.storage.get(file.storageDomain, file.contentHash);
    return { file, data };
  }
  async listByContext(contextId: string): Promise<FileRow[]> { const rows = await this.repo.listByContext(contextId); const matches = await Promise.all(rows.map(async (file) => (await this.canAccessDomain(file)) ? file : null)); return matches.filter((row): row is FileRow => row !== null); }
}
