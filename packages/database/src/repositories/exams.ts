import { ClientError } from '@giaokhoa/application/common/client-error';
import type { ExamsRepository } from '@giaokhoa/application/exams/repository';
import {
  examRevisionSchema,
  examRevisionSummarySchema,
  examSchema,
  type ExamRevisionCreate,
  type ExamRevision,
} from '@giaokhoa/shared/exams';
import { questionSchema } from '@giaokhoa/shared/questions';
import { and, desc, eq } from 'drizzle-orm';
import { users } from '../schema/auth.generated.js';
import { exams, examRevisions, examRevisionQuestions } from '../schema/exams.js';
import { question, questionBankEntries, questionVersions } from '../schema/questions.js';
import type { Database } from '../types.js';

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

  async create(actorId: string, input: { title: string }) {
    return this.db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ role: users.role, banned: users.banned })
        .from(users)
        .where(eq(users.id, actorId))
        .for('share')
        .limit(1);
      if (!actor || actor.banned || (actor.role !== 'teacher' && actor.role !== 'admin'))
        throw new ClientError('forbidden', 'authorization_denied', 'Bạn không có quyền tạo đề');
      const [created] = await tx
        .insert(exams)
        .values({ title: input.title, createdByUserId: actorId })
        .returning();
      return examSchema.parse(created);
    });
  }

  async listOwned(actorId: string) {
    const rows = await this.db
      .select()
      .from(exams)
      .where(eq(exams.createdByUserId, actorId))
      .orderBy(desc(exams.createdAt));
    return rows.map((row) => examSchema.parse(row));
  }

  async findOwned(id: string, actorId: string) {
    const [row] = await this.db
      .select()
      .from(exams)
      .where(and(eq(exams.id, id), eq(exams.createdByUserId, actorId)))
      .limit(1);
    return row ? examSchema.parse(row) : undefined;
  }

  async updateOwned(id: string, actorId: string, input: { title: string }) {
    return this.db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ role: users.role, banned: users.banned })
        .from(users)
        .where(eq(users.id, actorId))
        .for('share')
        .limit(1);
      if (!actor || actor.banned || (actor.role !== 'teacher' && actor.role !== 'admin'))
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
      const [actor] = await tx
        .select({ role: users.role, banned: users.banned })
        .from(users)
        .where(eq(users.id, actorId))
        .for('share')
        .limit(1);
      if (!actor || actor.banned || (actor.role !== 'teacher' && actor.role !== 'admin'))
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
        { versionId: string; question: ReturnType<typeof questionSchema.parse> }
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
        snapshots.set(ref.questionId, { versionId: selected.versionRow.id, question: snapshot });
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
          question: questionSnapshot,
        })),
      });
    });
  }

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
