import { ClientError } from '@giaokhoa/application/common/client-error';
import type {
  QuestionsRepository,
  StoredQuestion,
} from '@giaokhoa/application/questions/repository';
import type { ImageRef } from '@giaokhoa/shared/images';
import {
  questionSchema,
  questionStatusSchema,
  stimulusSchema,
  type QuestionCreate,
  type QuestionStatus,
  type Stimulus,
  type StimulusCreate,
  type StimulusPatch,
} from '@giaokhoa/shared/questions';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { images, imageVariants, questionImageRefs } from '../schema/images.js';
import { question, questionBankEntries, questionVersions, stimuli } from '../schema/questions.js';
import type { Database } from '../types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type QuestionRow = typeof question.$inferSelect;

function parseStoredQuestion(
  entryId: string,
  ownerId: string,
  version: number,
  status: string,
  row: QuestionRow,
): StoredQuestion {
  const { id: _contentId, createdByUserId: _authorId, ...definition } = row;
  return {
    ...questionSchema.parse({ ...definition, id: entryId, version, status }),
    createdByUserId: ownerId,
  };
}

function parseStimulus(row: typeof stimuli.$inferSelect) {
  const { createdByUserId: _owner, ...publicStimulus } = row;
  return stimulusSchema.parse(publicStimulus);
}

function revisionChanged() {
  return new ClientError(
    'conflict',
    'question_version_conflict',
    'Phiên bản câu hỏi đã thay đổi, hãy tải lại trước khi chỉnh sửa',
  );
}

export class PostgresQuestionsRepository implements QuestionsRepository {
  constructor(private readonly db: Database) {}

  async createQuestion(data: QuestionCreate, refs: ImageRef[], userId: string) {
    return this.db.transaction(async (tx) => {
      await this.validateImageRefs(tx, refs, userId);
      await this.lockOwnedStimulus(tx, data.stimulusId, userId);
      const [entry] = await tx
        .insert(questionBankEntries)
        .values({ createdByUserId: userId })
        .returning();
      const { status, ...definition } = data;
      const [content] = await tx
        .insert(question)
        .values({ ...definition, createdByUserId: userId })
        .returning();
      await tx.insert(questionVersions).values({
        questionBankEntryId: entry.id,
        questionId: content.id,
        version: 1,
        status,
      });
      await this.replaceImageRefs(tx, content.id, [], refs);
      return parseStoredQuestion(entry.id, userId, 1, status, content);
    });
  }

  async findQuestion(id: string) {
    const [row] = await this.db
      .select({
        entryId: questionBankEntries.id,
        ownerId: questionBankEntries.createdByUserId,
        version: questionVersions.version,
        status: questionVersions.status,
        content: question,
      })
      .from(questionBankEntries)
      .innerJoin(questionVersions, eq(questionVersions.questionBankEntryId, questionBankEntries.id))
      .innerJoin(question, eq(question.id, questionVersions.questionId))
      .where(eq(questionBankEntries.id, id))
      .orderBy(desc(questionVersions.version))
      .limit(1);
    return row
      ? parseStoredQuestion(row.entryId, row.ownerId, row.version, row.status, row.content)
      : undefined;
  }

  async findLatestReadyQuestion(id: string) {
    const [row] = await this.db
      .select({
        entryId: questionBankEntries.id,
        ownerId: questionBankEntries.createdByUserId,
        version: questionVersions.version,
        status: questionVersions.status,
        content: question,
      })
      .from(questionBankEntries)
      .innerJoin(questionVersions, eq(questionVersions.questionBankEntryId, questionBankEntries.id))
      .innerJoin(question, eq(question.id, questionVersions.questionId))
      .where(and(eq(questionBankEntries.id, id), eq(questionVersions.status, 'ready')))
      .orderBy(desc(questionVersions.version))
      .limit(1);
    return row
      ? parseStoredQuestion(row.entryId, row.ownerId, row.version, row.status, row.content)
      : undefined;
  }

  async findQuestionOwned(id: string, userId: string) {
    const [row] = await this.db
      .select({
        entryId: questionBankEntries.id,
        ownerId: questionBankEntries.createdByUserId,
        version: questionVersions.version,
        status: questionVersions.status,
        content: question,
      })
      .from(questionBankEntries)
      .innerJoin(questionVersions, eq(questionVersions.questionBankEntryId, questionBankEntries.id))
      .innerJoin(question, eq(question.id, questionVersions.questionId))
      .where(and(eq(questionBankEntries.id, id), eq(questionBankEntries.createdByUserId, userId)))
      .orderBy(desc(questionVersions.version))
      .limit(1);
    return row
      ? parseStoredQuestion(row.entryId, row.ownerId, row.version, row.status, row.content)
      : undefined;
  }

  async findQuestionVersion(id: string, version: number) {
    const [row] = await this.db
      .select({
        entryId: questionBankEntries.id,
        ownerId: questionBankEntries.createdByUserId,
        version: questionVersions.version,
        status: questionVersions.status,
        content: question,
      })
      .from(questionBankEntries)
      .innerJoin(questionVersions, eq(questionVersions.questionBankEntryId, questionBankEntries.id))
      .innerJoin(question, eq(question.id, questionVersions.questionId))
      .where(and(eq(questionBankEntries.id, id), eq(questionVersions.version, version)))
      .limit(1);
    return row
      ? parseStoredQuestion(row.entryId, row.ownerId, row.version, row.status, row.content)
      : undefined;
  }

  async listQuestionVersions(id: string) {
    const [entry] = await this.db
      .select({ id: questionBankEntries.id })
      .from(questionBankEntries)
      .where(eq(questionBankEntries.id, id))
      .limit(1);
    if (!entry) return [];

    const rows = await this.db
      .select({ version: questionVersions.version, status: questionVersions.status })
      .from(questionVersions)
      .where(eq(questionVersions.questionBankEntryId, id))
      .orderBy(desc(questionVersions.version));
    return rows.map((row) => ({
      version: row.version,
      status: questionStatusSchema.parse(row.status),
    }));
  }

  async createQuestionVersion(
    id: string,
    expectedVersion: number,
    data: QuestionCreate,
    refs: ImageRef[],
    userId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: questionBankEntries.id })
        .from(questionBankEntries)
        .where(and(eq(questionBankEntries.id, id), eq(questionBankEntries.createdByUserId, userId)))
        .limit(1)
        .for('update');
      if (!owned) return undefined;

      const [latest] = await tx
        .select({
          questionId: questionVersions.questionId,
          version: questionVersions.version,
          status: questionVersions.status,
        })
        .from(questionVersions)
        .where(eq(questionVersions.questionBankEntryId, id))
        .orderBy(desc(questionVersions.version))
        .limit(1);
      if (!latest || latest.version !== expectedVersion) throw revisionChanged();
      await this.validateImageRefs(tx, refs, userId);
      await this.lockOwnedStimulus(tx, data.stimulusId, userId);
      const { status, ...definition } = data;

      const [content] = await tx
        .insert(question)
        .values({ ...definition, createdByUserId: userId })
        .returning();
      const nextVersion = latest.version + 1;
      await tx.insert(questionVersions).values({
        questionBankEntryId: id,
        questionId: content.id,
        version: nextVersion,
        status,
      });
      // Mỗi phiên bản nội dung sở hữu tham chiếu ảnh riêng, kể cả bản nháp đã bị thay thế.
      await this.replaceImageRefs(tx, content.id, [], refs);
      return parseStoredQuestion(id, userId, nextVersion, status, content);
    });
  }

  async changeQuestionStatus(
    id: string,
    expectedVersion: number,
    status: QuestionStatus,
    userId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: questionBankEntries.id })
        .from(questionBankEntries)
        .where(and(eq(questionBankEntries.id, id), eq(questionBankEntries.createdByUserId, userId)))
        .limit(1)
        .for('update');
      if (!owned) return undefined;

      const [latest] = await tx
        .select({
          version: questionVersions.version,
          status: questionVersions.status,
          content: question,
        })
        .from(questionVersions)
        .innerJoin(question, eq(question.id, questionVersions.questionId))
        .where(eq(questionVersions.questionBankEntryId, id))
        .orderBy(desc(questionVersions.version))
        .limit(1);
      if (!latest || latest.version !== expectedVersion) throw revisionChanged();
      if (latest.status === status) {
        return parseStoredQuestion(id, userId, latest.version, status, latest.content);
      }

      // Chuyển từ nháp sang sẵn sàng dùng chung khóa stimulus với thao tác chỉnh sửa stimulus.
      if (status === 'ready') await this.lockOwnedStimulus(tx, latest.content.stimulusId, userId);
      await tx
        .update(questionVersions)
        .set({ status })
        .where(
          and(
            eq(questionVersions.questionBankEntryId, id),
            eq(questionVersions.version, latest.version),
          ),
        );
      return parseStoredQuestion(id, userId, latest.version, status, latest.content);
    });
  }

  async deleteQuestion(id: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: questionBankEntries.id })
        .from(questionBankEntries)
        .where(and(eq(questionBankEntries.id, id), eq(questionBankEntries.createdByUserId, userId)))
        .limit(1)
        .for('update');
      if (!owned) return undefined;

      const versions = await tx
        .select({ questionId: questionVersions.questionId })
        .from(questionVersions)
        .where(eq(questionVersions.questionBankEntryId, id));
      const questionIds = versions.map(({ questionId }) => questionId);
      const previousRefs = questionIds.length
        ? await tx
            .select({
              imageId: questionImageRefs.imageId,
              imageVariantId: questionImageRefs.imageVariantId,
            })
            .from(questionImageRefs)
            .where(inArray(questionImageRefs.questionId, questionIds))
        : [];

      if (questionIds.length) {
        await tx.delete(question).where(inArray(question.id, questionIds));
      }
      await tx.delete(questionBankEntries).where(eq(questionBankEntries.id, id));
      await this.markDetachedRefs(tx, previousRefs);
      return { id };
    });
  }

  async createStimulus(data: StimulusCreate, userId: string): Promise<Stimulus> {
    const [stimulus] = await this.db
      .insert(stimuli)
      .values({ ...data, createdByUserId: userId })
      .returning();
    return parseStimulus(stimulus);
  }

  async findStimulusOwned(id: string, userId: string): Promise<Stimulus | undefined> {
    const [stimulus] = await this.db
      .select()
      .from(stimuli)
      .where(and(eq(stimuli.id, id), eq(stimuli.createdByUserId, userId)))
      .limit(1);
    return stimulus ? parseStimulus(stimulus) : undefined;
  }

  async updateStimulus(
    id: string,
    data: StimulusPatch,
    userId: string,
  ): Promise<Stimulus | undefined> {
    return this.db.transaction(async (tx) => {
      const owned = and(eq(stimuli.id, id), eq(stimuli.createdByUserId, userId));
      const [existing] = await tx
        .select({ id: stimuli.id })
        .from(stimuli)
        .where(owned)
        .limit(1)
        .for('update');
      if (!existing) return undefined;
      await this.assertStimulusUnreferenced(tx, id);
      const [updated] = await tx.update(stimuli).set(data).where(owned).returning();
      return updated ? parseStimulus(updated) : undefined;
    });
  }

  async deleteStimulus(id: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const owned = and(eq(stimuli.id, id), eq(stimuli.createdByUserId, userId));
      const [existing] = await tx
        .select({ id: stimuli.id })
        .from(stimuli)
        .where(owned)
        .limit(1)
        .for('update');
      if (!existing) return undefined;
      const [inUse] = await tx
        .select({ id: question.id })
        .from(question)
        .where(eq(question.stimulusId, id))
        .limit(1);
      if (inUse) {
        throw new ClientError('conflict', 'stimulus_in_use', 'Ngữ liệu đang được câu hỏi sử dụng');
      }
      const [deleted] = await tx.delete(stimuli).where(owned).returning({ id: stimuli.id });
      return deleted;
    });
  }

  private async lockOwnedStimulus(
    tx: Transaction,
    stimulusId: string | null | undefined,
    userId: string,
  ) {
    if (!stimulusId) return;
    const [existing] = await tx
      .select({ id: stimuli.id })
      .from(stimuli)
      .where(and(eq(stimuli.id, stimulusId), eq(stimuli.createdByUserId, userId)))
      .limit(1)
      .for('update');
    if (!existing) {
      throw new ClientError(
        'invalid',
        'stimulus_invalid',
        'Ngữ liệu không tồn tại hoặc không thuộc người dùng',
      );
    }
  }

  private async assertStimulusUnreferenced(tx: Transaction, id: string) {
    const [inUse] = await tx
      .select({ id: question.id })
      .from(question)
      .where(eq(question.stimulusId, id))
      .limit(1);
    if (inUse) {
      throw new ClientError(
        'conflict',
        'stimulus_in_use',
        'Ngữ liệu thuộc phiên bản câu hỏi đã lưu, hãy tạo ngữ liệu mới để chỉnh sửa',
      );
    }
  }

  private async lockImageRefs(tx: Transaction, refs: ImageRef[]) {
    const imageIds = [...new Set(refs.map(({ imageId }) => imageId))].sort();
    if (imageIds.length) {
      await tx
        .select({ id: images.id })
        .from(images)
        .where(inArray(images.id, imageIds))
        .orderBy(images.id)
        .for('update');
    }
    const variantIds = [
      ...new Set(refs.flatMap(({ imageVariantId }) => (imageVariantId ? [imageVariantId] : []))),
    ].sort();
    if (variantIds.length) {
      await tx
        .select({ id: imageVariants.id })
        .from(imageVariants)
        .where(inArray(imageVariants.id, variantIds))
        .orderBy(imageVariants.id)
        .for('update');
    }
  }

  private async validateImageRefs(tx: Transaction, refs: ImageRef[], userId: string) {
    const imageIds = [...new Set(refs.map(({ imageId }) => imageId))];
    if (!imageIds.length) return;

    const ownedAssets = await tx
      .select({ id: images.id })
      .from(images)
      .where(and(inArray(images.id, imageIds), eq(images.createdByUserId, userId)))
      .orderBy(images.id)
      .for('update');

    if (ownedAssets.length !== imageIds.length) {
      throw new ClientError(
        'invalid',
        'question_image_reference_invalid',
        'Question chứa ảnh không tồn tại hoặc không thuộc người dùng',
      );
    }

    const variantRefs = refs.filter(
      (ref): ref is ImageRef & { imageVariantId: string } => ref.imageVariantId !== null,
    );
    const imageVariantIds = [...new Set(variantRefs.map(({ imageVariantId }) => imageVariantId))];
    if (!imageVariantIds.length) return;

    const variants = await tx
      .select({ id: imageVariants.id, imageId: imageVariants.imageId })
      .from(imageVariants)
      .where(inArray(imageVariants.id, imageVariantIds))
      .orderBy(imageVariants.id)
      .for('update');

    const byId = new Map(variants.map((variant) => [variant.id, variant.imageId]));
    if (
      variants.length !== imageVariantIds.length ||
      variantRefs.some(({ imageId, imageVariantId }) => byId.get(imageVariantId) !== imageId)
    ) {
      throw new ClientError(
        'invalid',
        'question_image_reference_invalid',
        'Question chứa phiên bản ảnh không hợp lệ',
      );
    }
  }

  private async replaceImageRefs(
    tx: Transaction,
    questionId: string,
    previousRefs: ImageRef[],
    nextRefs: ImageRef[],
  ) {
    await tx.delete(questionImageRefs).where(eq(questionImageRefs.questionId, questionId));

    if (nextRefs.length) {
      await tx
        .insert(questionImageRefs)
        .values(
          nextRefs.map(({ imageId, imageVariantId }) => ({ questionId, imageId, imageVariantId })),
        );
      const imageIds = [...new Set(nextRefs.map(({ imageId }) => imageId))];
      await tx.update(images).set({ orphanedAt: null }).where(inArray(images.id, imageIds));

      const imageVariantIds = [
        ...new Set(
          nextRefs.flatMap(({ imageVariantId }) => (imageVariantId ? [imageVariantId] : [])),
        ),
      ];
      if (imageVariantIds.length) {
        await tx
          .update(imageVariants)
          .set({ orphanedAt: null })
          .where(inArray(imageVariants.id, imageVariantIds));
      }
    }

    await this.markDetachedRefs(tx, previousRefs);
  }

  private async markDetachedRefs(tx: Transaction, refs: ImageRef[]) {
    await this.lockImageRefs(tx, refs);
    const now = new Date();
    const imageIds = [...new Set(refs.map(({ imageId }) => imageId))].sort();
    if (imageIds.length) {
      const stillReferenced = await tx
        .select({ imageId: questionImageRefs.imageId })
        .from(questionImageRefs)
        .where(inArray(questionImageRefs.imageId, imageIds));
      const used = new Set(stillReferenced.map(({ imageId }) => imageId));
      const orphaned = imageIds.filter((id) => !used.has(id));
      if (orphaned.length) {
        await tx.update(images).set({ orphanedAt: now }).where(inArray(images.id, orphaned));
      }
    }

    const imageVariantIds = [
      ...new Set(refs.flatMap(({ imageVariantId }) => (imageVariantId ? [imageVariantId] : []))),
    ];
    if (imageVariantIds.length) {
      const stillReferenced = await tx
        .select({ imageVariantId: questionImageRefs.imageVariantId })
        .from(questionImageRefs)
        .where(inArray(questionImageRefs.imageVariantId, imageVariantIds));
      const used = new Set(
        stillReferenced.flatMap(({ imageVariantId }) => (imageVariantId ? [imageVariantId] : [])),
      );
      const orphaned = imageVariantIds.filter((id) => !used.has(id));
      if (orphaned.length) {
        await tx
          .update(imageVariants)
          .set({ orphanedAt: now })
          .where(inArray(imageVariants.id, orphaned));
      }
    }
  }
}
