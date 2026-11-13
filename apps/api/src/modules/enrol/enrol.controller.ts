import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { createEnrolInstanceSchema, enrolUserSchema, selfEnrolSchema, updateEnrolInstanceSchema, type CreateEnrolInstanceDto, type EnrolUserDto, type SelfEnrolDto, type UpdateEnrolInstanceDto } from './dto/enrol.dto';
import { EnrolService } from './enrol.service';

@ApiTags('enrol')
@Controller({ path: 'courses/:courseId/enrol', version: '1' })
export class EnrolController {
  constructor(private readonly enrol: EnrolService) {}

  @Post('instances')
  async createInstance(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createEnrolInstanceSchema }) dto: CreateEnrolInstanceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrol.createInstance(actor.id, courseId, dto);
  }
  @Get('instances')
  async listInstances(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrol.listInstances(courseId, actor.id);
  }
  @Patch('instances/:instanceId')
  async updateInstance(@Param('instanceId', { schema: uuidIdSchema }) instanceId: string, @Body({ schema: updateEnrolInstanceSchema }) dto: UpdateEnrolInstanceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrol.updateInstance(actor.id, instanceId, dto);
  }
  @Delete('instances/:instanceId')
  async deleteInstance(@Param('instanceId', { schema: uuidIdSchema }) instanceId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.enrol.deleteInstance(actor.id, instanceId);
    return { deleted: true };
  }

  @Post('instances/:instanceId/enrol')
  async enrolUser(@Param('instanceId', { schema: uuidIdSchema }) instanceId: string, @Body({ schema: enrolUserSchema }) dto: EnrolUserDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrol.enrolUser(actor.id, instanceId, dto.userId, { timeStart: dto.timeStart, timeEnd: dto.timeEnd });
  }
  @Post('instances/:instanceId/self-enrol')
  async selfEnrol(@Param('instanceId', { schema: uuidIdSchema }) instanceId: string, @Body({ schema: selfEnrolSchema }) dto: SelfEnrolDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrol.selfEnrol(actor.id, instanceId, dto.enrolmentKey);
  }
  @Post('instances/:instanceId/self-unenrol')
  async selfUnenrol(@Param('instanceId', { schema: uuidIdSchema }) instanceId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrol.selfUnenrol(actor.id, instanceId);
  }
  @Post('instances/:instanceId/users/:userId/suspend')
  async suspend(@Param('instanceId', { schema: uuidIdSchema }) instanceId: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrol.setSuspended(actor.id, instanceId, userId, true);
  }
  @Post('instances/:instanceId/users/:userId/reactivate')
  async reactivate(@Param('instanceId', { schema: uuidIdSchema }) instanceId: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrol.setSuspended(actor.id, instanceId, userId, false);
  }
  @Delete('instances/:instanceId/users/:userId')
  async unenrol(@Param('instanceId', { schema: uuidIdSchema }) instanceId: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrol.unenrolUser(actor.id, instanceId, userId);
  }
}

@ApiTags('enrol')
@Controller({ path: 'courses/:courseId/enrolments', version: '1' })
export class CourseEnrolmentsController {
  constructor(private readonly enrol: EnrolService) {}

  @Get()
  async listEnrolments(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.enrol.listEnrolmentsForCourse(courseId, viewer.id);
  }
  @Get('me')
  async myEnrolment(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() viewer: AuthenticatedUser) {
    return {
      courseId, userId: viewer.id,
      enrolled: await this.enrol.isEnrolled(courseId, viewer.id),
      active: await this.enrol.isEnrolled(courseId, viewer.id, { onlyActive: true }),
    };
  }
}
