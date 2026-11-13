import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { CoursesService } from '../courses/courses.service';
import { CompletionService } from './completion.service';
import {
  markCourseCriteriaCompletionSchema, markCourseSelfCompletionSchema, markManualCompletionSchema,
  setCompletionCriteriaSchema, type MarkCriteriaDto, type MarkManualDto, type MarkSelfDto, type SetCriteriaDto,
} from './dto/completion.dto';

@ApiTags('completion')
@Controller({ path: 'courses/:courseId/completion', version: '1' })
export class CompletionController {
  constructor(
    private readonly completion: CompletionService,
    private readonly courses: CoursesService,
  ) {}

  @Get('me')
  async myCompletion(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() viewer: AuthenticatedUser) {
    await this.courses.assertCourseAccess(viewer.id, courseId);
    const activities = await this.completion.listCmCompletionsForCourse(courseId, viewer.id);
    const courseCompletion = await this.completion.getCourseCompletion(viewer.id, courseId);
    return { activities, course: courseCompletion };
  }

  @Get('users/:userId')
  async userCompletion(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() viewer: AuthenticatedUser) {
    if (viewer.id !== userId) await this.completion.requireCompletionManage(viewer.id, courseId);
    const activities = await this.completion.listCmCompletionsForCourse(courseId, userId);
    const courseCompletion = await this.completion.getCourseCompletion(userId, courseId);
    return { activities, course: courseCompletion };
  }

  @Get()
  async listCourseCompletions(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() viewer: AuthenticatedUser) {
    await this.completion.requireCompletionManage(viewer.id, courseId);
    return this.completion.listCourseCompletions(courseId);
  }

  @Get('criteria')
  async getCriteria(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.completion.getCriteria(actor.id, courseId);
  }
  @Put('criteria')
  async setCriteria(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: setCompletionCriteriaSchema }) dto: SetCriteriaDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.completion.setCriteria(actor.id, courseId, dto);
  }
  @Post('recalculate')
  async recalculate(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.completion.requireCompletionManage(actor.id, courseId);
    return this.completion.recalculateCourse(courseId);
  }

  @Post('self')
  async markSelf(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: markCourseSelfCompletionSchema }) dto: MarkSelfDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.completion.markSelfCompletion(actor.id, courseId, dto.complete);
  }

  @Post('criteria/:criteriaId/mark')
  async markCriterion(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Param('criteriaId', { schema: uuidIdSchema }) criteriaId: string, @Body({ schema: markCourseCriteriaCompletionSchema }) dto: MarkCriteriaDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.completion.markCriterionByRole(actor.id, courseId, criteriaId, dto.userId, dto.complete);
  }
}

@ApiTags('completion')
@Controller({ path: 'courses/:courseId/modules/:cmId/completion', version: '1' })
export class CourseModuleCompletionController {
  constructor(private readonly completion: CompletionService) {}

  @Post('manual')
  async markManual(@Param('cmId', { schema: uuidIdSchema }) cmId: string, @Body({ schema: markManualCompletionSchema }) dto: MarkManualDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.completion.markManual(actor.id, cmId, dto.userId, dto.complete);
  }
}
