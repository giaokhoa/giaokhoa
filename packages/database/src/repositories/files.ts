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

export class PostgresFilesRepository implements FilesRepository {
  constructor(private readonly db: Database) {}

  async reserveUpload(storageKey: string): Promise<void> {
    // Đây là upload intent, chưa phải lệnh xóa ngay: trì hoãn 48 giờ để GC
    // không đua với request còn đang PUT/ghi metadata. Commit thành công gỡ intent.
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
      // Key vừa upload trở thành blob chuẩn: gỡ intent cùng transaction tạo file,
      // để GC không thể xóa một object đã được tham chiếu hợp lệ.
      await tx
        .delete(fileObjectDeletions)
        .where(eq(fileObjectDeletions.storageKey, data.storageKey));
    } else {
      // Hash đã có blob vật lý khác: giữ key chuẩn của blob cũ, còn key mới
      // chỉ là bản upload thừa. Cho phép outbox dọn bản thừa mà không đụng blob cũ.
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

    // Draft là placement có thời hạn; sau khi lưu nội dung, refs theo item bất biến sẽ thay thế.
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

  /** Truy cập học sinh chỉ khi file xuất hiện trong phần content của đề đã giao. */
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
    // file_uses chỉ là chỉ mục ứng viên: phải đối chiếu đúng FileRef trong
    // snapshot đã chốt; nếu chỉ join itemId sẽ lộ cả ảnh guidance/original
    // hoặc ảnh thuộc phiên bản khác của cùng câu hỏi.
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
   * Đường cấp quyền độc lập với quyền xem đề hiện tại: học sinh có attempt
   * đã nộp/chấm và đã đến hạn release vẫn đọc được solution khi rời lớp.
   * File phải thực sự nằm trong solution của snapshot đã giao, không chỉ có
   * placement cùng questionId; không cấp quyền cho guidance hoặc original crop.
   */
  async hasReleasedSolutionFileAccess(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    // Truy vấn từ file_uses để giảm số snapshot phải parse; lọc FileRef thật
    // ở cuối vì join theo questionId có thể khớp nhiều phiên bản câu hỏi.
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
      // Tất cả giao dịch attach/detach/GC khóa asset theo cùng thứ tự:
      // toàn bộ original trước, sau đó variant, trong mỗi nhóm theo UUID.
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
        // Bỏ draft của asset lẫn các crop con khi người dùng loại ảnh gốc.
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
      // Khóa file trước khi xóa draft: attach cũng khóa file rồi xóa draft.
      // Nếu làm ngược, GC và attach đồng thời có thể deadlock trên file_uses.
      // skipLocked cho phép nhiều worker GC chạy cùng lúc mà không cùng chọn
      // một file; attach dùng FOR UPDATE để đồng bộ trước khi đổi file_uses.
      const expired = await tx
        .select()
        .from(files)
        .where(
          and(
            lte(files.orphanedAt, cutoff),
            // Xóa leaf trước: parent có crop còn dùng không bao giờ chặn 100 slots của GC.
            sql`not exists (select 1 from ${files} as child where child.parent_file_id = ${files.id})`,
            // Chỉ draft đã hết hạn được xóa; placement khác luôn giữ file.
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
        // Draft tồn đọng chỉ hết hạn khi asset vẫn còn ở trạng thái orphan.
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
      // SHA dedup có thể xóa 100 bản ghi logical nhưng chưa có key vật lý nào
      // cần dọn. Đếm file thực sự bị xóa để worker không dừng giữa chừng.
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
    // available_at phân biệt object đã có thể xóa với upload intent còn hạn:
    // GC tuyệt đối không xử lý intent khi request upload có thể đang chạy.
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
    // Một crop còn được dùng phải giữ cả parent; không xóa parent rồi để
    // FileRef có variant trỏ vào một ảnh gốc đã biến mất.
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
    // Xóa blob chỉ sau khi không còn asset khác trỏ đến cùng content hash.
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
