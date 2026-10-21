import { ClientError } from '@giaokhoa/application/common/client-error';
import type {
  CreateFileData,
  CreateFileVariantData,
  FileRecord,
  FilesRepository,
} from '@giaokhoa/application/files/repository';
import type { FileRef, TikzFileSource } from '@giaokhoa/shared/files';
import { collectFileRefs, questionSchema, stimulusSchema } from '@giaokhoa/shared/questions';
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { users } from '../schema/auth.generated.js';
import { attempts } from '../schema/attempts.js';
import { assignmentRecipients, assignments } from '../schema/assignments.js';
import { authzContexts } from '../schema/authorization.js';
import { classEnrolments, classes } from '../schema/classes.js';
import { examRevisionQuestions } from '../schema/exams.js';
import { fileBlobs, fileObjectDeletions, files, fileSources, fileUses } from '../schema/files.js';
import { question, questionVersions, stimuli } from '../schema/questions.js';
import type { Database } from '../types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type FileRow = typeof files.$inferSelect;

function toFileRecord(file: FileRow, blob: typeof fileBlobs.$inferSelect): FileRecord {
  return { ...file, storageKey: blob.storageKey, byteSize: blob.byteSize };
}

/**
 * Lớp truy cập PostgreSQL cho tệp, đối tượng dữ liệu dùng chung và các vị trí sử dụng.
 * Kiểm tra quyền đọc theo nội dung thực tế và phối hợp hàng đợi xóa để không xóa nhầm đối tượng đang được tham chiếu.
 */
export class PostgresFilesRepository implements FilesRepository {
  constructor(private readonly db: Database) {}

  async reserveUpload(storageKey: string): Promise<void> {
    // Đây là ý định tải lên (upload intent), chưa phải lệnh xóa ngay: trì hoãn 48 giờ
    // để tác vụ thu gom không tranh chấp với yêu cầu đang tải tệp hoặc ghi thông tin tệp.
    // Giao dịch lưu thành công sẽ gỡ bản ghi dự phòng này.
    await this.db.insert(fileObjectDeletions).values({
      storageKey,
      availableAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
  }

  async create(data: CreateFileData, source?: TikzFileSource): Promise<FileRecord> {
    return this.db.transaction(async (tx) =>
      this.insertFile(tx, { ...data, parentFileId: null }, source),
    );
  }

  async createVariant(data: CreateFileVariantData): Promise<FileRecord> {
    return this.db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(files)
        .where(
          and(eq(files.id, data.parentFileId), eq(files.createdByUserId, data.createdByUserId)),
        )
        .limit(1)
        .for('update');
      if (!parent || parent.parentFileId)
        throw new ClientError('not_found', 'file_not_found', 'Tệp gốc không tồn tại');
      return this.insertFile(tx, data);
    });
  }

  private async insertFile(
    tx: Transaction,
    data: CreateFileData,
    source?: TikzFileSource,
  ): Promise<FileRecord> {
    await tx
      .insert(fileBlobs)
      .values({
        contentHash: data.contentHash,
        storageKey: data.storageKey,
        byteSize: data.byteSize,
      })
      .onConflictDoNothing();

    const [blob] = await tx
      .select()
      .from(fileBlobs)
      .where(eq(fileBlobs.contentHash, data.contentHash))
      .limit(1);
    if (!blob) throw new Error('Không thể xác định object của file');
    if (blob.storageKey === data.storageKey) {
      // Khi khóa đối tượng vừa tải lên trở thành đối tượng dữ liệu dùng chung,
      // gỡ bản ghi xóa dự phòng trong cùng giao dịch tạo tệp để tác vụ thu gom
      // không xóa đối tượng đã được tham chiếu hợp lệ.
      await tx
        .delete(fileObjectDeletions)
        .where(eq(fileObjectDeletions.storageKey, data.storageKey));
    } else {
      // Nếu mã băm đã có đối tượng dữ liệu, giữ khóa lưu trữ hiện tại;
      // khóa mới là bản tải lên thừa, được đưa vào hàng đợi xóa (outbox)
      // mà không tác động đến đối tượng đang được nhiều tệp sử dụng.
      await tx
        .insert(fileObjectDeletions)
        .values({ storageKey: data.storageKey })
        .onConflictDoUpdate({
          target: fileObjectDeletions.storageKey,
          set: { availableAt: new Date() },
        });
    }

    const [file] = await tx
      .insert(files)
      .values({
        createdByUserId: data.createdByUserId,
        contentHash: data.contentHash,
        mimeType: data.mimeType,
        width: data.width,
        height: data.height,
        originalFilename: data.originalFilename,
        parentFileId: data.parentFileId,
      })
      .returning();
    if (source) await tx.insert(fileSources).values({ ...source, fileId: file.id });

    // Vùng nháp là vị trí sử dụng tệp có thời hạn; sau khi lưu nội dung,
    // tham chiếu từ đối tượng nội dung cụ thể sẽ thay thế vị trí nháp.
    await tx
      .insert(authzContexts)
      .values({ kind: 'user', resourceKey: data.createdByUserId })
      .onConflictDoNothing();
    const [context] = await tx
      .select({ id: authzContexts.id })
      .from(authzContexts)
      .where(
        and(eq(authzContexts.kind, 'user'), eq(authzContexts.resourceKey, data.createdByUserId)),
      )
      .limit(1);
    if (!context) throw new Error('Không thể xác định user context');
    await tx.insert(fileUses).values({
      fileId: file.id,
      contextId: context.id,
      component: 'user',
      fileArea: 'draft',
      itemId: file.id,
    });
    return toFileRecord(file, blob);
  }

  private async findFile(where: ReturnType<typeof eq>): Promise<FileRecord | undefined> {
    const [row] = await this.db
      .select({ file: files, blob: fileBlobs })
      .from(files)
      .innerJoin(fileBlobs, eq(fileBlobs.contentHash, files.contentHash))
      .where(where)
      .limit(1);
    return row ? toFileRecord(row.file, row.blob) : undefined;
  }

  find(id: string) {
    return this.findFile(eq(files.id, id));
  }

  findOwned(id: string, userId: string) {
    return this.findFile(and(eq(files.id, id), eq(files.createdByUserId, userId))!);
  }

  findVariant(fileId: string, variantFileId: string) {
    return this.findFile(and(eq(files.id, variantFileId), eq(files.parentFileId, fileId))!);
  }

  findVariantOwned(fileId: string, variantFileId: string, userId: string) {
    return this.findFile(
      and(
        eq(files.id, variantFileId),
        eq(files.parentFileId, fileId),
        eq(files.createdByUserId, userId),
      )!,
    );
  }

  async findSourceOwned(id: string, userId: string): Promise<TikzFileSource | undefined> {
    const [source] = await this.db
      .select({ kind: fileSources.kind, source: fileSources.source })
      .from(fileSources)
      .innerJoin(files, eq(files.id, fileSources.fileId))
      .where(and(eq(fileSources.fileId, id), eq(files.createdByUserId, userId)))
      .limit(1);
    return source as TikzFileSource | undefined;
  }

  /** Chỉ cho học sinh đọc tệp khi tệp xuất hiện trong nội dung câu hỏi của đề đã giao. */
  async assignedFileClasses(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<string[]> {
    const targetId = variantFileId ?? fileId;
    const rows = await this.db
      .select({ classId: assignments.classId, snapshot: examRevisionQuestions.questionSnapshot })
      .from(fileUses)
      .innerJoin(questionVersions, sql`${fileUses.itemId} = ${questionVersions.questionId}::text`)
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
          eq(fileUses.fileId, targetId),
          eq(fileUses.component, 'questions'),
          eq(fileUses.fileArea, 'content'),
          eq(assignments.status, 'published'),
          lte(assignments.openAt, now),
          eq(classes.status, 'active'),
        ),
      );
    const stimulusRows = await this.db
      .select({
        classId: assignments.classId,
        snapshot: examRevisionQuestions.questionSnapshot,
        stimulusId: stimuli.id,
        stimulusContent: stimuli.content,
      })
      .from(fileUses)
      .innerJoin(stimuli, sql`${fileUses.itemId} = ${stimuli.id}::text`)
      .innerJoin(question, eq(question.stimulusId, stimuli.id))
      .innerJoin(questionVersions, eq(questionVersions.questionId, question.id))
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
          eq(fileUses.fileId, targetId),
          eq(fileUses.component, 'stimuli'),
          eq(fileUses.fileArea, 'content'),
          eq(assignments.status, 'published'),
          lte(assignments.openAt, now),
          eq(classes.status, 'active'),
        ),
      );
    // Bảng file_uses chỉ giúp tìm ứng viên: phải so khớp tham chiếu tệp (FileRef)
    // với bản chụp (snapshot) đã chốt. Nếu chỉ nối theo mã đối tượng,
    // có thể lộ ảnh trong hướng dẫn, ảnh gốc hoặc ảnh của phiên bản câu hỏi khác.
    return [
      ...new Set([
        ...rows
          .filter(({ snapshot }) =>
            collectFileRefs(questionSchema.parse(snapshot).content).some(
              (ref) => ref.fileId === fileId && ref.variantFileId === variantFileId,
            ),
          )
          .map(({ classId }) => classId),
        ...stimulusRows
          .filter(({ snapshot, stimulusId, stimulusContent }) => {
            const assignedQuestion = questionSchema.parse(snapshot);
            if (assignedQuestion.stimulusId !== stimulusId) return false;
            const stimulus = stimulusSchema.parse({ id: stimulusId, content: stimulusContent });
            return collectFileRefs(stimulus.content).some(
              (ref) => ref.fileId === fileId && ref.variantFileId === variantFileId,
            );
          })
          .map(({ classId }) => classId),
      ]),
    ];
  }

  /**
   * Quyền xem lời giải độc lập với quyền xem đề hiện tại: học sinh có lượt làm
   * đã nộp hoặc đã chấm vẫn xem được lời giải khi đến thời điểm công bố,
   * kể cả sau khi rời lớp. Tệp phải thực sự có trong lời giải của bản chụp đề đã giao;
   * chỉ trùng mã câu hỏi hoặc vị trí lưu tệp không đủ để được cấp quyền.
   * Không cấp quyền xem ảnh hướng dẫn hoặc ảnh gốc của bản cắt.
   */
  async hasReleasedSolutionFileAccess(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    // Tra bảng vị trí tệp trước để giảm số bản chụp cần kiểm tra;
    // sau đó đối chiếu tham chiếu tệp thực tế vì nối theo mã câu hỏi
    // có thể khớp nhiều phiên bản khác nhau.
    const rows = await this.db
      .select({ snapshot: examRevisionQuestions.questionSnapshot })
      .from(fileUses)
      .innerJoin(questionVersions, sql`${fileUses.itemId} = ${questionVersions.questionId}::text`)
      .innerJoin(
        examRevisionQuestions,
        eq(examRevisionQuestions.questionVersionId, questionVersions.id),
      )
      .innerJoin(assignments, eq(assignments.examRevisionId, examRevisionQuestions.examRevisionId))
      .innerJoin(
        attempts,
        and(
          eq(attempts.assignmentId, assignments.id),
          eq(attempts.userId, userId),
          inArray(attempts.status, ['submitted', 'graded']),
        ),
      )
      .innerJoin(users, and(eq(users.id, userId), eq(users.banned, false)))
      .innerJoin(
        classEnrolments,
        and(
          eq(classEnrolments.classId, assignments.classId),
          eq(classEnrolments.userId, userId),
          inArray(classEnrolments.status, ['active', 'left']),
        ),
      )
      .innerJoin(classes, eq(classes.id, assignments.classId))
      .where(
        and(
          eq(fileUses.fileId, variantFileId ?? fileId),
          eq(fileUses.component, 'questions'),
          eq(fileUses.fileArea, 'solution'),
          lte(assignments.releaseSolutionsAt, now),
          inArray(users.role, ['user', 'teacher', 'admin']),
        ),
      );
    return rows.some(({ snapshot }) =>
      collectFileRefs(questionSchema.parse(snapshot).solution).some(
        (ref) => ref.fileId === fileId && ref.variantFileId === variantFileId,
      ),
    );
  }

  async discardOrphans(refs: FileRef[], userId: string): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const keys: string[] = [];
      // Mọi giao dịch gắn tệp, gỡ tệp hoặc thu gom đều khóa theo cùng thứ tự:
      // toàn bộ ảnh gốc trước, sau đó đến ảnh biến thể, mỗi nhóm theo thứ tự UUID.
      const fileIds = [
        ...new Set(
          refs.flatMap(({ fileId, variantFileId }) =>
            variantFileId ? [fileId, variantFileId] : [fileId],
          ),
        ),
      ];
      if (fileIds.length === 0) return keys;
      await tx
        .select({ id: files.id })
        .from(files)
        .where(and(inArray(files.id, fileIds), eq(files.createdByUserId, userId)))
        .orderBy(sql`case when ${files.parentFileId} is null then 0 else 1 end`, asc(files.id))
        .for('update');
      const orderedRefs = [...refs].sort(
        (left, right) =>
          left.fileId.localeCompare(right.fileId) ||
          (left.variantFileId ?? '').localeCompare(right.variantFileId ?? ''),
      );
      for (const ref of orderedRefs) {
        const [file] = await tx
          .select()
          .from(files)
          .where(and(eq(files.id, ref.fileId), eq(files.createdByUserId, userId)))
          .limit(1)
          .for('update');
        if (!file) continue;
        const targetId = ref.variantFileId ?? file.id;
        const [target] = ref.variantFileId
          ? await tx
              .select()
              .from(files)
              .where(and(eq(files.id, ref.variantFileId), eq(files.parentFileId, file.id)))
              .limit(1)
              .for('update')
          : [file];
        if (!target || !target.orphanedAt) continue;
        // Gỡ vị trí nháp của ảnh gốc và các ảnh cắt liên quan khi người dùng loại ảnh gốc.
        const childIds = ref.variantFileId
          ? []
          : (
              await tx
                .select({ id: files.id })
                .from(files)
                .where(eq(files.parentFileId, file.id))
                .orderBy(asc(files.id))
            ).map(({ id }) => id);
        await tx
          .delete(fileUses)
          .where(
            and(
              inArray(fileUses.fileId, [targetId, ...childIds]),
              eq(fileUses.component, 'user'),
              eq(fileUses.fileArea, 'draft'),
            ),
          );
        keys.push(...(await this.queueFileDeletion(tx, targetId)));
      }
      return keys;
    });
  }

  async queueExpiredOrphans(cutoff: Date): Promise<{ processed: number; storageKeys: string[] }> {
    return this.db.transaction(async (tx) => {
      // Khóa bản ghi tệp trước khi xóa vị trí nháp, giống thứ tự khi gắn tệp.
      // Làm ngược thứ tự có thể gây kẹt khóa (deadlock) giữa thu gom và gắn tệp.
      // Cơ chế bỏ qua bản ghi đang bị khóa (skipLocked) giúp nhiều tác vụ thu gom
      // chạy song song; thao tác gắn tệp dùng FOR UPDATE để đồng bộ.
      const expired = await tx
        .select()
        .from(files)
        .where(
          and(
            lte(files.orphanedAt, cutoff),
            // Xử lý ảnh con trước để ảnh gốc có bản cắt còn dùng không chiếm hết hạn mức
            // 100 bản ghi mỗi lượt thu gom.
            sql`not exists (select 1 from ${files} as child where child.parent_file_id = ${files.id})`,
            // Chỉ xóa tệp có vị trí nháp đã hết hạn; vị trí sử dụng khác luôn giữ tệp.
            sql`not exists (
              select 1 from ${fileUses} as active_use
              where active_use.file_id = ${files.id}
                and not (
                  active_use.component = 'user'
                  and active_use.file_area = 'draft'
                  and active_use.created_at <= ${cutoff}
                )
            )`,
          ),
        )
        .orderBy(sql`case when ${files.parentFileId} is null then 0 else 1 end`, asc(files.id))
        .limit(100)
        .for('update', { skipLocked: true });
      if (expired.length === 0) return { processed: 0, storageKeys: [] };
      const storageKeys: string[] = [];
      for (const file of expired) {
        // Chỉ thu gom vị trí nháp đã quá hạn nếu tệp vẫn chưa được nội dung nào tham chiếu.
        await tx
          .delete(fileUses)
          .where(
            and(
              eq(fileUses.fileId, file.id),
              eq(fileUses.component, 'user'),
              eq(fileUses.fileArea, 'draft'),
              lte(fileUses.createdAt, cutoff),
            ),
          );
        storageKeys.push(...(await this.queueFileDeletion(tx, file.id)));
      }
      // Do dùng chung đối tượng theo mã băm SHA-256, có thể xóa nhiều bản ghi tệp
      // mà chưa cần xóa đối tượng vật lý nào; đếm số bản ghi thực sự bị xóa
      // để tác vụ thu gom không kết thúc sớm.
      const remaining = await tx
        .select({ id: files.id })
        .from(files)
        .where(
          inArray(
            files.id,
            expired.map(({ id }) => id),
          ),
        );
      return { processed: expired.length - remaining.length, storageKeys };
    });
  }

  async listPendingDeletions(afterStorageKey?: string): Promise<string[]> {
    // Thời điểm available_at phân biệt đối tượng đã đủ điều kiện xóa với ý định tải lên
    // còn hạn bảo vệ; không thu gom đối tượng khi yêu cầu tải lên có thể vẫn đang xử lý.
    const pending = await this.db
      .select({ storageKey: fileObjectDeletions.storageKey })
      .from(fileObjectDeletions)
      .where(
        and(
          lte(fileObjectDeletions.availableAt, new Date()),
          afterStorageKey ? gt(fileObjectDeletions.storageKey, afterStorageKey) : undefined,
        ),
      )
      .orderBy(asc(fileObjectDeletions.storageKey))
      .limit(100);
    return pending.map(({ storageKey }) => storageKey);
  }

  async acknowledgeDeletion(storageKey: string): Promise<void> {
    await this.db.delete(fileObjectDeletions).where(eq(fileObjectDeletions.storageKey, storageKey));
  }

  private async queueFileDeletion(tx: Transaction, id: string): Promise<string[]> {
    const [file] = await tx.select().from(files).where(eq(files.id, id)).limit(1).for('update');
    if (!file) return [];
    const [use] = await tx
      .select({ fileId: fileUses.fileId })
      .from(fileUses)
      .where(eq(fileUses.fileId, id))
      .limit(1);
    if (use) return [];

    const keys: string[] = [];
    const children = await tx
      .select({ id: files.id })
      .from(files)
      .where(eq(files.parentFileId, id))
      .orderBy(asc(files.id))
      .for('update');
    // Ảnh cắt còn được sử dụng phải giữ cả ảnh gốc; không xóa ảnh gốc khi
    // tham chiếu tệp (FileRef) của biến thể vẫn cần ảnh đó.
    for (const child of children) {
      const [childUse] = await tx
        .select({ fileId: fileUses.fileId })
        .from(fileUses)
        .where(eq(fileUses.fileId, child.id))
        .limit(1);
      if (childUse) return [];
    }
    for (const child of children) {
      keys.push(...(await this.queueFileDeletion(tx, child.id)));
    }

    await tx.delete(files).where(eq(files.id, id));
    // Chỉ xóa đối tượng nhị phân sau khi không còn bản ghi tệp nào khác dùng chung mã băm.
    const [blob] = await tx
      .select()
      .from(fileBlobs)
      .where(eq(fileBlobs.contentHash, file.contentHash))
      .limit(1)
      .for('update');
    if (!blob) return keys;
    const [remaining] = await tx
      .select({ id: files.id })
      .from(files)
      .where(eq(files.contentHash, file.contentHash))
      .limit(1);
    if (remaining) return keys;
    await tx
      .insert(fileObjectDeletions)
      .values({ storageKey: blob.storageKey })
      .onConflictDoNothing();
    await tx.delete(fileBlobs).where(eq(fileBlobs.contentHash, file.contentHash));
    return [...keys, blob.storageKey];
  }
}
