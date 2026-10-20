import { ClassesService } from '@giaokhoa/application/classes/service';
import type {
  Class,
  ClassCreate,
  ClassEnrolment,
  ClassJoinCodeCreate,
  ClassJoinResult,
  ClassPatch,
} from '@giaokhoa/shared/classes';
import { classesContract } from '@giaokhoa/shared/http/classes';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller('classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Post()
  async create(
    @Body({ schema: classesContract.create.body }) body: ClassCreate,
    @Session() session: UserSession,
  ): Promise<Class> {
    return classesContract.create.responses[201].parse(
      await this.classes.createClass(session.user.id, body),
    );
  }

  @Post('join')
  async join(
    @Body({ schema: classesContract.join.body }) body: { code: string },
    @Session() session: UserSession,
  ): Promise<ClassJoinResult> {
    return classesContract.join.responses[201].parse(
      await this.classes.joinClass(session.user.id, body.code),
    );
  }

  @Get(':id')
  async get(
    @Param('id', { schema: classesContract.get.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<Class> {
    return classesContract.get.responses[200].parse(
      await this.classes.getClass(session.user.id, id),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: classesContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: classesContract.update.body }) body: ClassPatch,
    @Session() session: UserSession,
  ): Promise<Class> {
    return classesContract.update.responses[200].parse(
      await this.classes.updateClass(session.user.id, id, body),
    );
  }

  @Post(':id/join-codes')
  async createJoinCode(
    @Param('id', { schema: classesContract.createJoinCode.pathParams.shape.id }) id: string,
    @Body({ schema: classesContract.createJoinCode.body }) body: ClassJoinCodeCreate,
    @Session() session: UserSession,
  ) {
    return classesContract.createJoinCode.responses[201].parse(
      await this.classes.createJoinCode(session.user.id, id, body),
    );
  }

  @Get(':id/members')
  async members(
    @Param('id', { schema: classesContract.members.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<ClassEnrolment[]> {
    return classesContract.members.responses[200].parse(
      await this.classes.listMembers(session.user.id, id),
    );
  }

  @Post(':id/members/:userId/approve')
  async approve(
    @Param('id', { schema: classesContract.approve.pathParams.shape.id }) id: string,
    @Param('userId', { schema: classesContract.approve.pathParams.shape.userId }) userId: string,
    @Session() session: UserSession,
  ): Promise<ClassEnrolment> {
    return classesContract.approve.responses[200].parse(
      await this.classes.approveMember(session.user.id, id, userId),
    );
  }

  @Post(':id/members/:userId/suspend')
  async suspend(
    @Param('id', { schema: classesContract.suspend.pathParams.shape.id }) id: string,
    @Param('userId', { schema: classesContract.suspend.pathParams.shape.userId }) userId: string,
    @Session() session: UserSession,
  ): Promise<ClassEnrolment> {
    return classesContract.suspend.responses[200].parse(
      await this.classes.suspendMember(session.user.id, id, userId),
    );
  }

  @Delete(':id/join-codes/:codeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeJoinCode(
    @Param('id', { schema: classesContract.revokeJoinCode.pathParams.shape.id }) id: string,
    @Param('codeId', { schema: classesContract.revokeJoinCode.pathParams.shape.codeId })
    codeId: string,
    @Session() session: UserSession,
  ): Promise<void> {
    await this.classes.revokeJoinCode(session.user.id, id, codeId);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(
    @Param('id', { schema: classesContract.leave.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<void> {
    await this.classes.leaveClass(session.user.id, id);
  }
}
