import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { GradesService } from './grades.service';
import { createGradeItemSchema, exportGradesSchema, type CreateGradeItemDto, type ExportGradesDto } from './dto/grades.dto';

@ApiTags('grades')
@Controller({ path: 'courses/:courseId/grade-items', version: '1' })
export class CourseGradeItemsController {
  constructor(private readonly grades: GradesService) {}

  @Post()
  async createItem(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createGradeItemSchema }) dto: CreateGradeItemDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.createItem(actor.id, courseId, dto);
  }
  @Get()
  async listItems(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.grades.listItems(actor.id, courseId);
  }
}

@ApiTags('grades')
@Controller({ path: 'courses/:courseId/gradebook', version: '1' })
export class CourseGradebookController {
  constructor(private readonly grades: GradesService) {}

  @Get()
  async gradebook(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Query('userId') userId: string | undefined, @CurrentUser() viewer: AuthenticatedUser) {
    const target = userId || viewer.id;
    return this.grades.listUserActivityGrades(viewer.id, courseId, target);
  }
  @Get('report')
  async report(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.grades.getCourseActivityGrid(viewer.id, courseId);
  }
}

@ApiTags('grades')
@Controller({ path: 'courses/:courseId/grade-exports', version: '1' })
export class CourseGradeExportsController {
  constructor(private readonly grades: GradesService) {}

  @Post()
  @HttpCode(200)
  async exportGrades(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: exportGradesSchema }) dto: ExportGradesDto, @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    const { provider: _provider, ...rest } = dto;
    const { filename, buffer } = await this.grades.exportGradesVnedu(actor.id, courseId, rest);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
