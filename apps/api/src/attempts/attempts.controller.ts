import { AttemptsService } from '@giaokhoa/application/attempts/service';
import type {
  Attempt,
  AttemptAnswer,
  AttemptGrade,
  AttemptResult,
  AttemptReview,
  AttemptSolutions,
  AttemptSummary,
} from '@giaokhoa/shared/attempts';
import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller('assignments')
export class AssignmentAttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  /** Học sinh được giao bài bắt đầu một lượt làm mới, trong giới hạn thời gian và số lượt. */
  @Post(':assignmentId/attempts')
  async start(
    @Param('assignmentId', { schema: attemptsContract.start.pathParams.shape.assignmentId })
    assignmentId: string,
    @Session() session: UserSession,
  ): Promise<Attempt> {
    return attemptsContract.start.responses[201].parse(
      await this.attempts.start(session.user.id, assignmentId),
    );
  }

  /**
   * Giáo viên có quyền chấm của lớp xem danh sách lượt làm theo bài giao:
   * người làm, trạng thái, thời điểm và điểm/nhận xét; không trả các câu trả lời.
   */
  @Get(':assignmentId/attempts')
  async listForTeacher(
    @Param('assignmentId', {
      schema: attemptsContract.listForTeacher.pathParams.shape.assignmentId,
    })
    assignmentId: string,
    @Session() session: UserSession,
  ): Promise<AttemptSummary[]> {
    return attemptsContract.listForTeacher.responses[200].parse(
      await this.attempts.listForTeacher(session.user.id, assignmentId),
    );
  }
}

@Controller('attempts')
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get()
  async listOwn(@Session() session: UserSession) {
    return attemptsContract.listOwn.responses[200].parse(
      await this.attempts.listOwn(session.user.id),
    );
  }

  /** Học sinh xem lượt làm của chính mình cùng các câu đã lưu; không trả đáp án chuẩn. */
  @Get(':id')
  async getOwn(
    @Param('id', { schema: attemptsContract.get.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<Attempt> {
    return attemptsContract.get.responses[200].parse(
      await this.attempts.getOwn(session.user.id, id),
    );
  }

  /** Lưu hoặc thay câu trả lời ở vị trí đề thi khi lượt làm vẫn cho phép chỉnh sửa. */
  @Put(':id/responses/:position')
  async save(
    @Param('id', { schema: attemptsContract.save.pathParams.shape.id }) id: string,
    @Param('position', { schema: attemptsContract.save.pathParams.shape.position })
    position: number,
    @Body({ schema: attemptsContract.save.body })
    body: { answer: AttemptAnswer; expectedAnswer: AttemptAnswer | null },
    @Session() session: UserSession,
  ): Promise<Attempt> {
    return attemptsContract.save.responses[200].parse(
      await this.attempts.save(session.user.id, id, position, body.answer, body.expectedAnswer),
    );
  }

  /** Học sinh nộp bài, chốt các câu trả lời và chuyển lượt làm khỏi trạng thái đang làm. */
  @Post(':id/submit')
  @HttpCode(200)
  async submit(
    @Param('id', { schema: attemptsContract.submit.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<Attempt> {
    return attemptsContract.submit.responses[200].parse(
      await this.attempts.submit(session.user.id, id),
    );
  }

  /** Giáo viên xem toàn bộ câu trả lời của một lượt làm để chấm và phản hồi. */
  @Get(':id/review')
  async review(
    @Param('id', { schema: attemptsContract.review.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<AttemptReview> {
    return attemptsContract.review.responses[200].parse(
      await this.attempts.review(session.user.id, id),
    );
  }

  /** Giáo viên ghi điểm và nhận xét cho lượt làm đã nộp; không phải API tự chấm. */
  @Patch(':id/grade')
  async grade(
    @Param('id', { schema: attemptsContract.grade.pathParams.shape.id }) id: string,
    @Body({ schema: attemptsContract.grade.body }) body: AttemptGrade,
    @Session() session: UserSession,
  ): Promise<AttemptReview> {
    return attemptsContract.grade.responses[200].parse(
      await this.attempts.grade(session.user.id, id, body),
    );
  }

  /** Học sinh xem điểm/nhận xét khi bài đã chấm và đến mốc công bố kết quả. */
  @Get(':id/result')
  async result(
    @Param('id', { schema: attemptsContract.result.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<AttemptResult> {
    return attemptsContract.result.responses[200].parse(
      await this.attempts.result(session.user.id, id),
    );
  }

  /** Trả đáp án từng câu cho chủ lượt làm sau mốc releaseSolutionsAt của bài giao. */
  @Get(':id/solutions')
  async solutions(
    @Param('id', { schema: attemptsContract.solutions.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<AttemptSolutions> {
    return attemptsContract.solutions.responses[200].parse(
      await this.attempts.solutions(session.user.id, id),
    );
  }
}
