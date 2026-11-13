import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { GradesService } from './grades.service';
import { gradePublicationActionSchema, setGradePostingPolicySchema, setGradeSchema, updateGradeItemSchema, updateGradeSchema, type GradePublicationActionDto, type SetGradeDto, type SetGradePostingPolicyDto, type UpdateGradeDto, type UpdateGradeItemDto } from './dto/grades.dto';

@ApiTags('grades')
@Controller({ path: 'grade-items', version: '1' })
export class GradeItemsController {
  constructor(private readonly grades: GradesService) {}

  @Patch(':itemId')
  async updateItem(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: updateGradeItemSchema }) dto: UpdateGradeItemDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.updateItem(actor.id, itemId, dto);
  }
  @Delete(':itemId')
  async deleteItem(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.grades.deleteItem(actor.id, itemId);
    return { deleted: true };
  }

  @Post(':itemId/grades')
  async setGrade(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: setGradeSchema }) dto: SetGradeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.setGrade(actor.id, itemId, dto.userId, dto);
  }
  @Put(':itemId/posting-policy')
  async setPostingPolicy(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: setGradePostingPolicySchema }) dto: SetGradePostingPolicyDto, @CurrentUser() actor: AuthenticatedUser) {
    const item = await this.grades.setItemPostingPolicy(actor.id, itemId, dto.policy);
    return { itemId: item.id, policy: item.postingPolicy };
  }
  @Post(':itemId/publish')
  async publishItem(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: gradePublicationActionSchema }) dto: GradePublicationActionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.setItemPublication(actor.id, itemId, 'publish', dto.note);
  }
  @Post(':itemId/unpublish')
  async unpublishItem(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: gradePublicationActionSchema }) dto: GradePublicationActionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.setItemPublication(actor.id, itemId, 'unpublish', dto.note);
  }

  @Get(':itemId/users/:userId/history')
  async history(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    const item = await this.grades.getItem(itemId);
    if (actor.id !== userId) {
      await this.grades.getCourseActivityGrid(actor.id, item.courseId);
    }
    return this.grades.listHistory(itemId, userId);
  }
}

@ApiTags('grades')
@Controller({ path: 'grades', version: '1' })
export class GradeRecordsController {
  constructor(private readonly grades: GradesService) {}

  @Patch(':gradeId')
  async updateGrade(@Param('gradeId', { schema: uuidIdSchema }) gradeId: string, @Body({ schema: updateGradeSchema }) dto: UpdateGradeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.updateGrade(actor.id, gradeId, dto);
  }
}
