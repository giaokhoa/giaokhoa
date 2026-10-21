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

/**
 * Ghép định danh câu hỏi trong ngân hàng, số phiên bản và trạng thái với bản ghi nội dung riêng.
 * Không đưa mã bản ghi nội dung nội bộ ra ngoài; câu hỏi hiển thị luôn mang danh tính ổn định từ mục ngân hàng.
 * Xác thực dữ liệu theo hợp đồng câu hỏi trước khi trả về tầng nghiệp vụ.
 */
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

/**
 * Chuyển ngữ liệu (stimulus) thành dữ liệu trả về đã được xác thực.
 * Loại mã người tạo nội bộ khỏi nội dung ngữ liệu, vì quyền sở hữu được kiểm tra ở phương thức truy xuất.
 */
function parseStimulus(row: typeof stimuli.$inferSelect) {
  const { createdByUserId: _owner, ...publicStimulus } = row;
  return stimulusSchema.parse(publicStimulus);
}

/**
 * Tạo lỗi khi phiên bản câu hỏi đã thay đổi so với phiên bản người dùng đang sửa.
 * Buộc tải lại để tránh hai thao tác đồng thời ghi đè nội dung của nhau.
 */
function revisionChanged() {
  return new ClientError(
    'conflict',
    'question_version_conflict',
    'Phiên bản câu hỏi đã thay đổi, hãy tải lại trước khi chỉnh sửa',
  );
}

/**
 * Lớp truy cập PostgreSQL cho ngân hàng câu hỏi, các phiên bản nội dung và ngữ liệu.
 * Giữ quyền sở hữu, phiên bản bất biến và tham chiếu tệp nhất quán khi tạo, sửa, công bố hoặc xóa câu hỏi.
 */
export class PostgresQuestionsRepository implements QuestionsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Tạo mục ngân hàng, bản nội dung đầu tiên và liên kết phiên bản số 1 trong cùng giao dịch.
   * Kiểm tra quyền sở hữu ngữ liệu và các tệp được tham chiếu trước khi ghi; gắn tệp vào đúng bản nội dung ngay khi tạo.
   * @param refs Những tham chiếu tệp được trích từ nội dung để đối chiếu quyền sử dụng.
   */
  async createQuestion(data: QuestionCreate, refs: FileRef[], userId: string) {
    return this.db.transaction(async (tx) => {
      // Luôn khóa ngữ liệu (stimulus) trước tệp, cùng thứ tự với thao tác cập nhật ngữ liệu.
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

  /**
   * Đọc phiên bản mới nhất của một câu hỏi theo mã mục ngân hàng.
   * Không kiểm tra chủ sở hữu ở phương thức này; tầng gọi phải kiểm soát quyền trước khi cho phép xem nội dung.
   */
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

  /**
   * Chỉ lấy phiên bản mới nhất đã ở trạng thái sẵn sàng (ready).
   * Dùng cho đường chọn câu hỏi có thể sử dụng, không mặc định bản nháp mới nhất là nội dung đã được công bố.
   */
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

  /**
   * Lấy phiên bản mới nhất của câu hỏi khi người yêu cầu sở hữu mục ngân hàng.
   * Kiểm tra chủ sở hữu ngay trong truy vấn để không tiết lộ sự tồn tại
   * hay nội dung câu hỏi của người khác.
   */
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

  /**
   * Tìm đúng số phiên bản thuộc một mục ngân hàng câu hỏi.
   * Giữ nội dung đã lưu của phiên bản đó, không tự chọn phiên bản mới hơn.
   */
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

  /**
   * Liệt kê số phiên bản và trạng thái từ mới đến cũ của một câu hỏi.
   * Không tải toàn bộ nội dung từng phiên bản khi chỉ cần lịch sử số phiên bản và trạng thái.
   */
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

  /**
   * Tạo bản nội dung mới mà không ghi đè các phiên bản câu hỏi trước đó.
   * Khóa mục ngân hàng câu hỏi để ngăn thao tác song song; yêu cầu expectedVersion khớp phiên bản mới nhất trước khi tăng số phiên bản.
   * Kiểm tra lại quyền với ngữ liệu và tệp; mỗi bản nội dung giữ tham chiếu tệp riêng.
   */
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
      // Luôn khóa ngữ liệu (stimulus) trước tệp, cùng thứ tự với thao tác cập nhật ngữ liệu.
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
      // Mỗi phiên bản nội dung giữ tham chiếu tệp riêng, kể cả bản nháp đã bị thay thế.
      await this.replaceFileUses(tx, id, content.id, definition);
      return parseStoredQuestion(id, userId, nextVersion, status, content);
    });
  }

  /**
   * Đổi trạng thái phiên bản mới nhất khi chủ sở hữu cung cấp đúng số phiên bản dự kiến.
   * Không cho đổi trạng thái của bản câu hỏi đã chốt vào đề thi; khi chuyển sang sẵn sàng, khóa và kiểm tra ngữ liệu thuộc chủ sở hữu.
   * Thao tác chỉ đổi trạng thái, không tạo bản nội dung mới.
   */
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

      // Khi chuyển câu hỏi từ nháp sang sẵn sàng, khóa ngữ liệu cùng cách với thao tác chỉnh sửa ngữ liệu.
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

  /**
   * Xóa câu hỏi cùng toàn bộ phiên bản nội dung khi không phiên bản nào đã được chốt vào đề.
   * Khóa mục ngân hàng và các tệp liên quan, gỡ vị trí sử dụng tệp rồi đánh dấu tệp không còn tham chiếu để thu gom an toàn.
   * Không xóa dữ liệu đề đã phát hành chỉ để đáp ứng yêu cầu xóa câu hỏi nguồn.
   */
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

  /**
   * Tạo ngữ liệu dùng chung và gắn tệp thuộc quyền người tạo vào nội dung ngữ liệu.
   * Đồng bộ tạo bản ghi và vị trí sử dụng tệp trong cùng giao dịch để không có ngữ liệu chứa ảnh chưa được liên kết.
   */
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

  /**
   * Tra ngữ liệu theo cả mã và chủ sở hữu.
   * Không trả dữ liệu khi ngữ liệu không thuộc người gọi; tránh để lộ nội dung dùng chung của tác giả khác.
   */
  async findStimulusOwned(id: string, userId: string): Promise<Stimulus | undefined> {
    const [stimulus] = await this.db
      .select()
      .from(stimuli)
      .where(and(eq(stimuli.id, id), eq(stimuli.createdByUserId, userId)))
      .limit(1);
    return stimulus ? parseStimulus(stimulus) : undefined;
  }

  /**
   * Chỉ sửa ngữ liệu khi chưa có phiên bản câu hỏi nào đang tham chiếu đến nó.
   * Khóa ngữ liệu và các tệp cũ/mới trước khi sửa để bảo toàn nội dung phiên bản đã lưu và tránh tranh chấp với thu gom tệp.
   * @param refs Danh sách tham chiếu mới, hoặc null nếu không thay đổi phần tham chiếu tệp.
   */
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
        // Khóa tập hợp tham chiếu tệp cũ và mới trước khi đổi nội dung để tránh kẹt khóa khi sửa đồng thời.
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

  /**
   * Xóa ngữ liệu thuộc chủ sở hữu nếu không câu hỏi nào còn tham chiếu.
   * Gỡ vị trí sử dụng tệp, khóa các tệp liên quan và đánh dấu tệp trở thành không được sử dụng; không xóa tệp trực tiếp trong giao dịch này.
   */
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

  /**
   * Khóa ngữ liệu người dùng sở hữu trước khi gắn vào câu hỏi hoặc đổi trạng thái câu hỏi.
   * Nếu mã ngữ liệu trống thì bỏ qua; ngược lại yêu cầu tồn tại và đúng chủ để không gắn nội dung của người khác.
   */
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

  /**
   * Từ chối sửa ngữ liệu khi đã có bản nội dung câu hỏi sử dụng.
   * Giữ nguyên ý nghĩa của các phiên bản câu hỏi đã lưu; nếu cần nội dung khác thì phải tạo ngữ liệu mới.
   */
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

  /**
   * Khóa tập hợp bản ghi tệp theo thứ tự cố định để các giao dịch gắn, gỡ và thu gom không kẹt khóa.
   * Loại mã trùng, khóa ảnh gốc trước ảnh biến thể rồi theo mã UUID; không làm gì khi tập hợp rỗng.
   */
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

  /**
   * Xác minh mọi tệp trong nội dung đều thuộc người tạo và các biến thể thực sự là con của ảnh gốc đã chỉ định.
   * Khóa cả tệp hiện tại và tệp sắp thay đổi theo cùng thứ tự để tránh việc tệp bị xóa hoặc đổi tham chiếu giữa lúc xác minh.
   * @param extraLockIds Những tệp cũ cần khóa cùng tham chiếu mới khi thay thế nội dung.
   */
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
    // Khóa theo cây: tệp gốc trước, ảnh cắt (crop) sau, cùng thứ tự với thu gom và gỡ liên kết.
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

  /**
   * Tạo nếu chưa có và trả mã phạm vi phân quyền (authorization context) cho người dùng hoặc ngân hàng câu hỏi.
   * Dùng thao tác chèn bỏ qua xung đột để hai giao dịch cùng tạo một phạm vi không sinh bản ghi trùng.
   */
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

  /**
   * Ghi vị trí sử dụng của tệp theo phân hệ, đối tượng và vùng nội dung cụ thể.
   * Ảnh biến thể đang hiển thị được gắn tại vùng nội dung; ảnh gốc chỉ giữ trong vùng chỉnh sửa để không lộ cho học sinh.
   * Xóa vị trí nháp và bỏ dấu tệp không còn sử dụng khi đã được gắn hợp lệ.
   */
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
        // Chỉ biến thể đang hiển thị được cấp quyền thông qua vùng nội dung của tệp.
        // Ảnh gốc của bản cắt vẫn được giữ cho chủ sở hữu chỉnh sửa, nhưng không cấp cho học sinh.
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
    // Tệp đã gắn vào nội dung không cần tiếp tục giữ tham chiếu ở vùng nháp.
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

  /**
   * Ghi tham chiếu tệp cho đúng bản nội dung câu hỏi vừa tạo và phạm vi ngân hàng tương ứng.
   * Tách các vùng nội dung chính, hướng dẫn và lời giải để cấp quyền đọc khác nhau; không xóa tham chiếu của các phiên bản cũ.
   */
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

  /**
   * Thay thế các vị trí sử dụng tệp của một ngữ liệu sau khi sửa nội dung.
   * Gỡ liên kết cũ, gắn liên kết mới trong phạm vi người sở hữu rồi đánh dấu tệp cũ không còn được dùng.
   * Phải thực hiện trong cùng giao dịch với việc cập nhật ngữ liệu.
   */
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

  /**
   * Đánh dấu thời điểm tệp không còn bất kỳ vị trí sử dụng nào sau khi gỡ liên kết.
   * Khóa tệp, kiểm tra lại mọi vị trí còn tồn tại; không xóa ngay vì thu gom tệp được thực hiện theo một quy trình an toàn riêng.
   */
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
