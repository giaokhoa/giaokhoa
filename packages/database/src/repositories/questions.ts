import { ClientError } from '@giaokhoa/application/common/client-error';
import type {
  QuestionsRepository,
  StoredQuestion,
} from '@giaokhoa/application/questions/repository';
import type { ImageRef } from '@giaokhoa/shared/images';
import {
  questionSchema,
  stimulusSchema,
  type QuestionCreate,
  type Stimulus,
  type StimulusCreate,
  type StimulusPatch,
} from '@giaokhoa/shared/questions';
import { and, eq, inArray } from 'drizzle-orm';
import { images, imageVariants, questionImageRefs } from '../schema/images.js';
import { questions, stimuli } from '../schema/questions.js';
import type { Database } from '../types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function parseStoredQuestion(row: typeof questions.$inferSelect): StoredQuestion {
  const { createdByUserId, ...question } = row;
  return { ...questionSchema.parse(question), createdByUserId };
}

function parseStimulus(row: typeof stimuli.$inferSelect) {
  return stimulusSchema.parse(row);
}

export class PostgresQuestionsRepository implements QuestionsRepository {
  constructor(private readonly db: Database) {}

  async createQuestion(data: QuestionCreate, refs: ImageRef[], userId: string) {
    return this.db.transaction(async (tx) => {
      await this.validateImageRefs(tx, refs, userId);
      const [question] = await tx
        .insert(questions)
        .values({ ...data, createdByUserId: userId })
        .returning();
      await this.replaceImageRefs(tx, question.id, [], refs);
      return parseStoredQuestion(question);
    });
  }

  async findQuestion(id: string) {
    const [question] = await this.db.select().from(questions).where(eq(questions.id, id)).limit(1);
    return question ? parseStoredQuestion(question) : undefined;
  }

  async findQuestionOwned(id: string, userId: string) {
    const [question] = await this.db
      .select()
      .from(questions)
      .where(and(eq(questions.id, id), eq(questions.createdByUserId, userId)))
      .limit(1);
    return question ? parseStoredQuestion(question) : undefined;
  }

  async updateQuestion(id: string, data: QuestionCreate, refs: ImageRef[], userId: string) {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.createdByUserId, userId)))
        .limit(1)
        .for('update');
      if (!owned) return undefined;

      await this.validateImageRefs(tx, refs, userId);
      const previousRefs = await tx
        .select({
          imageId: questionImageRefs.imageId,
          imageVariantId: questionImageRefs.imageVariantId,
        })
        .from(questionImageRefs)
        .where(eq(questionImageRefs.questionId, id));
      const [question] = await tx
        .update(questions)
        .set(data)
        .where(eq(questions.id, id))
        .returning();
      await this.replaceImageRefs(tx, id, previousRefs, refs);
      return question ? parseStoredQuestion(question) : undefined;
    });
  }

  async deleteQuestion(id: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.createdByUserId, userId)))
        .limit(1)
        .for('update');
      if (!owned) return undefined;

      const previousRefs = await tx
        .select({
          imageId: questionImageRefs.imageId,
          imageVariantId: questionImageRefs.imageVariantId,
        })
        .from(questionImageRefs)
        .where(eq(questionImageRefs.questionId, id));
      const [question] = await tx
        .delete(questions)
        .where(eq(questions.id, id))
        .returning({ id: questions.id });
      if (question) await this.markDetachedRefs(tx, previousRefs);
      return question;
    });
  }

  async createStimulus(data: StimulusCreate): Promise<Stimulus> {
    const [stimulus] = await this.db.insert(stimuli).values(data).returning();
    return parseStimulus(stimulus);
  }

  async findStimulus(id: string): Promise<Stimulus | undefined> {
    const [stimulus] = await this.db.select().from(stimuli).where(eq(stimuli.id, id)).limit(1);
    return stimulus ? parseStimulus(stimulus) : undefined;
  }

  async updateStimulus(id: string, data: StimulusPatch): Promise<Stimulus | undefined> {
    const [stimulus] = await this.db
      .update(stimuli)
      .set(data)
      .where(eq(stimuli.id, id))
      .returning();
    return stimulus ? parseStimulus(stimulus) : undefined;
  }

  async deleteStimulus(id: string) {
    const [stimulus] = await this.db
      .delete(stimuli)
      .where(eq(stimuli.id, id))
      .returning({ id: stimuli.id });
    return stimulus;
  }

  private async validateImageRefs(tx: Transaction, refs: ImageRef[], userId: string) {
    const imageIds = [...new Set(refs.map(({ imageId }) => imageId))];
    if (!imageIds.length) return;

    const ownedAssets = await tx
      .select({ id: images.id })
      .from(images)
      .where(and(inArray(images.id, imageIds), eq(images.createdByUserId, userId)))
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
    const now = new Date();
    const imageIds = [...new Set(refs.map(({ imageId }) => imageId))];
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
