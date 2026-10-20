import { ClientError } from '@giaokhoa/application/common/client-error';
import type {
  CreateImageData,
  CreateImageVariantData,
  ImagesRepository,
} from '@giaokhoa/application/images/repository';
import type { ImageRef, TikzImageSource } from '@giaokhoa/shared/images';
import { collectImageRefs, questionSchema } from '@giaokhoa/shared/questions';
import { and, asc, DrizzleQueryError, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { assignments, assignmentRecipients } from '../schema/assignments.js';
import { classes, classEnrolments } from '../schema/classes.js';
import { examRevisionQuestions } from '../schema/exams.js';
import { questionVersions } from '../schema/questions.js';
import {
  images,
  imageSources,
  imageVariants,
  questionImageRefs,
  storageObjectDeletions,
} from '../schema/images.js';
import type { Database } from '../types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export class PostgresImagesRepository implements ImagesRepository {
  constructor(private readonly db: Database) {}

  async create(data: CreateImageData, source?: TikzImageSource) {
    return this.db.transaction(async (tx) => {
      const [image] = await tx.insert(images).values(data).returning();
      if (source) await tx.insert(imageSources).values({ ...source, imageId: image.id });
      return image;
    });
  }

  async createVariant(data: CreateImageVariantData) {
    try {
      const [variant] = await this.db.insert(imageVariants).values(data).returning();
      return variant;
    } catch (error) {
      const cause = error instanceof DrizzleQueryError ? error.cause : error;
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        cause.code === '23503'
      ) {
        throw new ClientError('not_found', 'image_not_found', 'Ảnh không tồn tại');
      }
      throw error;
    }
  }

  async find(id: string) {
    const [image] = await this.db.select().from(images).where(eq(images.id, id)).limit(1);
    return image;
  }

  /** Giới hạn theo owner ngay ở SQL, trước khi application đọc bytes từ storage. */
  async findOwned(id: string, userId: string) {
    const [image] = await this.db
      .select()
      .from(images)
      .where(and(eq(images.id, id), eq(images.createdByUserId, userId)))
      .limit(1);
    return image;
  }

  async findVariant(imageId: string, imageVariantId: string) {
    const [variant] = await this.db
      .select()
      .from(imageVariants)
      .where(and(eq(imageVariants.id, imageVariantId), eq(imageVariants.imageId, imageId)))
      .limit(1);
    return variant;
  }

  /**
   * Chỉ xét ảnh thực sự nằm trong content của câu hỏi đã giao; bảng refs còn lưu ảnh
   * trong guidance/solution nên không đủ điều kiện để cho học sinh đọc binary.
   */
  async assignedImageClasses(
    imageId: string,
    imageVariantId: string | null,
    userId: string,
    now: Date,
  ) {
    const rows = await this.db
      .select({ classId: assignments.classId, snapshot: examRevisionQuestions.questionSnapshot })
      .from(questionImageRefs)
      .innerJoin(questionVersions, eq(questionVersions.questionId, questionImageRefs.questionId))
      .innerJoin(
        examRevisionQuestions,
        eq(examRevisionQuestions.questionVersionId, questionVersions.id),
      )
      .innerJoin(assignments, eq(assignments.examRevisionId, examRevisionQuestions.examRevisionId))
      .innerJoin(
        assignmentRecipients,
        and(
          eq(assignmentRecipients.assignmentId, assignments.id),
          eq(assignmentRecipients.userId, userId),
          eq(assignmentRecipients.status, 'active'),
        ),
      )
      .innerJoin(
        classEnrolments,
        and(
          eq(classEnrolments.classId, assignments.classId),
          eq(classEnrolments.userId, userId),
          eq(classEnrolments.status, 'active'),
        ),
      )
      .innerJoin(classes, eq(classes.id, assignments.classId))
      .where(
        and(
          eq(questionImageRefs.imageId, imageId),
          imageVariantId
            ? eq(questionImageRefs.imageVariantId, imageVariantId)
            : isNull(questionImageRefs.imageVariantId),
          eq(assignments.status, 'published'),
          lte(assignments.openAt, now),
          eq(classes.status, 'active'),
        ),
      );
    return [
      ...new Set(
        rows
          .filter(({ snapshot }) =>
            collectImageRefs(questionSchema.parse(snapshot).content).some(
              (ref) => ref.imageId === imageId && ref.imageVariantId === imageVariantId,
            ),
          )
          .map(({ classId }) => classId),
      ),
    ];
  }

  async findSourceOwned(id: string, userId: string) {
    const [source] = await this.db
      .select({ kind: imageSources.kind, source: imageSources.source })
      .from(imageSources)
      .innerJoin(images, eq(images.id, imageSources.imageId))
      .where(and(eq(imageSources.imageId, id), eq(images.createdByUserId, userId)))
      .limit(1);
    return source as TikzImageSource | undefined;
  }

  async findVariantOwned(imageId: string, imageVariantId: string, userId: string) {
    const [variant] = await this.db
      .select({ variant: imageVariants })
      .from(imageVariants)
      .innerJoin(images, eq(images.id, imageVariants.imageId))
      .where(
        and(
          eq(imageVariants.id, imageVariantId),
          eq(imageVariants.imageId, imageId),
          eq(images.createdByUserId, userId),
        ),
      )
      .limit(1);
    return variant?.variant;
  }

  async discardOrphans(refs: ImageRef[], userId: string) {
    return this.db.transaction(async (tx) => {
      const storageKeys: string[] = [];
      for (const ref of refs) {
        const [image] = await tx
          .select()
          .from(images)
          .where(and(eq(images.id, ref.imageId), eq(images.createdByUserId, userId)))
          .limit(1)
          .for('update');
        if (!image) continue;

        if (ref.imageVariantId) {
          const [variant] = await tx
            .select()
            .from(imageVariants)
            .where(
              and(eq(imageVariants.id, ref.imageVariantId), eq(imageVariants.imageId, image.id)),
            )
            .limit(1)
            .for('update');
          if (!variant?.orphanedAt) continue;

          storageKeys.push(...(await this.queueVariantDeletion(tx, variant)));
          continue;
        }

        if (!image.orphanedAt) continue;
        storageKeys.push(...(await this.queueImageDeletion(tx, image)));
      }
      return storageKeys;
    });
  }

  async queueExpiredOrphans(cutoff: Date) {
    return this.db.transaction(async (tx) => {
      const storageKeys: string[] = [];
      const expiredImages = await tx
        .select()
        .from(images)
        .where(
          and(
            lte(images.orphanedAt, cutoff),
            sql`not exists (select 1 from ${questionImageRefs} where ${questionImageRefs.imageId} = ${images.id})`,
          ),
        )
        .orderBy(asc(images.orphanedAt), asc(images.id))
        .limit(100)
        .for('update', { skipLocked: true });
      for (const image of expiredImages) {
        storageKeys.push(...(await this.queueImageDeletion(tx, image)));
      }

      const expiredVariants = await tx
        .select()
        .from(imageVariants)
        .where(
          and(
            lte(imageVariants.orphanedAt, cutoff),
            sql`not exists (select 1 from ${questionImageRefs} where ${questionImageRefs.imageVariantId} = ${imageVariants.id})`,
          ),
        )
        .orderBy(asc(imageVariants.orphanedAt), asc(imageVariants.id))
        .limit(100)
        .for('update', { skipLocked: true });
      for (const variant of expiredVariants) {
        storageKeys.push(...(await this.queueVariantDeletion(tx, variant)));
      }
      return storageKeys;
    });
  }

  async listPendingDeletions(afterStorageKey?: string) {
    const pending = await this.db
      .select({ storageKey: storageObjectDeletions.storageKey })
      .from(storageObjectDeletions)
      .where(afterStorageKey ? gt(storageObjectDeletions.storageKey, afterStorageKey) : undefined)
      .orderBy(asc(storageObjectDeletions.storageKey))
      .limit(100);
    return pending.map(({ storageKey }) => storageKey);
  }

  async acknowledgeDeletion(storageKey: string) {
    await this.db
      .delete(storageObjectDeletions)
      .where(eq(storageObjectDeletions.storageKey, storageKey));
  }

  private async queueVariantDeletion(tx: Transaction, variant: typeof imageVariants.$inferSelect) {
    const [reference] = await tx
      .select({ id: questionImageRefs.id })
      .from(questionImageRefs)
      .where(eq(questionImageRefs.imageVariantId, variant.id))
      .limit(1);
    if (reference) return [];

    await tx
      .insert(storageObjectDeletions)
      .values({ storageKey: variant.storageKey })
      .onConflictDoNothing();
    await tx.delete(imageVariants).where(eq(imageVariants.id, variant.id));
    return [variant.storageKey];
  }

  private async queueImageDeletion(tx: Transaction, image: typeof images.$inferSelect) {
    const [reference] = await tx
      .select({ id: questionImageRefs.id })
      .from(questionImageRefs)
      .where(eq(questionImageRefs.imageId, image.id))
      .limit(1);
    if (reference) return [];

    const variants = await tx
      .select({ storageKey: imageVariants.storageKey })
      .from(imageVariants)
      .where(eq(imageVariants.imageId, image.id))
      .for('update');
    const storageKeys = [...variants.map(({ storageKey }) => storageKey), image.storageKey];
    await tx
      .insert(storageObjectDeletions)
      .values(storageKeys.map((storageKey) => ({ storageKey })))
      .onConflictDoNothing();
    await tx.delete(images).where(eq(images.id, image.id));
    return storageKeys;
  }
}
