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

/**
 * Ghép thông tin tệp và đối tượng dữ liệu nhị phân dùng chung thành bản ghi mà tầng nghiệp vụ sử dụng.
 * Khóa lưu trữ và dung lượng lấy từ bảng dữ liệu nhị phân, không nhân bản các giá trị đó trên từng bản ghi tệp.
 */
function toFileRecord(file: FileRow, blob: typeof fileBlobs.$inferSelect): FileRecord {
  return { ...file, storageKey: blob.storageKey, byteSize: blob.byteSize };
}

/**
 * Lớp truy cập PostgreSQL cho tệp, đối tượng dữ liệu dùng chung và các vị trí sử dụng.
 * Kiểm tra quyền đọc theo nội dung thực tế và phối hợp hàng đợi xóa để không xóa nhầm đối tượng đang được tham chiếu.
 */
export class PostgresFilesRepository implements FilesRepository {
  constructor(private readonly db: Database) {}

  /**
   * Đăng ký một khóa đối tượng vừa bắt đầu tải lên để có thể dọn nếu việc ghi thông tin tệp thất bại.
   * Đặt thời điểm được phép thu gom sau 48 giờ để không xóa đối tượng khi yêu cầu tải lên và giao dịch lưu vẫn đang xử lý.
   */
  async reserveUpload(storageKey: string): Promise<void> {
    // Đây là ý định tải lên (upload intent), chưa phải lệnh xóa ngay: trì hoãn 48 giờ
    // để tác vụ thu gom không tranh chấp với yêu cầu đang tải tệp hoặc ghi thông tin tệp.
    // Giao dịch lưu thành công sẽ gỡ bản ghi dự phòng này.
    await this.db.insert(fileObjectDeletions).values({
      storageKey,
      availableAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
  }

  /**
   * Tạo bản ghi tệp gốc, bảo đảm không có tệp cha, trong một giao dịch.
   * Có thể ghi mã nguồn TikZ nếu tệp được tạo từ hình vẽ; dùng chung nội dung nhị phân theo mã băm SHA-256.
   */
  async create(data: CreateFileData, source?: TikzFileSource): Promise<FileRecord> {
    return this.db.transaction(async (tx) =>
      this.insertFile(tx, { ...data, parentFileId: null }, source),
    );
  }

  /**
   * Tạo ảnh biến thể có quan hệ cha-con với đúng tệp gốc của người dùng.
   * Khóa ảnh gốc, xác minh quyền sở hữu và từ chối lấy một ảnh biến thể làm cha để tránh cấu trúc lồng nhau không được hỗ trợ.
   */
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

  /**
   * Thêm bản ghi tệp và xử lý dùng chung đối tượng nhị phân trong cùng giao dịch.
   * Nếu mã băm đã tồn tại, giữ đối tượng cũ và đưa đối tượng tải lên thừa vào hàng đợi xóa; nếu chưa có thì hủy lệnh xóa dự phòng của đối tượng mới.
   * Khóa chia sẻ bản ghi dữ liệu nhị phân tới khi gắn tệp mới, tránh tranh chấp với giao dịch thu gom.
   * Khởi tạo vị trí tệp nháp thuộc người tải để có thể gắn vào nội dung hoặc thu gom khi quá hạn.
   */
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
      .limit(1)
      .for('share');
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
    const [root] = await tx
      .select({ id: authzContexts.id })
      .from(authzContexts)
      .where(and(eq(authzContexts.kind, 'system'), eq(authzContexts.resourceKey, 'giaokhoa')))
      .limit(1);
    if (!root) throw new Error('Thiếu ngữ cảnh hệ thống');
    await tx
      .insert(authzContexts)
      .values({ kind: 'user', resourceKey: data.createdByUserId, parentId: root.id })
      .onConflictDoUpdate({
        target: [authzContexts.kind, authzContexts.resourceKey],
        set: { parentId: root.id },
      });
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

  /**
   * Tra tệp và đối tượng nhị phân theo điều kiện truy vấn đã được bên gọi thiết lập.
   * Ghép khóa lưu trữ và dung lượng từ bảng dùng chung; không áp đặt quyền sở hữu vì các phương thức bên ngoài chọn điều kiện thích hợp.
   */
  private async findFile(where: ReturnType<typeof eq>): Promise<FileRecord | undefined> {
    const [row] = await this.db
      .select({ file: files, blob: fileBlobs })
      .from(files)
      .innerJoin(fileBlobs, eq(fileBlobs.contentHash, files.contentHash))
      .where(where)
      .limit(1);
    return row ? toFileRecord(row.file, row.blob) : undefined;
  }

  /**
   * Đọc thông tin tệp bằng mã định danh, không tự xác minh chủ sở hữu.
   * Chỉ sử dụng ở đường gọi đã có kiểm tra quyền phù hợp, tránh công khai khóa lưu trữ cho người không được phép.
   */
  find(id: string) {
    return this.findFile(eq(files.id, id));
  }

  /**
   * Chỉ đọc tệp khi vừa khớp mã tệp vừa khớp người tạo.
   * Giữ điều kiện quyền sở hữu trong truy vấn để không trả dữ liệu của người dùng khác.
   */
  findOwned(id: string, userId: string) {
    return this.findFile(and(eq(files.id, id), eq(files.createdByUserId, userId))!);
  }

  /**
   * Tìm ảnh biến thể khi biết cả mã ảnh gốc và mã ảnh con.
   * Xác minh quan hệ cha-con ở cơ sở dữ liệu, không chấp nhận một ảnh con không thuộc ảnh gốc đã chỉ định.
   */
  findVariant(fileId: string, variantFileId: string) {
    return this.findFile(and(eq(files.id, variantFileId), eq(files.parentFileId, fileId))!);
  }

  /**
   * Tìm ảnh biến thể thuộc một ảnh gốc và đúng người tạo.
   * Kết hợp mã ảnh con, mã ảnh cha và chủ sở hữu trong một truy vấn để hạn chế đọc nhầm ảnh của người khác.
   */
  findVariantOwned(fileId: string, variantFileId: string, userId: string) {
    return this.findFile(
      and(
        eq(files.id, variantFileId),
        eq(files.parentFileId, fileId),
        eq(files.createdByUserId, userId),
      )!,
    );
  }

  /**
   * Đọc mã nguồn TikZ của tệp khi người yêu cầu chính là người tạo.
   * Mã nguồn được tách riêng khỏi ảnh đã dựng và không trả cho người chỉ có quyền xem ảnh.
   */
  async findSourceOwned(id: string, userId: string): Promise<TikzFileSource | undefined> {
    const [source] = await this.db
      .select({ kind: fileSources.kind, source: fileSources.source })
      .from(fileSources)
      .innerJoin(files, eq(files.id, fileSources.fileId))
      .where(and(eq(fileSources.fileId, id), eq(files.createdByUserId, userId)))
      .limit(1);
    return source as TikzFileSource | undefined;
  }

  /** Chỉ xét quyền đọc tệp khi học sinh đang là người nhận bài và thành viên lớp còn hoạt động.
   * Đối chiếu ảnh gốc và ảnh biến thể với bản chụp câu hỏi hoặc ngữ liệu đã giao;
   * vị trí tệp trong cơ sở dữ liệu không đủ để chứng minh quyền xem. */
  async assignedFileAssignments(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<string[]> {
    const targetId = variantFileId ?? fileId;
    const rows = await this.db
      .select({ assignmentId: assignments.id, snapshot: examRevisionQuestions.questionSnapshot })
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
        assignmentId: assignments.id,
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
          .map(({ assignmentId }) => assignmentId),
        ...stimulusRows
          .filter(({ snapshot, stimulusId, stimulusContent }) => {
            const assignedQuestion = questionSchema.parse(snapshot);
            if (assignedQuestion.stimulusId !== stimulusId) return false;
            const stimulus = stimulusSchema.parse({ id: stimulusId, content: stimulusContent });
            return collectFileRefs(stimulus.content).some(
              (ref) => ref.fileId === fileId && ref.variantFileId === variantFileId,
            );
          })
          .map(({ assignmentId }) => assignmentId),
      ]),
    ];
  }

  /**
   * Tìm lớp có lời giải đã công bố thực sự tham chiếu tệp để tầng ứng dụng xét quyền.
   * Với lượt làm đã nộp hoặc đã chấm, tiếp tục cho đọc lịch sử sau khi rời lớp;
   * kể cả sau khi rời lớp. Tệp phải thực sự có trong lời giải của bản chụp đề đã giao;
   * chỉ trùng mã câu hỏi hoặc vị trí lưu tệp không đủ để được cấp quyền.
   * Không cấp quyền xem ảnh hướng dẫn hoặc ảnh gốc của bản cắt.
   */
  async releasedSolutionFileAssignments(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<Array<{ assignmentId: string; enrolmentStatus: 'active' | 'left' }>> {
    // Trả về lớp và trạng thái tham gia để tầng nghiệp vụ xét quyền theo vai trò
    // hiện hành; riêng thành viên đã rời lớp có thể tiếp tục xem lịch sử đã nộp.
    // Tra bảng vị trí tệp trước để giảm số bản chụp cần kiểm tra;
    // sau đó đối chiếu tham chiếu tệp thực tế vì nối theo mã câu hỏi
    // có thể khớp nhiều phiên bản khác nhau.
    const rows = await this.db
      .select({
        snapshot: examRevisionQuestions.questionSnapshot,
        assignmentId: assignments.id,
        enrolmentStatus: classEnrolments.status,
      })
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
      .innerJoin(users, eq(users.id, userId))
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
          sql`${users.banned} is not true`,
        ),
      );
    return rows
      .filter(({ snapshot }) =>
        collectFileRefs(questionSchema.parse(snapshot).solution).some(
          (ref) => ref.fileId === fileId && ref.variantFileId === variantFileId,
        ),
      )
      .map(({ assignmentId, enrolmentStatus }) => ({
        assignmentId,
        enrolmentStatus: enrolmentStatus === 'left' ? ('left' as const) : ('active' as const),
      }));
  }

  /**
   * Gỡ vị trí nháp và thu gom có kiểm tra đối với các tệp người dùng muốn loại bỏ.
   * Chỉ xử lý tệp của đúng người tạo chưa được gắn vào nội dung; khóa ảnh gốc và ảnh biến thể theo thứ tự cố định để tránh xung đột.
   * Trả danh sách khóa đối tượng cần xóa khỏi kho S3 sau khi giao dịch hoàn tất.
   */
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

  /**
   * Thu gom các tệp chưa được sử dụng đã quá thời điểm giới hạn.
   * Mỗi lượt xử lý tối đa 100 bản ghi, bỏ qua tệp đang bị giao dịch khác khóa; chỉ xóa khi không còn tham chiếu đang sử dụng và không còn ảnh con.
   * Trả số bản ghi tệp đã xử lý và danh sách khóa đối tượng có thể xóa ở kho lưu trữ.
   */
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

  /**
   * Liệt kê tối đa 100 khóa đối tượng đã đến thời điểm cho phép xóa.
   * Sắp theo khóa lưu trữ và hỗ trợ lấy trang sau để tác vụ thu gom tiếp tục từ khóa trước mà không lặp lại.
   */
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

  /**
   * Xác nhận một đối tượng đã được xử lý xóa bằng cách gỡ yêu cầu trong hàng đợi.
   * Chỉ xóa bản ghi chờ xử lý, không trực tiếp thao tác với kho S3 ở tầng cơ sở dữ liệu.
   */
  async acknowledgeDeletion(storageKey: string): Promise<void> {
    await this.db.delete(fileObjectDeletions).where(eq(fileObjectDeletions.storageKey, storageKey));
  }

  /**
   * Kiểm tra khả năng xóa bản ghi tệp và các ảnh con trong một giao dịch.
   * Không xóa nếu tệp hoặc ảnh con còn vị trí sử dụng; chỉ xóa đối tượng nhị phân khi không còn bản ghi tệp nào trỏ đến cùng mã băm.
   * Đưa khóa đối tượng vào hàng đợi xóa để tác vụ riêng xóa khỏi kho lưu trữ sau khi dữ liệu đã được ghi nhận.
   */
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
