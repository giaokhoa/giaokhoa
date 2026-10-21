import { ClientError } from '@giaokhoa/application/common/client-error';
import type { AssignmentsRepository } from '@giaokhoa/application/assignments/repository';
import {
  assignmentCreateSchema,
  assignmentRecipientSchema,
  assignmentSchema,
  studentAssignmentSchema,
  type AssignmentPatch,
  type StudentAssignment,
} from '@giaokhoa/shared/assignments';
import { questionSchema, stimulusSchema } from '@giaokhoa/shared/questions';
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { users } from '../schema/auth.generated.js';
import { assignments, assignmentRecipients } from '../schema/assignments.js';
import { authzRoleAssignments, authzRoles } from '../schema/authorization.js';
import { classes, classEnrolments } from '../schema/classes.js';
import { exams, examRevisions, examRevisionQuestions } from '../schema/exams.js';
import { stimuli } from '../schema/questions.js';
import type { Database } from '../types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Tạo lỗi từ chối quyền quản lý bài giao (assignment).
 * Dùng thống nhất cho các thao tác yêu cầu chủ lớp có vai trò quản lý hợp lệ.
 */
function forbidden() {
  return new ClientError(
    'forbidden',
    'authorization_denied',
    'Bạn không có quyền quản lý bài giao',
  );
}

/**
 * Tạo lỗi khi danh sách học sinh được chọn không khớp với các thành viên đang hoạt động.
 * Không công bố bài giao thiếu người hoặc chứa người ngoài lớp mà người tạo không nhận ra.
 */
function invalidRecipients() {
  return new ClientError(
    'invalid',
    'assignment_recipients_invalid',
    'Danh sách học sinh phải thuộc lớp và đang active',
  );
}

/**
 * Kiểm tra quyền quản lý lớp bên trong một giao dịch (transaction).
 * Yêu cầu lớp đang hoạt động, đúng người tạo, tài khoản giáo viên hoặc quản trị viên chưa bị cấm, và vai trò chủ lớp chưa bị thu hồi.
 * @param tx Giao dịch đang dùng để đọc quyền nhất quán với thao tác ghi.
 * @param classroom Bản ghi lớp đã được bên gọi tra cứu và khóa trước khi kiểm tra.
 * @param actorId Mã tài khoản đang thực hiện thao tác.
 * @throws Lỗi từ chối quyền khi thiếu bất kỳ điều kiện sở hữu nào.
 */
export async function assertOwner(
  tx: Transaction,
  classroom: typeof classes.$inferSelect | undefined,
  actorId: string,
) {
  if (
    !classroom ||
    classroom.status !== 'active' ||
    classroom.createdByUserId !== actorId ||
    !classroom.authzContextId
  )
    throw forbidden();
  const [account] = await tx
    .select({ role: users.role, banned: users.banned })
    .from(users)
    .where(eq(users.id, actorId))
    .for('share')
    .limit(1);
  if (!account || account.banned || (account.role !== 'teacher' && account.role !== 'admin'))
    throw forbidden();
  const [owner] = await tx
    .select({ id: authzRoleAssignments.id })
    .from(authzRoleAssignments)
    .innerJoin(authzRoles, eq(authzRoleAssignments.roleId, authzRoles.id))
    .where(
      and(
        eq(authzRoleAssignments.contextId, classroom.authzContextId),
        eq(authzRoleAssignments.userId, actorId),
        eq(authzRoles.key, 'class:owner'),
        isNull(authzRoleAssignments.revokedAt),
      ),
    )
    .for('share')
    .limit(1);
  if (!owner) throw forbidden();
}

/**
 * Chuyển cấu hình bài giao đã được xác thực thành dữ liệu phù hợp để ghi PostgreSQL.
 * Đổi chuỗi thời gian thành Date và dùng null cho lịch công bố chưa được cấu hình, tránh lưu trạng thái thiếu nhất quán.
 */
function config(input: ReturnType<typeof assignmentCreateSchema.parse>) {
  return {
    audienceMode: input.audienceMode,
    selectedUserIds: input.selectedUserIds,
    openAt: new Date(input.openAt),
    closeAt: new Date(input.closeAt),
    maxAttempts: input.maxAttempts,
    releaseScoreAt: input.releaseScoreAt ? new Date(input.releaseScoreAt) : null,
    releaseFeedbackAt: input.releaseFeedbackAt ? new Date(input.releaseFeedbackAt) : null,
    releaseSolutionsAt: input.releaseSolutionsAt ? new Date(input.releaseSolutionsAt) : null,
  };
}

/**
 * Lớp truy cập PostgreSQL cho bài giao và danh sách người nhận.
 * Đảm bảo công bố bài giao dựa trên thành viên lớp tại thời điểm chốt, tránh phát sinh người nhận ngoài ý muốn khi lớp thay đổi.
 */
export class PostgresAssignmentsRepository implements AssignmentsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Tạo bản nháp bài giao cho một lớp và một bản sửa đổi đề thi thuộc người tạo.
   * Khóa lớp, xác minh quyền sở hữu lớp rồi xác minh tác giả đề trong cùng giao dịch để không tạo bài giao trái quyền.
   * Trả về undefined khi không tìm thấy bản sửa đổi đề của tác giả; lỗi phân quyền được phát sinh riêng.
   */
  async create(actorId: string, input: Parameters<AssignmentsRepository['create']>[1]) {
    const parsed = assignmentCreateSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, parsed.classId))
        .for('update')
        .limit(1);
      await assertOwner(tx, classroom, actorId);
      const [revision] = await tx
        .select({ id: examRevisions.id })
        .from(examRevisions)
        .innerJoin(exams, eq(examRevisions.examId, exams.id))
        .where(and(eq(examRevisions.id, parsed.examRevisionId), eq(exams.createdByUserId, actorId)))
        .limit(1);
      if (!revision) return undefined;
      const [created] = await tx
        .insert(assignments)
        .values({
          classId: parsed.classId,
          examRevisionId: revision.id,
          createdByUserId: actorId,
          ...config(parsed),
        })
        .returning();
      return assignmentSchema.parse(created);
    });
  }

  /**
   * Đọc cấu hình bài giao theo mã và kiểm tra cấu trúc dữ liệu đầu ra.
   * Phương thức chỉ truy xuất dữ liệu, không tự kiểm tra quyền người xem; tầng gọi phải đặt hàng rào phân quyền.
   */
  async findById(id: string) {
    const [row] = await this.db.select().from(assignments).where(eq(assignments.id, id)).limit(1);
    return row ? assignmentSchema.parse(row) : undefined;
  }

  /**
   * Chỉ cập nhật cấu hình bài giao khi còn ở trạng thái bản nháp (draft) và người sửa là tác giả.
   * Khóa lớp trước bài giao, ghép dữ liệu hiện có với phần thay đổi rồi xác thực toàn bộ cấu hình để tránh phá vỡ tính hợp lệ khi cập nhật từng phần.
   * Trả về undefined khi bài giao không tồn tại, đã công bố hoặc không thuộc người yêu cầu.
   */
  async updateDraft(id: string, actorId: string, patch: AssignmentPatch) {
    const [existing] = await this.db
      .select({ classId: assignments.classId })
      .from(assignments)
      .where(eq(assignments.id, id))
      .limit(1);
    if (!existing) return undefined;
    return this.db.transaction(async (tx) => {
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, existing.classId))
        .for('update')
        .limit(1);
      await assertOwner(tx, classroom, actorId);
      const [row] = await tx
        .select()
        .from(assignments)
        .where(eq(assignments.id, id))
        .for('update')
        .limit(1);
      if (!row || row.status !== 'draft' || row.createdByUserId !== actorId) return undefined;
      const updatedInput = assignmentCreateSchema.safeParse({
        classId: row.classId,
        examRevisionId: row.examRevisionId,
        audienceMode: row.audienceMode,
        selectedUserIds: row.selectedUserIds,
        openAt: row.openAt.toISOString(),
        closeAt: row.closeAt.toISOString(),
        maxAttempts: row.maxAttempts,
        releaseScoreAt: row.releaseScoreAt?.toISOString() ?? null,
        releaseFeedbackAt: row.releaseFeedbackAt?.toISOString() ?? null,
        releaseSolutionsAt: row.releaseSolutionsAt?.toISOString() ?? null,
        ...patch,
      });
      if (!updatedInput.success)
        throw new ClientError(
          'invalid',
          'assignment_invalid',
          'Cấu hình bài giao không hợp lệ',
          updatedInput.error.issues,
        );
      const [updated] = await tx
        .update(assignments)
        .set(config(updatedInput.data))
        .where(eq(assignments.id, id))
        .returning();
      return assignmentSchema.parse(updated);
    });
  }

  /**
   * Khóa lớp trước bài giao (assignment) để đồng bộ với thao tác tham gia hoặc đình chỉ lớp.
   * Danh sách người nhận tại lúc công bố chỉ gồm thành viên đang hoạt động;
   * công bố lặp lại không được bổ sung người nhận lần nữa.
   */
  async publish(id: string, actorId: string) {
    const [existing] = await this.db
      .select({ classId: assignments.classId })
      .from(assignments)
      .where(eq(assignments.id, id))
      .limit(1);
    if (!existing) return undefined;
    return this.db.transaction(async (tx) => {
      // Khóa lớp trước bài giao; thao tác tham gia hoặc đình chỉ thành viên cũng khóa lớp trước.
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, existing.classId))
        .for('update')
        .limit(1);
      await assertOwner(tx, classroom, actorId);
      const [row] = await tx
        .select()
        .from(assignments)
        .where(eq(assignments.id, id))
        .for('update')
        .limit(1);
      if (!row || row.createdByUserId !== actorId || row.classId !== existing.classId)
        throw forbidden();
      if (row.status === 'published') return assignmentSchema.parse(row);

      const active = await tx
        .select({ userId: classEnrolments.userId })
        .from(classEnrolments)
        .where(
          and(
            eq(classEnrolments.classId, row.classId),
            eq(classEnrolments.status, 'active'),
            ...(row.audienceMode === 'SELECTED_USERS'
              ? [inArray(classEnrolments.userId, row.selectedUserIds)]
              : []),
          ),
        )
        .orderBy(asc(classEnrolments.userId));

      if (row.audienceMode === 'SELECTED_USERS' && active.length !== row.selectedUserIds.length)
        throw invalidRecipients();
      if (active.length)
        await tx
          .insert(assignmentRecipients)
          .values(
            active.map(({ userId }) => ({
              assignmentId: id,
              userId,
              source: row.audienceMode === 'ALL_CLASS' ? 'all_class' : 'selected_users',
            })),
          )
          .onConflictDoNothing();

      const [published] = await tx
        .update(assignments)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(assignments.id, id))
        .returning();
      return assignmentSchema.parse(published);
    });
  }

  /**
   * Liệt kê người nhận đã được chốt của một bài giao theo thứ tự mã người dùng.
   * Chỉ trả danh sách khi người yêu cầu chính là tác giả bài giao; kết quả giữ trạng thái đã thu hồi để phục vụ đối soát.
   */
  async listRecipients(id: string, actorId: string) {
    const [row] = await this.db
      .select({ createdByUserId: assignments.createdByUserId })
      .from(assignments)
      .where(eq(assignments.id, id))
      .limit(1);
    if (!row || row.createdByUserId !== actorId) return undefined;
    const recipients = await this.db
      .select({
        userId: assignmentRecipients.userId,
        status: assignmentRecipients.status,
        source: assignmentRecipients.source,
        assignedAt: assignmentRecipients.assignedAt,
        revokedAt: assignmentRecipients.revokedAt,
      })
      .from(assignmentRecipients)
      .where(eq(assignmentRecipients.assignmentId, id))
      .orderBy(asc(assignmentRecipients.userId));
    return recipients.map((value) => assignmentRecipientSchema.parse(value));
  }

  /**
   * Thu hồi quyền nhận một bài giao đã công bố mà không xóa lịch sử người nhận.
   * Khóa lớp, bài giao và bản ghi người nhận trong cùng giao dịch để tránh tranh chấp với thao tác tham gia hoặc bắt đầu làm bài.
   * Trả về false khi không tìm được người nhận hợp lệ; trả về true với bản ghi đã thu hồi mà không đổi thời điểm thu hồi cũ.
   */
  async revokeRecipient(id: string, userId: string, actorId: string) {
    const [existing] = await this.db
      .select({ classId: assignments.classId })
      .from(assignments)
      .where(eq(assignments.id, id))
      .limit(1);
    if (!existing) return false;
    return this.db.transaction(async (tx) => {
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, existing.classId))
        .for('update')
        .limit(1);
      await assertOwner(tx, classroom, actorId);
      const [row] = await tx
        .select()
        .from(assignments)
        .where(eq(assignments.id, id))
        .for('update')
        .limit(1);
      if (!row || row.status !== 'published' || row.createdByUserId !== actorId) return false;
      const [recipient] = await tx
        .select()
        .from(assignmentRecipients)
        .where(
          and(eq(assignmentRecipients.assignmentId, id), eq(assignmentRecipients.userId, userId)),
        )
        .for('update')
        .limit(1);
      if (!recipient) return false;
      if (recipient.status === 'active')
        await tx
          .update(assignmentRecipients)
          .set({ status: 'revoked', revokedAt: new Date() })
          .where(
            and(eq(assignmentRecipients.assignmentId, id), eq(assignmentRecipients.userId, userId)),
          );
      return true;
    });
  }

  /**
   * Tạo nội dung bài giao hiển thị cho học sinh từ bản chụp đề thi đã chốt.
   * Chỉ chọn người nhận còn hiệu lực, đang tham gia lớp hoạt động và bài đã công bố, đã đến giờ mở; không truy vấn đề đang chỉnh sửa.
   * Dữ liệu trả về chỉ có nội dung cần làm, không kèm hướng dẫn hoặc lời giải; ngữ liệu chỉ được gắn theo các câu hỏi đã qua kiểm tra quyền.
   */
  async getDelivery(
    id: string,
    actorId: string,
    now: Date,
  ): Promise<StudentAssignment | undefined> {
    const [match] = await this.db
      .select({ assignment: assignments, title: examRevisions.title })
      .from(assignments)
      .innerJoin(
        assignmentRecipients,
        and(
          eq(assignmentRecipients.assignmentId, assignments.id),
          eq(assignmentRecipients.userId, actorId),
          eq(assignmentRecipients.status, 'active'),
        ),
      )
      .innerJoin(
        classEnrolments,
        and(
          eq(classEnrolments.classId, assignments.classId),
          eq(classEnrolments.userId, actorId),
          eq(classEnrolments.status, 'active'),
        ),
      )
      .innerJoin(classes, and(eq(classes.id, assignments.classId), eq(classes.status, 'active')))
      .innerJoin(examRevisions, eq(examRevisions.id, assignments.examRevisionId))
      .where(
        and(
          eq(assignments.id, id),
          eq(assignments.status, 'published'),
          lte(assignments.openAt, now),
        ),
      )
      .limit(1);
    if (!match) return undefined;
    const snapshots = await this.db
      .select({
        position: examRevisionQuestions.position,
        questionSnapshot: examRevisionQuestions.questionSnapshot,
      })
      .from(examRevisionQuestions)
      .where(eq(examRevisionQuestions.examRevisionId, match.assignment.examRevisionId))
      .orderBy(asc(examRevisionQuestions.position));
    const entries = snapshots.map(({ position, questionSnapshot }) => {
      const { id, version, type, content, stimulusId } = questionSchema.parse(questionSnapshot);
      return { position, question: { id, version, type, content, stimulusId } };
    });
    const stimulusIds = [
      ...new Set(
        entries.flatMap(({ question }) => (question.stimulusId ? [question.stimulusId] : [])),
      ),
    ];
    const stimulusRows = stimulusIds.length
      ? await this.db
          .select({ id: stimuli.id, content: stimuli.content })
          .from(stimuli)
          .where(inArray(stimuli.id, stimulusIds))
      : [];
    const stimuliById = new Map(stimulusRows.map((row) => [row.id, stimulusSchema.parse(row)]));
    return studentAssignmentSchema.parse({
      assignmentId: match.assignment.id,
      examRevisionId: match.assignment.examRevisionId,
      title: match.title,
      openAt: match.assignment.openAt,
      closeAt: match.assignment.closeAt,
      maxAttempts: match.assignment.maxAttempts,
      // Chỉ thêm ngữ liệu vào dữ liệu trả cho học sinh sau khi đã kiểm tra quyền;
      // không cho phép đọc ngữ liệu tùy ý chỉ bằng mã định danh.
      questions: entries.map(({ position, question }) => ({
        position,
        question: {
          ...question,
          stimulus: question.stimulusId ? (stimuliById.get(question.stimulusId) ?? null) : null,
        },
      })),
    });
  }
}
