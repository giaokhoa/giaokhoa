import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Res, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { GradesService } from './grades.service';
import { createGradeItemSchema, exportGradesVneduSchema, gradePublicationActionSchema, setGradePostingPolicySchema, setGradeSchema, updateGradeItemSchema, updateGradeSchema, type CreateGradeItemDto, type ExportGradesVneduDto, type GradePublicationActionDto, type SetGradeDto, type SetGradePostingPolicyDto, type UpdateGradeDto, type UpdateGradeItemDto } from './dto/grades.dto';

@ApiTags('grades')
@Controller({ path: 'courses/:courseId/grades', version: '1' })
@UseInterceptors(DeprecatedRouteAliasInterceptor)
export class LegacyGradesCourseController {
  constructor(private readonly grades: GradesService) {}

  @Post('items')
  @ApiOperation({ operationId: 'legacyGradesCreateItem' })
  async legacyCreateItem(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createGradeItemSchema }) dto: CreateGradeItemDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.createItem(actor.id, courseId, dto);
  }
  @Get('items')
  @ApiOperation({ operationId: 'legacyGradesListItems' })
  async legacyListItems(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.listItems(actor.id, courseId);
  }
  @Get('report')
  @ApiOperation({ operationId: 'legacyGradesReport' })
  async legacyReport(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.grades.getCourseActivityGrid(viewer.id, courseId);
  }

  @Post('export/vnedu')
  @HttpCode(200)
  @ApiOperation({ operationId: 'legacyGradesExportVnedu' })
  async legacyExportVnedu(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: exportGradesVneduSchema }) dto: ExportGradesVneduDto, @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    const { filename, buffer } = await this.grades.exportGradesVnedu(actor.id, courseId, dto);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}

@ApiTags('grades')
@Controller({ path: 'courses/grades', version: '1' })
@UseInterceptors(DeprecatedRouteAliasInterceptor)
export class LegacyGradesPhantomController {
  constructor(private readonly grades: GradesService) {}

  @Patch('items/:itemId')
  @ApiOperation({ operationId: 'legacyGradesUpdateItem' })
  async legacyUpdateItem(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: updateGradeItemSchema }) dto: UpdateGradeItemDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.updateItem(actor.id, itemId, dto);
  }
  @Delete('items/:itemId')
  @ApiOperation({ operationId: 'legacyGradesDeleteItem' })
  async legacyDeleteItem(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.grades.deleteItem(actor.id, itemId);
    return { deleted: true };
  }

  @Post('items/:itemId/grades')
  @ApiOperation({ operationId: 'legacyGradesSetGrade' })
  async legacySetGrade(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: setGradeSchema }) dto: SetGradeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.setGrade(actor.id, itemId, dto.userId, dto);
  }
  @Patch('grades/:gradeId')
  @ApiOperation({ operationId: 'legacyGradesUpdateGrade' })
  async legacyUpdateGrade(@Param('gradeId', { schema: uuidIdSchema }) gradeId: string, @Body({ schema: updateGradeSchema }) dto: UpdateGradeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.updateGrade(actor.id, gradeId, dto);
  }
  @Put('items/:itemId/posting-policy')
  @ApiOperation({ operationId: 'legacyGradesSetPostingPolicy' })
  async legacySetPostingPolicy(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: setGradePostingPolicySchema }) dto: SetGradePostingPolicyDto, @CurrentUser() actor: AuthenticatedUser) {
    const item = await this.grades.setItemPostingPolicy(actor.id, itemId, dto.policy);
    return { itemId: item.id, policy: item.postingPolicy };
  }
  @Post('items/:itemId/publish')
  @ApiOperation({ operationId: 'legacyGradesPublishItem' })
  async legacyPublishItem(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: gradePublicationActionSchema }) dto: GradePublicationActionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.setItemPublication(actor.id, itemId, 'publish', dto.note);
  }
  @Post('items/:itemId/unpublish')
  @ApiOperation({ operationId: 'legacyGradesUnpublishItem' })
  async legacyUnpublishItem(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Body({ schema: gradePublicationActionSchema }) dto: GradePublicationActionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.setItemPublication(actor.id, itemId, 'unpublish', dto.note);
  }

  @Get('items/:itemId/users/:userId/history')
  @ApiOperation({ operationId: 'legacyGradesHistory' })
  async legacyHistory(@Param('itemId', { schema: uuidIdSchema }) itemId: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    const item = await this.grades.getItem(itemId);
    if (actor.id !== userId) {
      await this.grades.getCourseActivityGrid(actor.id, item.courseId);
    }
    return this.grades.listHistory(itemId, userId);
  }
}
