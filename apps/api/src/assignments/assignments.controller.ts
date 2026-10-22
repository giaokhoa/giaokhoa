import { AssignmentsService } from '@giaokhoa/application/assignments/service';
import type {
  Assignment,
  AssignmentPreview,
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

  @Get()
  async list(@Session() session: UserSession) {
    return assignmentsContract.list.responses[200].parse(
      await this.assignments.list(session.user.id),
    );
  }

  /** Chủ lớp tạo bản nháp bài giao từ một phiên bản đề của chính mình. */
  @Post()
  async create(
    @Body({ schema: assignmentsContract.create.body }) body: AssignmentCreate,
    @Session() session: UserSession,
  ): Promise<Assignment> {
    return assignmentsContract.create.responses[201].parse(
      await this.assignments.create(session.user.id, body),
    );
  }

  /** Người tạo bài giao xem cấu hình và lịch công bố; đây không phải bản đề dành cho học sinh. */
  @Get(':id/preview')
  async preview(
    @Param('id', { schema: assignmentsContract.preview.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<AssignmentPreview> {
    return assignmentsContract.preview.responses[200].parse(
      await this.assignments.preview(session.user.id, id),
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

  /** Người tạo chỉnh cấu hình bài giao khi vẫn ở trạng thái draft. */
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

  /** Chủ lớp công bố bài giao và chốt danh sách học sinh active ở thời điểm công bố. */
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

  /** Chủ bài giao xem danh sách người nhận, nguồn giao và trạng thái thu hồi. */
  @Get(':id/recipients')
  async recipients(
    @Param('id', { schema: assignmentsContract.recipients.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<AssignmentRecipient[]> {
    return assignmentsContract.recipients.responses[200].parse(
      await this.assignments.listRecipients(session.user.id, id),
    );
  }

  /** Chủ bài giao thu hồi quyền truy cập của một học sinh, giữ lịch sử đã giao. */
  @Post(':id/recipients/:userId/revoke')
  @HttpCode(204)
  async revoke(
    @Param('id', { schema: assignmentsContract.revoke.pathParams.shape.id }) id: string,
    @Param('userId', { schema: assignmentsContract.revoke.pathParams.shape.userId }) userId: string,
    @Session() session: UserSession,
  ): Promise<void> {
    await this.assignments.revokeRecipient(session.user.id, id, userId);
  }

  /** Học sinh có quyền nhận bài xem câu hỏi và ngữ liệu sau giờ mở; không lộ lời giải/gợi ý. */
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
