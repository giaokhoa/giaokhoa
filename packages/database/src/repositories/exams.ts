import { ClientError } from '@giaokhoa/application/common/client-error';
import type { ExamsRepository } from '@giaokhoa/application/exams/repository';
import {
  examRevisionSchema,
  examRevisionSummarySchema,
  examSchema,
  type ExamRevisionCreate,
  type ExamRevision,
} from '@giaokhoa/shared/exams';
import { questionSchema, stimulusSchema } from '@giaokhoa/shared/questions';
import { and, desc, eq } from 'drizzle-orm';
import { hasSystemCapability } from './authorization.js';
import { exams, examRevisions, examRevisionQuestions } from '../schema/exams.js';
import { question, questionBankEntries, questionVersions, stimuli } from '../schema/questions.js';
import type { Database } from '../types.js';

/**
 * Tạo lỗi khi câu hỏi được chọn cho đề không tồn tại hoặc không thuộc tác giả.
 * Dùng cùng một phản hồi để không tiết lộ danh tính câu hỏi của người khác.
 */
function invalidQuestion() {
  return new ClientError(
    'not_found',
    'exam_question_not_found',
    'Câu hỏi không tồn tại hoặc không thuộc bạn',
  );
}

/**
 * Lớp truy cập PostgreSQL cho đề thi và các bản sửa đổi có nội dung cố định.
 * Chốt bản chụp câu hỏi thuộc tác giả tại thời điểm tạo bản sửa đổi để những chỉnh sửa sau không đổi đề đã giao.
 */
export class PostgresExamsRepository implements ExamsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Tạo danh tính đề thi cho tài khoản có quyền tạo đề ở phạm vi hệ thống.
   * Kiểm tra quyền hiện hành ngay trong giao dịch trước khi tạo đề.
   */
  async create(actorId: string, input: { title: string }) {
    return this.db.transaction(async (tx) => {
      if (!(await hasSystemCapability(tx, actorId, 'exam:create_own')))
        throw new ClientError('forbidden', 'authorization_denied', 'Bạn không có quyền tạo đề');
      const [created] = await tx
        .insert(exams)
        .values({ title: input.title, createdByUserId: actorId })
        .returning();
      return examSchema.parse(created);
    });
  }

  /**
   * Liệt kê đề thi theo người tạo, sắp xếp đề mới trước.
   * Giới hạn ngay tại điều kiện truy vấn để không xuất dữ liệu đề thuộc tài khoản khác.
   */
  async listOwned(actorId: string) {
    const rows = await this.db
      .select()
      .from(exams)
      .where(eq(exams.createdByUserId, actorId))
      .orderBy(desc(exams.createdAt));
    return rows.map((row) => examSchema.parse(row));
  }

  /**
   * Đọc đề thi khi mã đề và mã chủ sở hữu đều khớp.
   * Không trả kết quả khi đề không tồn tại hoặc thuộc người khác, tránh tiết lộ tài nguyên.
   */
  async findOwned(id: string, actorId: string) {
    const [row] = await this.db
      .select()
      .from(exams)
      .where(and(eq(exams.id, id), eq(exams.createdByUserId, actorId)))
      .limit(1);
    return row ? examSchema.parse(row) : undefined;
  }

  /**
   * Đổi tiêu đề đề thi gốc khi người sửa có quyền quản lý đề và sở hữu đề.
   * Giữ các bản sửa đổi đề thi (revision) đã chốt tách biệt; không sửa nội dung hoặc tiêu đề trong lịch sử.
   */
  async updateOwned(id: string, actorId: string, input: { title: string }) {
    return this.db.transaction(async (tx) => {
      if (!(await hasSystemCapability(tx, actorId, 'exam:manage_own')))
        throw new ClientError('forbidden', 'authorization_denied', 'Bạn không có quyền sửa đề');
      const [updated] = await tx
        .update(exams)
        .set({ title: input.title, updatedAt: new Date() })
        .where(and(eq(exams.id, id), eq(exams.createdByUserId, actorId)))
        .returning();
      return updated ? examSchema.parse(updated) : undefined;
    });
  }

  /**
   * Chốt bản sửa đổi đề thi (revision) bằng bản chụp (snapshot) từ phiên bản câu hỏi
   * do tác giả sở hữu và đang sẵn sàng sử dụng (ready). Khóa các mục ngân hàng câu hỏi
   * theo thứ tự mã định danh để tránh sửa hoặc xóa đồng thời lúc tạo bản chụp.
   */
  async createRevision(
    id: string,
    actorId: string,
    input: ExamRevisionCreate,
  ): Promise<ExamRevision | undefined> {
    return this.db.transaction(async (tx) => {
      if (!(await hasSystemCapability(tx, actorId, 'exam:manage_own')))
        throw new ClientError(
          'forbidden',
          'authorization_denied',
          'Bạn không có quyền tạo phiên bản đề',
        );

      const [exam] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, id), eq(exams.createdByUserId, actorId)))
        .for('update')
        .limit(1);
      if (!exam) return undefined;

      // Khóa mục ngân hàng câu hỏi theo thứ tự cố định để đồng bộ với thao tác xóa và đổi trạng thái.
      const byId = [...input.questions].sort((a, b) => a.questionId.localeCompare(b.questionId));
      const snapshots = new Map<
        string,
        {
          versionId: string;
          question: ReturnType<typeof questionSchema.parse>;
          stimulusSnapshot: unknown;
        }
      >();
      for (const ref of byId) {
        const [owned] = await tx
          .select({ id: questionBankEntries.id })
          .from(questionBankEntries)
          .where(
            and(
              eq(questionBankEntries.id, ref.questionId),
              eq(questionBankEntries.createdByUserId, actorId),
            ),
          )
          .for('share')
          .limit(1);
        if (!owned) throw invalidQuestion();

        const [selected] = await tx
          .select({ versionRow: questionVersions, content: question })
          .from(questionVersions)
          .innerJoin(question, eq(questionVersions.questionId, question.id))
          .where(
            and(
              eq(questionVersions.questionBankEntryId, ref.questionId),
              eq(questionVersions.version, ref.version),
            ),
          )
          .limit(1);
        if (!selected) throw invalidQuestion();
        if (selected.versionRow.status !== 'ready')
          throw new ClientError(
            'conflict',
            'exam_question_not_ready',
            'Câu hỏi phải ở trạng thái ready',
          );

        const { id: _id, createdByUserId: _owner, ...definition } = selected.content;
        const snapshot = questionSchema.parse({
          ...definition,
          id: ref.questionId,
          version: ref.version,
          status: 'ready',
        });
        // Cố định ngữ liệu ngay khi chốt bản đề, khóa bản ghi để không bị sửa xen kẽ.
        const [stimulus] = selected.content.stimulusId
          ? await tx
              .select({ id: stimuli.id, content: stimuli.content })
              .from(stimuli)
              .where(eq(stimuli.id, selected.content.stimulusId))
              .for('share')
              .limit(1)
          : [undefined];
        if (selected.content.stimulusId && !stimulus) throw invalidQuestion();
        const stimulusSnapshot = stimulus ? stimulusSchema.parse(stimulus) : null;
        snapshots.set(ref.questionId, {
          versionId: selected.versionRow.id,
          question: snapshot,
          stimulusSnapshot,
        });
      }

      const [latest] = await tx
        .select({ revision: examRevisions.revision })
        .from(examRevisions)
        .where(eq(examRevisions.examId, id))
        .orderBy(desc(examRevisions.revision))
        .limit(1);
      const [created] = await tx
        .insert(examRevisions)
        .values({ examId: id, revision: (latest?.revision ?? 0) + 1, title: exam.title })
        .returning();
      const questions = input.questions.map((ref, index) => {
        const pinned = snapshots.get(ref.questionId);
        if (!pinned) throw invalidQuestion();
        return {
          examRevisionId: created.id,
          questionVersionId: pinned.versionId,
          position: index + 1,
          questionSnapshot: pinned.question,
          stimulusSnapshot: pinned.stimulusSnapshot,
        };
      });
      await tx.insert(examRevisionQuestions).values(questions);
      return examRevisionSchema.parse({
        id: created.id,
        examId: id,
        revision: created.revision,
        title: created.title,
        createdAt: created.createdAt,
        questions: questions.map(({ position, questionSnapshot }) => ({
          position,
          question: questionSchema.parse(questionSnapshot),
        })),
      });
    });
  }

  /**
   * Liệt kê các lần sửa đổi của một đề thi, bản mới nhất trước.
   * Kiểm tra quyền sở hữu đề gốc trước khi lấy lịch sử; trả về undefined nếu người yêu cầu không sở hữu đề.
   */
  async listRevisions(id: string, actorId: string) {
    const exam = await this.findOwned(id, actorId);
    if (!exam) return undefined;
    const rows = await this.db
      .select({
        id: examRevisions.id,
        revision: examRevisions.revision,
        title: examRevisions.title,
        createdAt: examRevisions.createdAt,
      })
      .from(examRevisions)
      .where(eq(examRevisions.examId, id))
      .orderBy(desc(examRevisions.revision));
    return rows.map((row) => examRevisionSummarySchema.parse(row));
  }

  /**
   * Đọc bản sửa đổi cụ thể cùng danh sách câu hỏi theo thứ tự trong đề.
   * Giới hạn theo người sở hữu đề gốc và lấy bản chụp câu hỏi cố định, không ghép lại từ phiên bản câu hỏi hiện tại.
   */
  async findRevision(
    id: string,
    revision: number,
    actorId: string,
  ): Promise<ExamRevision | undefined> {
    const [row] = await this.db
      .select({
        id: examRevisions.id,
        examId: examRevisions.examId,
        revision: examRevisions.revision,
        title: examRevisions.title,
        createdAt: examRevisions.createdAt,
      })
      .from(examRevisions)
      .innerJoin(exams, eq(examRevisions.examId, exams.id))
      .where(
        and(
          eq(examRevisions.examId, id),
          eq(examRevisions.revision, revision),
          eq(exams.createdByUserId, actorId),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    const contents = await this.db
      .select({
        position: examRevisionQuestions.position,
        question: examRevisionQuestions.questionSnapshot,
      })
      .from(examRevisionQuestions)
      .where(eq(examRevisionQuestions.examRevisionId, row.id))
      .orderBy(examRevisionQuestions.position);
    return examRevisionSchema.parse({ ...row, questions: contents });
  }
}
