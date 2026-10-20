import { AssignmentsService } from '@giaokhoa/application/assignments/service';
import type {
  Assignment,
  AssignmentCreate,
  AssignmentPatch,
  AssignmentRecipient,
  StudentAssignment,
} from '@giaokhoa/shared/assignments';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post()
  async create(
    @Body({ schema: assignmentsContract.create.body }) body: AssignmentCreate,
    @Session() session: UserSession,
  ): Promise<Assignment> {
    return assignmentsContract.create.responses[201].parse(
      await this.assignments.create(session.user.id, body),
    );
  }

  @Get(':id')
  async get(
    @Param('id', { schema: assignmentsContract.get.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<Assignment> {
    return assignmentsContract.get.responses[200].parse(
      await this.assignments.get(session.user.id, id),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: assignmentsContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: assignmentsContract.update.body }) body: AssignmentPatch,
    @Session() session: UserSession,
  ): Promise<Assignment> {
    return assignmentsContract.update.responses[200].parse(
      await this.assignments.update(session.user.id, id, body),
    );
  }

  @Post(':id/publish')
  @HttpCode(200)
  async publish(
    @Param('id', { schema: assignmentsContract.publish.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<Assignment> {
    return assignmentsContract.publish.responses[200].parse(
      await this.assignments.publish(session.user.id, id),
    );
  }

  @Get(':id/recipients')
  async recipients(
    @Param('id', { schema: assignmentsContract.recipients.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<AssignmentRecipient[]> {
    return assignmentsContract.recipients.responses[200].parse(
      await this.assignments.listRecipients(session.user.id, id),
    );
  }

  @Post(':id/recipients/:userId/revoke')
  @HttpCode(204)
  async revoke(
    @Param('id', { schema: assignmentsContract.revoke.pathParams.shape.id }) id: string,
    @Param('userId', { schema: assignmentsContract.revoke.pathParams.shape.userId }) userId: string,
    @Session() session: UserSession,
  ): Promise<void> {
    await this.assignments.revokeRecipient(session.user.id, id, userId);
  }

  /** Response dành cho học sinh, không trả DTO soạn đề chứa đáp án. */
  @Get(':id/delivery')
  async delivery(
    @Param('id', { schema: assignmentsContract.delivery.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<StudentAssignment> {
    return assignmentsContract.delivery.responses[200].parse(
      await this.assignments.getDelivery(session.user.id, id),
    );
  }
}
