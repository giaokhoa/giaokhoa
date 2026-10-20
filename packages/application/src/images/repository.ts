import type { ImageRef, TikzImageSource } from '@giaokhoa/shared/images';

export type ImageRecord = {
  id: string;
  createdByUserId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  originalFilename: string;
  orphanedAt: Date | null;
  createdAt: Date;
};

export type ImageVariantRecord = {
  id: string;
  imageId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  filename: string;
  orphanedAt: Date | null;
  createdAt: Date;
};

export type CreateImageData = Omit<ImageRecord, 'id' | 'orphanedAt' | 'createdAt'>;
export type CreateImageVariantData = Omit<ImageVariantRecord, 'id' | 'orphanedAt' | 'createdAt'>;

export interface ImagesRepository {
  create(data: CreateImageData, source?: TikzImageSource): Promise<ImageRecord>;
  createVariant(data: CreateImageVariantData): Promise<ImageVariantRecord>;
  find(id: string): Promise<ImageRecord | undefined>;
  findOwned(id: string, userId: string): Promise<ImageRecord | undefined>;
  findVariant(imageId: string, imageVariantId: string): Promise<ImageVariantRecord | undefined>;
  assignedImageClasses(
    imageId: string,
    imageVariantId: string | null,
    userId: string,
    now: Date,
  ): Promise<string[]>;
  findSourceOwned(id: string, userId: string): Promise<TikzImageSource | undefined>;
  findVariantOwned(
    imageId: string,
    imageVariantId: string,
    userId: string,
  ): Promise<ImageVariantRecord | undefined>;
  discardOrphans(refs: ImageRef[], userId: string): Promise<string[]>;
  queueExpiredOrphans(cutoff: Date): Promise<string[]>;
  listPendingDeletions(afterStorageKey?: string): Promise<string[]>;
  acknowledgeDeletion(storageKey: string): Promise<void>;
}
