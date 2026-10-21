import { ClientError } from '@giaokhoa/application/common/client-error';
import type { AttemptsRepository } from '@giaokhoa/application/attempts/repository';
import {
  attemptAnswerSchema,
  attemptGradeSchema,
  attemptResultSchema,
  attemptReviewSchema,
  attemptSchema,
  attemptSolutionsSchema,
  attemptSummarySchema,
  type AttemptAnswer,
  type Attempt,
  type AttemptReview,
} from '@giaokhoa/shared/attempts';
import { questionSchema, type Question } from '@giaokhoa/shared/questions';
import { and, asc, eq } from 'drizzle-orm';
import { users } from '../schema/auth.generated.js';
import { assignments, assignmentRecipients } from '../schema/assignments.js';
import { attempts, attemptResponses } from '../schema/attempts.js';
import { classes, classEnrolments } from '../schema/classes.js';
import { examRevisionQuestions } from '../schema/exams.js';
import type { Database } from '../types.js';
import { assertOwner } from './assignments.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type AttemptRow = typeof attempts.$inferSelect;

function denied() {
  return new ClientError(
    'forbidden',
    'attempt_access_denied',
    'Bạn không có quyền với lượt làm bài',
  );
}
function unavailable() {
  return new ClientError('not_found', 'attempt_not_found', 'Lượt làm bài không khả dụng');
}
function invalidAnswer() {
  return new ClientError(
    'invalid',
    'attempt_answer_invalid',
    'Câu trả lời không thuộc câu hỏi của đề',
  );
}
function closed() {
  return new ClientError('conflict', 'attempt_window_closed', 'Đã ngoài thời gian làm bài');
}

function validAccount(account: { role: string | null; banned: boolean | null } | undefined) {
  return !!account && !account.banned && ['user', 'teacher', 'admin'].includes(account.role ?? '');
}

function matches(question: Question, answer: AttemptAnswer): boolean {
  if (question.type !== answer.type) return false;
  if (question.type === 'multiple_choice' && answer.type === 'multiple_choice') {
    const last = question.content.content.at(-1);
    return (
      last?.type === 'choiceList' &&
      last.content.some((choice) => choice.attrs.id === answer.choiceId)
    );
  }
  if (question.type === 'true_false' && answer.type === 'true_false') {
    const last = question.content.content.at(-1);
    if (last?.type !== 'statementList') return false;
    const ids = new Set(last.content.map((item) => item.attrs.id));
    return (
      new Set(answer.answers.map((item) => item.statementId)).size === ids.size &&
      answer.answers.every((item) => ids.has(item.statementId))
    );
  }
  if (question.type === 'short_answer' && answer.type === 'short_answer') return true;
  if (question.type === 'essay' && answer.type === 'essay') {
    const last = question.content.content.at(-1);
    if (last?.type !== 'partList') return 'answer' in answer;
    if (!('answers' in answer)) return false;
    const ids = new Set(last.content.map((item) => item.attrs.id));
    return (
      answer.answers.length === ids.size &&
      new Set(answer.answers.map((item) => item.partId)).size === ids.size &&
      answer.answers.every((item) => ids.has(item.partId))
    );
  }
  return false;
}

function summary(row: AttemptRow) {
  return attemptSummarySchema.parse({
    id: row.id,
    assignmentId: row.assignmentId,
    userId: row.userId,
    attemptNumber: row.attemptNumber,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    gradedAt: row.gradedAt,
    score: row.scoreBasisPoints === null ? null : row.scoreBasisPoints / 100,
    feedback: row.feedback,
  });
}

async function detail(tx: Transaction, row: AttemptRow, teacher = false) {
  const responses = await tx
    .select()
    .from(attemptResponses)
    .where(eq(attemptResponses.attemptId, row.id))
    .orderBy(asc(attemptResponses.position));
  const dto = {
    id: row.id,
    assignmentId: row.assignmentId,
    userId: row.userId,
    attemptNumber: row.attemptNumber,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    gradedAt: row.gradedAt,
    responses: responses.map(({ position, answer, updatedAt }) => ({
      position,
      answer: attemptAnswerSchema.parse(answer),
      updatedAt,
    })),
  };
  return teacher
    ? attemptReviewSchema.parse({
        ...dto,
        score: row.scoreBasisPoints === null ? null : row.scoreBasisPoints / 100,
        feedback: row.feedback,
      })
    : attemptSchema.parse(dto);
}

/**
 * Lớp truy cập PostgreSQL cho lượt làm và câu trả lời của học sinh.
 * Phối hợp khóa bản ghi với ràng buộc cơ sở dữ liệu để bảo vệ giới hạn số lượt làm, thời hạn và vòng đời nộp/chấm.
 */
export class PostgresAttemptsRepository implements AttemptsRepository {
  constructor(private readonly db: Database) {}

  async findAssignmentClass(assignmentId: string) {
    const [row] = await this.db
      .select({ classId: assignments.classId })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    return row?.classId;
  }

  async findContext(attemptId: string) {
    const [row] = await this.db
      .select({
        classId: assignments.classId,
        userId: attempts.userId,
        status: attempts.status,
        enrolmentStatus: classEnrolments.status,
      })
      .from(attempts)
      .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
      .leftJoin(
        classEnrolments,
        and(
          eq(classEnrolments.classId, assignments.classId),
          eq(classEnrolments.userId, attempts.userId),
        ),
      )
      .where(eq(attempts.id, attemptId))
      .limit(1);
    return row ? { ...row, status: attemptSchema.shape.status.parse(row.status) } : undefined;
  }

  async start(assignmentId: string, actorId: string, now: Date): Promise<Attempt> {
    const classId = await this.findAssignmentClass(assignmentId);
    if (!classId) throw unavailable();
    return this.db.transaction(async (tx) => {
      // ponytail: Khóa theo lớp để đồng bộ khi tham gia hoặc đình chỉ thành viên; nếu tải cao, chuyển sang khóa từng bản ghi người nhận (recipient).
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, classId))
        .for('update')
        .limit(1);
      if (!classroom || classroom.status !== 'active') throw denied();
      const [assignment] = await tx
        .select()
        .from(assignments)
        .where(eq(assignments.id, assignmentId))
        .for('update')
        .limit(1);
      if (!assignment || assignment.status !== 'published') throw unavailable();
      const [member] = await tx
        .select({ id: classEnrolments.userId })
        .from(classEnrolments)
        .innerJoin(
          assignmentRecipients,
          and(
            eq(assignmentRecipients.assignmentId, assignmentId),
            eq(assignmentRecipients.userId, classEnrolments.userId),
            eq(assignmentRecipients.status, 'active'),
          ),
        )
        .where(
          and(
            eq(classEnrolments.classId, classId),
            eq(classEnrolments.userId, actorId),
            eq(classEnrolments.status, 'active'),
          ),
        )
        .limit(1);
      if (!member) throw denied();
      const [account] = await tx
        .select({ role: users.role, banned: users.banned })
        .from(users)
        .where(eq(users.id, actorId))
        .for('share')
        .limit(1);
      if (!validAccount(account)) throw denied();
      if (now < assignment.openAt || now >= assignment.closeAt) throw closed();

      const history = await tx
        .select()
        .from(attempts)
        .where(and(eq(attempts.assignmentId, assignmentId), eq(attempts.userId, actorId)))
        .orderBy(asc(attempts.attemptNumber));
      const unfinished = history.find((attempt) => attempt.status === 'in_progress');
      if (unfinished) return attemptSchema.parse(await detail(tx, unfinished));
      if (history.length >= assignment.maxAttempts)
        throw new ClientError('conflict', 'attempts_exhausted', 'Đã hết lượt làm bài');
      const [created] = await tx
        .insert(attempts)
        .values({
          assignmentId,
          userId: actorId,
          attemptNumber: history.length + 1,
          startedAt: now,
        })
        .returning();
      return attemptSchema.parse(await detail(tx, created));
    });
  }

  /**
   * Dùng chung cho lưu đáp án và nộp bài để khóa lớp và lượt làm (attempt)
   * trong cùng một giao dịch (transaction). Không cho sửa khi hết giờ, đã nộp,
   * quan hệ tham gia lớp (enrolment) bị ngừng hoặc quyền nhận bài đã bị thu hồi.
   */
  private async writable(tx: Transaction, id: string, actorId: string, now: Date) {
    const [ref] = await tx
      .select({ classId: assignments.classId })
      .from(attempts)
      .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
      .where(and(eq(attempts.id, id), eq(attempts.userId, actorId)))
      .limit(1);
    if (!ref) throw unavailable();
    const [classroom] = await tx
      .select()
      .from(classes)
      .where(eq(classes.id, ref.classId))
      .for('update')
      .limit(1);
    if (!classroom || classroom.status !== 'active') throw denied();
    const [row] = await tx
      .select({ attempt: attempts, assignment: assignments })
      .from(attempts)
      .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
      .where(and(eq(attempts.id, id), eq(attempts.userId, actorId)))
      .for('update')
      .limit(1);
    if (!row || row.attempt.status !== 'in_progress') {
      if (!row) throw unavailable();
      throw new ClientError('conflict', 'attempt_not_in_progress', 'Lượt làm bài đã kết thúc');
    }
    const [active] = await tx
      .select({ userId: classEnrolments.userId })
      .from(classEnrolments)
      .innerJoin(
        assignmentRecipients,
        and(
          eq(assignmentRecipients.assignmentId, row.assignment.id),
          eq(assignmentRecipients.userId, classEnrolments.userId),
          eq(assignmentRecipients.status, 'active'),
        ),
      )
      .where(
        and(
          eq(classEnrolments.classId, row.assignment.classId),
          eq(classEnrolments.userId, actorId),
          eq(classEnrolments.status, 'active'),
        ),
      )
      .limit(1);
    if (!active) throw denied();
    const [account] = await tx
      .select({ role: users.role, banned: users.banned })
      .from(users)
      .where(eq(users.id, actorId))
      .for('share')
      .limit(1);
    if (!validAccount(account)) throw denied();
    if (now < row.assignment.openAt || now >= row.assignment.closeAt) throw closed();
    return row;
  }

  async save(
    id: string,
    actorId: string,
    position: number,
    answer: AttemptAnswer,
    now: Date,
  ): Promise<Attempt> {
    return this.db.transaction(async (tx) => {
      const row = await this.writable(tx, id, actorId, now);
      const [question] = await tx
        .select({ snapshot: examRevisionQuestions.questionSnapshot })
        .from(examRevisionQuestions)
        .where(
          and(
            eq(examRevisionQuestions.examRevisionId, row.assignment.examRevisionId),
            eq(examRevisionQuestions.position, position),
          ),
        )
        .limit(1);
      if (!question || !matches(questionSchema.parse(question.snapshot), answer))
        throw invalidAnswer();
      await tx
        .insert(attemptResponses)
        .values({
          attemptId: id,
          position,
          answer,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [attemptResponses.attemptId, attemptResponses.position],
          set: { answer, updatedAt: now },
        });
      return attemptSchema.parse(await detail(tx, row.attempt));
    });
  }

  async submit(id: string, actorId: string, now: Date): Promise<Attempt> {
    return this.db.transaction(async (tx) => {
      await this.writable(tx, id, actorId, now);
      const [submitted] = await tx
        .update(attempts)
        .set({
          status: 'submitted',
          submittedAt: now,
        })
        .where(eq(attempts.id, id))
        .returning();
      return attemptSchema.parse(await detail(tx, submitted));
    });
  }

  private async readOwn(tx: Transaction, id: string, actorId: string) {
    const [ref] = await tx
      .select({ classId: assignments.classId })
      .from(attempts)
      .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
      .where(and(eq(attempts.id, id), eq(attempts.userId, actorId)))
      .limit(1);
    if (!ref) return undefined;
    const [classroom] = await tx
      .select()
      .from(classes)
      .where(eq(classes.id, ref.classId))
      .for('share')
      .limit(1);
    if (!classroom) return undefined;
    const [row] = await tx
      .select({
        attempt: attempts,
        assignment: assignments,
        enrolmentStatus: classEnrolments.status,
        recipientStatus: assignmentRecipients.status,
        banned: users.banned,
        role: users.role,
      })
      .from(attempts)
      .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
      .innerJoin(users, eq(users.id, attempts.userId))
      .leftJoin(
        classEnrolments,
        and(
          eq(classEnrolments.classId, assignments.classId),
          eq(classEnrolments.userId, attempts.userId),
        ),
      )
      .leftJoin(
        assignmentRecipients,
        and(
          eq(assignmentRecipients.assignmentId, attempts.assignmentId),
          eq(assignmentRecipients.userId, attempts.userId),
        ),
      )
      .where(and(eq(attempts.id, id), eq(attempts.userId, actorId)))
      .limit(1);
    if (!row || !validAccount(row)) return undefined;
    if (row.attempt.status === 'in_progress') {
      if (
        classroom.status !== 'active' ||
        row.enrolmentStatus !== 'active' ||
        row.recipientStatus !== 'active'
      )
        return undefined;
    } else if (row.enrolmentStatus !== 'active' && row.enrolmentStatus !== 'left') return undefined;
    return row;
  }

  async getOwn(id: string, actorId: string): Promise<Attempt | undefined> {
    return this.db.transaction(async (tx) => {
      const row = await this.readOwn(tx, id, actorId);
      return row ? attemptSchema.parse(await detail(tx, row.attempt)) : undefined;
    });
  }

  async listForTeacher(assignmentId: string, actorId: string) {
    const classId = await this.findAssignmentClass(assignmentId);
    if (!classId) return undefined;
    return this.db.transaction(async (tx) => {
      const [classroom] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, classId))
        .for('share')
        .limit(1);
      await assertOwner(tx, classroom, actorId);
      const [assignment] = await tx
        .select({ ownerId: assignments.createdByUserId })
        .from(assignments)
        .where(eq(assignments.id, assignmentId))
        .limit(1);
      if (!assignment || assignment.ownerId !== actorId) return undefined;
      const rows = await tx
        .select()
        .from(attempts)
        .where(eq(attempts.assignmentId, assignmentId))
        .orderBy(asc(attempts.userId), asc(attempts.attemptNumber));
      return rows.map(summary);
    });
  }

  private async teacherAttempt(tx: Transaction, id: string, actorId: string, lock = false) {
    const [ref] = await tx
      .select({ classId: assignments.classId })
      .from(attempts)
      .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
      .where(eq(attempts.id, id))
      .limit(1);
    if (!ref) return undefined;
    const [classroom] = await tx
      .select()
      .from(classes)
      .where(eq(classes.id, ref.classId))
      .for(lock ? 'update' : 'share')
      .limit(1);
    await assertOwner(tx, classroom, actorId);
    const [row] = await tx
      .select({ attempt: attempts, createdByUserId: assignments.createdByUserId })
      .from(attempts)
      .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
      .where(eq(attempts.id, id))
      .for(lock ? 'update' : 'share')
      .limit(1);
    if (!row || row.createdByUserId !== actorId) return undefined;
    return row.attempt;
  }

  async review(id: string, actorId: string): Promise<AttemptReview | undefined> {
    return this.db.transaction(async (tx) => {
      const row = await this.teacherAttempt(tx, id, actorId);
      return row ? attemptReviewSchema.parse(await detail(tx, row, true)) : undefined;
    });
  }

  async grade(
    id: string,
    actorId: string,
    input: Parameters<AttemptsRepository['grade']>[2],
    now: Date,
  ): Promise<AttemptReview | undefined> {
    const parsed = attemptGradeSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const row = await this.teacherAttempt(tx, id, actorId, true);
      if (!row || row.status === 'in_progress') return undefined;
      const [graded] = await tx
        .update(attempts)
        .set({
          status: 'graded',
          scoreBasisPoints: Math.round(parsed.score * 100),
          feedback: parsed.feedback,
          gradedAt: now,
        })
        .where(eq(attempts.id, id))
        .returning();
      return attemptReviewSchema.parse(await detail(tx, graded, true));
    });
  }

  async result(id: string, actorId: string, now: Date) {
    return this.db.transaction(async (tx) => {
      const row = await this.readOwn(tx, id, actorId);
      if (!row || row.attempt.status !== 'graded' || !row.attempt.gradedAt) return undefined;
      const scoreReleased =
        row.assignment.releaseScoreAt !== null && row.assignment.releaseScoreAt <= now;
      const feedbackReleased =
        row.assignment.releaseFeedbackAt !== null && row.assignment.releaseFeedbackAt <= now;
      if (!scoreReleased && !feedbackReleased) return undefined;
      return attemptResultSchema.parse({
        attemptId: row.attempt.id,
        gradedAt: row.attempt.gradedAt,
        score: scoreReleased ? (row.attempt.scoreBasisPoints ?? 0) / 100 : null,
        feedback: feedbackReleased ? row.attempt.feedback : null,
      });
    });
  }

  async solutions(id: string, actorId: string, now: Date) {
    return this.db.transaction(async (tx) => {
      const row = await this.readOwn(tx, id, actorId);
      if (
        !row ||
        row.attempt.status === 'in_progress' ||
        !row.assignment.releaseSolutionsAt ||
        row.assignment.releaseSolutionsAt > now
      )
        return undefined;
      const questions = await tx
        .select({
          position: examRevisionQuestions.position,
          snapshot: examRevisionQuestions.questionSnapshot,
        })
        .from(examRevisionQuestions)
        .where(eq(examRevisionQuestions.examRevisionId, row.assignment.examRevisionId))
        .orderBy(asc(examRevisionQuestions.position));
      return attemptSolutionsSchema.parse({
        attemptId: id,
        questions: questions.map(({ position, snapshot }) => ({
          position,
          solution: questionSchema.parse(snapshot).solution,
        })),
      });
    });
  }
}
