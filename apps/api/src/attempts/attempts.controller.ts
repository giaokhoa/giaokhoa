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

  @Get(':assignmentId/attempts')
  async list(
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

  @Get(':id')
  async get(
    @Param('id', { schema: attemptsContract.get.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<Attempt> {
    return attemptsContract.get.responses[200].parse(
      await this.attempts.getOwn(session.user.id, id),
    );
  }

  @Put(':id/responses/:position')
  async save(
    @Param('id', { schema: attemptsContract.save.pathParams.shape.id }) id: string,
    @Param('position', { schema: attemptsContract.save.pathParams.shape.position })
    position: number,
    @Body({ schema: attemptsContract.save.body }) body: AttemptAnswer,
    @Session() session: UserSession,
  ): Promise<Attempt> {
    return attemptsContract.save.responses[200].parse(
      await this.attempts.save(session.user.id, id, position, body),
    );
  }

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

  @Get(':id/review')
  async review(
    @Param('id', { schema: attemptsContract.review.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<AttemptReview> {
    return attemptsContract.review.responses[200].parse(
      await this.attempts.review(session.user.id, id),
    );
  }

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

  @Get(':id/result')
  async result(
    @Param('id', { schema: attemptsContract.result.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<AttemptResult> {
    return attemptsContract.result.responses[200].parse(
      await this.attempts.result(session.user.id, id),
    );
  }

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
