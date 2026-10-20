import type { FileRef, TikzFileSource } from '@giaokhoa/shared/files';

export type FileRecord = {
  id: string;
  createdByUserId: string;
  contentHash: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  originalFilename: string;
  parentFileId: string | null;
  orphanedAt: Date | null;
  createdAt: Date;
};

export type CreateFileData = Omit<FileRecord, 'id' | 'orphanedAt' | 'createdAt'>;
export type CreateFileVariantData = CreateFileData & { parentFileId: string };

export interface FilesRepository {
  create(data: CreateFileData, source?: TikzFileSource): Promise<FileRecord>;
  createVariant(data: CreateFileVariantData): Promise<FileRecord>;
  find(id: string): Promise<FileRecord | undefined>;
  findOwned(id: string, userId: string): Promise<FileRecord | undefined>;
  findVariant(fileId: string, variantFileId: string): Promise<FileRecord | undefined>;
  findVariantOwned(
    fileId: string,
    variantFileId: string,
    userId: string,
  ): Promise<FileRecord | undefined>;
  findSourceOwned(id: string, userId: string): Promise<TikzFileSource | undefined>;
  assignedFileClasses(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<string[]>;
  discardOrphans(refs: FileRef[], userId: string): Promise<string[]>;
  queueExpiredOrphans(cutoff: Date): Promise<{ processed: number; storageKeys: string[] }>;
  listPendingDeletions(afterStorageKey?: string): Promise<string[]>;
  acknowledgeDeletion(storageKey: string): Promise<void>;
}
