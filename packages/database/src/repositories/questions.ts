import { ClientError } from '@giaokhoa/application/common/client-error';
import type {
  QuestionsRepository,
  StoredQuestion,
} from '@giaokhoa/application/questions/repository';
import type { FileRef } from '@giaokhoa/shared/files';
import {
  collectFileRefs,
  questionSchema,
  questionStatusSchema,
  stimulusSchema,
  type QuestionCreate,
  type QuestionStatus,
  type Stimulus,
  type StimulusCreate,
  type StimulusPatch,
} from '@giaokhoa/shared/questions';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { examRevisionQuestions } from '../schema/exams.js';
import { authzContexts } from '../schema/authorization.js';
import { files, fileUses } from '../schema/files.js';
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

  async createQuestion(data: QuestionCreate, refs: FileRef[], userId: string) {
    return this.db.transaction(async (tx) => {
      // Luôn khóa stimulus trước file để không đảo thứ tự với updateStimulus.
      await this.lockOwnedStimulus(tx, data.stimulusId, userId);
      await this.validateFileRefs(tx, refs, userId);
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
      await this.replaceFileUses(tx, entry.id, content.id, definition);
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

  /** Lọc owner tại bank entry rồi lấy phiên bản mới nhất; không tiết lộ tồn tại bằng ID. */
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
    refs: FileRef[],
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
      // Luôn khóa stimulus trước file để không đảo thứ tự với updateStimulus.
      await this.lockOwnedStimulus(tx, data.stimulusId, userId);
      await this.validateFileRefs(tx, refs, userId);
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
      // Mỗi phiên bản nội dung giữ các tham chiếu file riêng, kể cả bản nháp đã bị thay thế.
      await this.replaceFileUses(tx, id, content.id, definition);
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

      const [pinned] = await tx
        .select({ id: examRevisionQuestions.examRevisionId })
        .from(examRevisionQuestions)
        .innerJoin(
          questionVersions,
          eq(examRevisionQuestions.questionVersionId, questionVersions.id),
        )
        .where(
          and(
            eq(questionVersions.questionBankEntryId, id),
            eq(questionVersions.version, latest.version),
          ),
        )
        .limit(1);
      if (pinned)
        throw new ClientError(
          'conflict',
          'question_in_exam',
          'Phiên bản câu hỏi đã được chốt vào đề',
        );

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

      const [pinned] = await tx
        .select({ id: examRevisionQuestions.examRevisionId })
        .from(examRevisionQuestions)
        .innerJoin(
          questionVersions,
          eq(examRevisionQuestions.questionVersionId, questionVersions.id),
        )
        .where(eq(questionVersions.questionBankEntryId, id))
        .limit(1);
      if (pinned)
        throw new ClientError('conflict', 'question_in_exam', 'Câu hỏi đã được chốt vào đề');

      const versions = await tx
        .select({ questionId: questionVersions.questionId })
        .from(questionVersions)
        .where(eq(questionVersions.questionBankEntryId, id));
      const questionIds = versions.map(({ questionId }) => questionId);
      const previousFiles = questionIds.length
        ? await tx
            .select({ fileId: fileUses.fileId })
            .from(fileUses)
            .where(and(eq(fileUses.component, 'questions'), inArray(fileUses.itemId, questionIds)))
        : [];
      await this.lockFileIds(
        tx,
        previousFiles.map(({ fileId }) => fileId),
      );

      if (questionIds.length) {
        await tx
          .delete(fileUses)
          .where(and(eq(fileUses.component, 'questions'), inArray(fileUses.itemId, questionIds)));
        await tx.delete(question).where(inArray(question.id, questionIds));
      }
      await tx.delete(questionBankEntries).where(eq(questionBankEntries.id, id));
      await this.markDetachedFiles(
        tx,
        previousFiles.map(({ fileId }) => fileId),
      );
      return { id };
    });
  }

  async createStimulus(data: StimulusCreate, refs: FileRef[], userId: string): Promise<Stimulus> {
    return this.db.transaction(async (tx) => {
      await this.validateFileRefs(tx, refs, userId);
      const [stimulus] = await tx
        .insert(stimuli)
        .values({ ...data, createdByUserId: userId })
        .returning();
      await this.replaceStimulusFileUses(tx, stimulus.id, refs, userId);
      return parseStimulus(stimulus);
    });
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
    refs: FileRef[] | null,
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
      if (refs !== null) {
        const prior = await tx
          .select({ fileId: fileUses.fileId })
          .from(fileUses)
          .where(and(eq(fileUses.component, 'stimuli'), eq(fileUses.itemId, id)));
        // Khóa hợp nhất refs cũ và mới trước khi đổi nội dung để tránh khóa chéo khi sửa đồng thời.
        await this.validateFileRefs(
          tx,
          refs,
          userId,
          prior.map(({ fileId }) => fileId),
        );
      }
      const [updated] = await tx.update(stimuli).set(data).where(owned).returning();
      if (updated && refs !== null) await this.replaceStimulusFileUses(tx, id, refs, userId);
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
      const previousFiles = await tx
        .select({ fileId: fileUses.fileId })
        .from(fileUses)
        .where(and(eq(fileUses.component, 'stimuli'), eq(fileUses.itemId, id)));
      await this.lockFileIds(
        tx,
        previousFiles.map(({ fileId }) => fileId),
      );
      await tx
        .delete(fileUses)
        .where(and(eq(fileUses.component, 'stimuli'), eq(fileUses.itemId, id)));
      const [deleted] = await tx.delete(stimuli).where(owned).returning({ id: stimuli.id });
      await this.markDetachedFiles(
        tx,
        previousFiles.map(({ fileId }) => fileId),
      );
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

  private async lockFileIds(tx: Transaction, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    if (!unique.length) return;
    await tx
      .select({ id: files.id })
      .from(files)
      .where(inArray(files.id, unique))
      .orderBy(sql`case when ${files.parentFileId} is null then 0 else 1 end`, files.id)
      .for('update');
  }

  private async validateFileRefs(
    tx: Transaction,
    refs: FileRef[],
    userId: string,
    extraLockIds: string[] = [],
  ) {
    const originalIds = [...new Set(refs.map(({ fileId }) => fileId))].sort();
    const variants = refs.filter(
      (ref): ref is FileRef & { variantFileId: string } => ref.variantFileId !== null,
    );
    const variantIds = [...new Set(variants.map(({ variantFileId }) => variantFileId))].sort();
    // Khóa theo cây: file gốc trước, crop sau, cùng thứ tự với GC và detach.
    await this.lockFileIds(tx, [...originalIds, ...variantIds, ...extraLockIds]);
    if (!originalIds.length) return;

    const originals = await tx
      .select({ id: files.id, parentFileId: files.parentFileId })
      .from(files)
      .where(and(inArray(files.id, originalIds), eq(files.createdByUserId, userId)));
    if (
      originals.length !== originalIds.length ||
      originals.some(({ parentFileId }) => parentFileId !== null)
    ) {
      throw new ClientError(
        'invalid',
        'question_file_reference_invalid',
        'Nội dung chứa file không tồn tại hoặc không thuộc người dùng',
      );
    }

    if (!variantIds.length) return;
    const ownedVariants = await tx
      .select({ id: files.id, parentFileId: files.parentFileId })
      .from(files)
      .where(and(inArray(files.id, variantIds), eq(files.createdByUserId, userId)));
    const parents = new Map(ownedVariants.map(({ id, parentFileId }) => [id, parentFileId]));
    if (
      ownedVariants.length !== variantIds.length ||
      variants.some(({ fileId, variantFileId }) => parents.get(variantFileId) !== fileId)
    ) {
      throw new ClientError(
        'invalid',
        'question_file_reference_invalid',
        'Nội dung chứa biến thể file không hợp lệ',
      );
    }
  }

  private async ensureContext(
    tx: Transaction,
    kind: 'bank' | 'user',
    resourceKey: string,
  ): Promise<string> {
    await tx.insert(authzContexts).values({ kind, resourceKey }).onConflictDoNothing();
    const [context] = await tx
      .select({ id: authzContexts.id })
      .from(authzContexts)
      .where(and(eq(authzContexts.kind, kind), eq(authzContexts.resourceKey, resourceKey)))
      .limit(1);
    if (!context) throw new Error('Không tạo được file context');
    return context.id;
  }

  private async attachFileUses(
    tx: Transaction,
    contextId: string,
    component: 'questions' | 'stimuli',
    itemId: string,
    areas: Array<{ fileArea: 'content' | 'guidance' | 'solution'; refs: FileRef[] }>,
  ) {
    const rows: Array<{
      fileId: string;
      contextId: string;
      component: string;
      fileArea: string;
      itemId: string;
    }> = [];

    for (const { fileArea, refs } of areas) {
      for (const { fileId, variantFileId } of refs) {
        // Chỉ biến thể đang hiển thị được cấp quyền qua file area nội dung.
        // Original của ảnh crop vẫn được giữ để chủ sở hữu chỉnh sửa, nhưng không phát cho học sinh.
        rows.push({
          fileId: variantFileId ?? fileId,
          contextId,
          component,
          fileArea,
          itemId,
        });
        if (variantFileId) {
          rows.push({ fileId, contextId, component, fileArea: 'original', itemId });
        }
      }
    }
    if (!rows.length) return;

    await tx.insert(fileUses).values(rows).onConflictDoNothing();
    const usedFileIds = [...new Set(rows.map(({ fileId }) => fileId))];
    await tx.update(files).set({ orphanedAt: null }).where(inArray(files.id, usedFileIds));
    // File đã được attach không cần giữ thêm draft reference.
    await tx
      .delete(fileUses)
      .where(
        and(
          inArray(fileUses.fileId, usedFileIds),
          eq(fileUses.component, 'user'),
          eq(fileUses.fileArea, 'draft'),
        ),
      );
  }

  private async replaceFileUses(
    tx: Transaction,
    bankEntryId: string,
    questionContentId: string,
    definition: Pick<QuestionCreate, 'content' | 'guidance' | 'solution'>,
  ) {
    const contextId = await this.ensureContext(tx, 'bank', bankEntryId);
    await this.attachFileUses(tx, contextId, 'questions', questionContentId, [
      { fileArea: 'content', refs: collectFileRefs(definition.content) },
      { fileArea: 'guidance', refs: collectFileRefs(definition.guidance) },
      { fileArea: 'solution', refs: collectFileRefs(definition.solution) },
    ]);
  }

  private async replaceStimulusFileUses(
    tx: Transaction,
    stimulusId: string,
    refs: FileRef[],
    userId: string,
  ) {
    const previous = await tx
      .select({ fileId: fileUses.fileId })
      .from(fileUses)
      .where(and(eq(fileUses.component, 'stimuli'), eq(fileUses.itemId, stimulusId)));
    await tx
      .delete(fileUses)
      .where(and(eq(fileUses.component, 'stimuli'), eq(fileUses.itemId, stimulusId)));
    const contextId = await this.ensureContext(tx, 'user', userId);
    await this.attachFileUses(tx, contextId, 'stimuli', stimulusId, [
      { fileArea: 'content', refs },
    ]);
    await this.markDetachedFiles(
      tx,
      previous.map(({ fileId }) => fileId),
    );
  }

  private async markDetachedFiles(tx: Transaction, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    if (!unique.length) return;
    await this.lockFileIds(tx, unique);
    const remaining = await tx
      .select({ fileId: fileUses.fileId })
      .from(fileUses)
      .where(inArray(fileUses.fileId, unique));
    const attached = new Set(remaining.map(({ fileId }) => fileId));
    const orphaned = unique.filter((id) => !attached.has(id));
    if (orphaned.length) {
      await tx.update(files).set({ orphanedAt: new Date() }).where(inArray(files.id, orphaned));
    }
  }
}
