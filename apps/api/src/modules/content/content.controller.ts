import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { sendMaterialFile } from '../system-bank/system-materials.controller';
import { ContentService } from './content.service';
import {
  createLessonTemplateSchema, createPageSchema, createResourceSchema, recordProgressSchema,
  updatePageSchema, updateResourceSchema,
  type CreateLessonTemplateDto, type CreatePageDto, type CreateResourceDto, type RecordProgressDto, type UpdatePageDto, type UpdateResourceDto,
} from './dto/content.dto';

@ApiTags('content')
@Controller({ path: 'courses/:courseId/pages', version: '1' })
export class CoursePagesController {
  constructor(private readonly content: ContentService) {}

  @Post()
  async create(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createPageSchema }) dto: CreatePageDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.content.createPage(actor.id, courseId, dto);
  }
}

@ApiTags('content')
@Controller({ path: 'pages', version: '1' })
export class PagesController {
  constructor(private readonly content: ContentService) {}

  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.content.getPageForUser(viewer.id, id);
  }

  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updatePageSchema }) dto: UpdatePageDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.content.updatePage(actor.id, id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.content.deletePage(actor.id, id);
    return { deleted: true };
  }
}

@ApiTags('content')
@Controller({ path: 'courses/:courseId/resources', version: '1' })
export class CourseResourcesController {
  constructor(private readonly content: ContentService) {}

  @Post()
  async create(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createResourceSchema }) dto: CreateResourceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.content.createResource(actor.id, courseId, dto);
  }
}

@ApiTags('content')
@Controller({ path: 'resources', version: '1' })
export class ResourcesController {
  constructor(private readonly content: ContentService) {}

  @Get(':id/system-material/content')
  async systemMaterialContent(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() viewer: AuthenticatedUser, @Res() res: Response) {
    sendMaterialFile(res, await this.content.readSystemMaterialFile(viewer.id, id));
  }


  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.content.getResourceForUser(viewer.id, id);
  }

  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateResourceSchema }) dto: UpdateResourceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.content.updateResource(actor.id, id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.content.deleteResource(actor.id, id);
    return { deleted: true };
  }
}

@ApiTags('content')
@Controller({ path: 'courses/:courseId', version: '1' })
export class PlayerController {
  constructor(private readonly content: ContentService) {}

  @Get('player/:cmId')
  async player(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Param('cmId', { schema: uuidIdSchema }) cmId: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.content.getPlayer(viewer.id, courseId, cmId);
  }

  @Get('progress/me')
  async myProgress(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.content.getMyProgress(viewer.id, courseId);
  }

  @Get('progress/class-markers')
  async classMarkers(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.content.getClassMarkers(viewer.id, courseId);
  }

  @Post('modules/:cmId/progress')
  async recordProgress(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Param('cmId', { schema: uuidIdSchema }) cmId: string, @Body({ schema: recordProgressSchema }) dto: RecordProgressDto, @CurrentUser() viewer: AuthenticatedUser) {
    return this.content.recordProgress(viewer.id, courseId, cmId, dto);
  }

  @Get('progress/report')
  async progressReport(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Query('groupId', { schema: uuidIdSchema.optional() }) groupId: string | undefined, @CurrentUser() viewer: AuthenticatedUser) {
    return this.content.getProgressReport(viewer.id, courseId, groupId);
  }

  @Get('progress/reports')
  async progressReports(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Query('groupId', { schema: uuidIdSchema.optional() }) groupId: string | undefined, @Query('format', { schema: z.string().trim().min(1).optional() }) format: string | undefined, @CurrentUser() viewer: AuthenticatedUser, @Res() res: Response) {
    if (format !== undefined && format !== 'csv') {
      throw new BadRequestException({ message: `Unsupported progress report format: ${format}`, code: 'content.progress_report_format_unsupported' });
    }
    const csv = await this.content.getProgressReportCsv(viewer.id, courseId, groupId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="progress-report.csv"');
    res.send(csv);
  }

  @Get('progress/report.csv')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async progressReportCsv(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Query('groupId', { schema: uuidIdSchema.optional() }) groupId: string | undefined, @CurrentUser() viewer: AuthenticatedUser, @Res() res: Response) {
    return this.progressReports(courseId, groupId, 'csv', viewer, res);
  }

  @Post('lesson-template')
  async lessonTemplate(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createLessonTemplateSchema }) dto: CreateLessonTemplateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.content.createLessonTemplate(actor.id, courseId, dto);
  }
}
