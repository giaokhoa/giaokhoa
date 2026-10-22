import { ClientError } from '@giaokhoa/application/common/client-error';
import type { AssignmentsRepository } from '@giaokhoa/application/assignments/repository';
import {
  assignmentCreateSchema,
  assignmentPreviewSchema,
  assignmentRecipientSchema,
  assignmentSchema,
  studentAssignmentSchema,
  type AssignmentPatch,
  type AssignmentPreview,
  type StudentAssignment,
} from '@giaokhoa/shared/assignments';
import { questionSchema } from '@giaokhoa/shared/questions';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { users } from '../schema/auth.generated.js';
import { assignments, assignmentRecipients } from '../schema/assignments.js';
import { authzContexts } from '../schema/authorization.js';
import { hasContextCapability, isAccountSuspended } from './authorization.js';
import { classes, classEnrolments } from '../schema/classes.js';
import { exams, examRevisions, examRevisionQuestions } from '../schema/exams.js';
import { readPinnedStimulus } from './pinned-stimulus.js';
import type { Database } from '../types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Tạo lỗi từ chối quyền quản lý bài giao (assignment).
 * Dùng thống nhất cho các thao tác yêu cầu capability quản lý bài giao còn hiệu lực.
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
 * Kiểm tra capability quản lý bài giao ngay trong giao dịch, không khóa quyền vào người tạo lớp.
 * Yêu cầu lớp đang hoạt động và tài khoản chưa bị khóa.
 * @param tx Giao dịch đang dùng để đọc quyền nhất quán với thao tác ghi.
 * @param classroom Bản ghi lớp đã được bên gọi tra cứu và khóa trước khi kiểm tra.
 * @param actorId Mã tài khoản đang thực hiện thao tác.
 * @throws Lỗi từ chối khi tài khoản không còn capability tại lớp.
 */
export async function assertOwner(
  tx: Transaction,
  classroom: typeof classes.$inferSelect | undefined,
  actorId: string,
  capability:
    | 'assignment:create'
    | 'assignment:publish'
    | 'assignment:grade' = 'assignment:publish',
  assignmentId?: string,
) {
  if (!classroom || classroom.status !== 'active' || !classroom.authzContextId) throw forbidden();
  const [account] = await tx
    .select({ banned: users.banned, banExpires: users.banExpires })
    .from(users)
    .where(eq(users.id, actorId))
    .for('share')
    .limit(1);
  if (
    !account ||
    isAccountSuspended(account) ||
    !(await hasContextCapability(tx, actorId, capability, {
      kind: assignmentId ? 'assignment' : 'class',
      resourceKey: assignmentId ?? classroom.id,
    }))
  )
    throw forbidden();
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

  async listCandidates(actorId: string) {
    const recipient = sql<boolean>`exists (
      select 1 from assignment_recipients r join class_enrolments e on e.class_id = ${assignments.classId} and e.user_id = r.user_id
      where r.assignment_id = ${assignments.id} and r.user_id = ${actorId} and r.status = 'active'
      and e.status = 'active' and ${classes.status} = 'active' and ${assignments.status} = 'published'
    )`;
    const rows = await this.db
      .select({
        id: assignments.id,
        classId: assignments.classId,
        className: classes.name,
        title: examRevisions.title,
        status: assignments.status,
        openAt: assignments.openAt,
        closeAt: assignments.closeAt,
        maxAttempts: assignments.maxAttempts,
        isRecipient: recipient,
      })
      .from(assignments)
      .innerJoin(classes, eq(classes.id, assignments.classId))
      .innerJoin(examRevisions, eq(examRevisions.id, assignments.examRevisionId))
      .where(sql`${recipient} or exists (
        select 1 from authz_role_assignments a join authz_contexts c on c.id = a.context_id
        where a.user_id = ${actorId} and a.revoked_at is null
        and (c.kind = 'system' or c.id = ${classes.authzContextId} or (c.kind = 'assignment' and c.resource_key = ${assignments.id}::text))
      ) or exists (
        select 1 from authz_roles r where r.key = 'system:user' and (
          exists (select 1 from authz_role_permissions p join authz_capabilities cap on cap.id = p.capability_id
            where p.role_id = r.id and cap.key in ('assignment:create', 'assignment:publish', 'assignment:grade') and p.effect = 'ALLOW')
          or exists (select 1 from authz_role_overrides o join authz_contexts c on c.id = o.context_id
            where o.role_id = r.id and o.effect = 'ALLOW'
            and (c.id = ${classes.authzContextId} or (c.kind = 'assignment' and c.resource_key = ${assignments.id}::text)))
        )
      )`)
      .orderBy(assignments.openAt, assignments.id);
    return rows.map((row) => ({ ...row, status: row.status as 'draft' | 'published' }));
  }

  /**
   * Tạo bản nháp bài giao cho một lớp bằng bản sửa đổi đề thi mà tác giả sở hữu.
   * Khóa lớp, xét capability tạo bài rồi xác minh tác giả đề trong cùng giao dịch để không tạo bài giao trái quyền.
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
      await assertOwner(tx, classroom, actorId, 'assignment:create');
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
      // Bài giao là ngữ cảnh hoạt động con của lớp, để ghi đè quyền riêng cho từng bài.
      await tx.insert(authzContexts).values({
        kind: 'assignment',
        resourceKey: created.id,
        parentId: classroom!.authzContextId!,
      });
      return assignmentSchema.parse(created);
    });
  }

  /** Bản chụp phục vụ chấm bài, gồm lời giải và ngữ liệu đã chốt; không dùng đường giao đề của học sinh. */
  async getPreview(id: string, actorId: string): Promise<AssignmentPreview | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          classroom: classes,
          revisionId: assignments.examRevisionId,
          title: examRevisions.title,
        })
        .from(assignments)
        .innerJoin(classes, eq(classes.id, assignments.classId))
        .innerJoin(examRevisions, eq(examRevisions.id, assignments.examRevisionId))
        .where(eq(assignments.id, id))
        .limit(1);
      if (!row) return undefined;
      await assertOwner(tx, row.classroom, actorId, 'assignment:grade', id);
      const snapshots = await tx
        .select()
        .from(examRevisionQuestions)
        .where(eq(examRevisionQuestions.examRevisionId, row.revisionId))
        .orderBy(asc(examRevisionQuestions.position));
      return assignmentPreviewSchema.parse({
        title: row.title,
        questions: snapshots.map((snapshot) => {
          const question = questionSchema.parse(snapshot.questionSnapshot);
          return {
            position: snapshot.position,
            question,
            stimulus: question.stimulusId
              ? readPinnedStimulus(snapshot.stimulusSnapshot, question.stimulusId)
              : null,
          };
        }),
      });
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
   * Chỉ cập nhật cấu hình bài giao khi còn ở trạng thái bản nháp (draft) và người sửa có capability.
   * Khóa lớp trước bài giao, ghép dữ liệu hiện có với phần thay đổi rồi xác thực toàn bộ cấu hình để tránh phá vỡ tính hợp lệ khi cập nhật từng phần.
   * Trả về undefined khi bài giao không tồn tại hoặc đã công bố; quyền sửa được kiểm trong giao dịch.
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
      await assertOwner(tx, classroom, actorId, 'assignment:create', id);
      const [row] = await tx
        .select()
        .from(assignments)
        .where(eq(assignments.id, id))
        .for('update')
        .limit(1);
      if (!row || row.status !== 'draft') return undefined;
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
      await assertOwner(tx, classroom, actorId, 'assignment:publish', id);
      const [row] = await tx
        .select()
        .from(assignments)
        .where(eq(assignments.id, id))
        .for('update')
        .limit(1);
      if (!row || row.classId !== existing.classId) throw forbidden();
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
   * Chỉ trả danh sách sau khi tầng nghiệp vụ đã kiểm capability tại ngữ cảnh bài giao; kết quả giữ trạng thái đã thu hồi để phục vụ đối soát.
   */
  async listRecipients(id: string, _actorId: string) {
    const [row] = await this.db
      .select({ createdByUserId: assignments.createdByUserId })
      .from(assignments)
      .where(eq(assignments.id, id))
      .limit(1);
    if (!row) return undefined;
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
      await assertOwner(tx, classroom, actorId, 'assignment:publish', id);
      const [row] = await tx
        .select()
        .from(assignments)
        .where(eq(assignments.id, id))
        .for('update')
        .limit(1);
      if (!row || row.status !== 'published') return false;
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
        stimulusSnapshot: examRevisionQuestions.stimulusSnapshot,
      })
      .from(examRevisionQuestions)
      .where(eq(examRevisionQuestions.examRevisionId, match.assignment.examRevisionId))
      .orderBy(asc(examRevisionQuestions.position));
    const entries = snapshots.map(({ position, questionSnapshot, stimulusSnapshot }) => {
      const { id, version, type, content, stimulusId } = questionSchema.parse(questionSnapshot);
      return {
        position,
        question: { id, version, type, content, stimulusId },
        stimulus: stimulusId ? readPinnedStimulus(stimulusSnapshot, stimulusId) : null,
      };
    });
    return studentAssignmentSchema.parse({
      assignmentId: match.assignment.id,
      examRevisionId: match.assignment.examRevisionId,
      title: match.title,
      openAt: match.assignment.openAt,
      closeAt: match.assignment.closeAt,
      maxAttempts: match.assignment.maxAttempts,
      // Chỉ thêm ngữ liệu vào dữ liệu trả cho học sinh sau khi đã kiểm tra quyền;
      // không cho phép đọc ngữ liệu tùy ý chỉ bằng mã định danh.
      questions: entries.map(({ position, question, stimulus }) => ({
        position,
        question: {
          ...question,
          stimulus,
        },
      })),
    });
  }
}
