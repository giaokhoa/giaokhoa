import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { ClassesService } from './classes.service';
import {
  addClassRosterMemberSchema,
  createClassSchema,
  importClassRosterSchema,
  joinClassByCodeSchema,
  rosterStudentIdentitySchema,
  setClassStaffRolesSchema,
  updateClassSchema,
  type AddClassRosterMemberDto,
  type CreateClassDto,
  type ImportClassRosterDto,
  type JoinClassByCodeDto,
  type RosterStudentIdentityDto,
  type SetClassStaffRolesDto,
  type UpdateClassDto,
} from './dto/classes.dto';

const ROSTER_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

@ApiTags('classes')
@Controller({ path: 'classes', version: '1' })
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Post()
  async create(@Body({ schema: createClassSchema }) dto: CreateClassDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.createClass(actor.id, dto);
  }

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return this.classes.listClasses(actor.id);
  }

  @Get('roster-template')
  async rosterTemplate(@Res() res: Response) {
    const { filename, buffer } = await this.classes.buildRosterTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('join-preview')
  async joinPreview(@Query('code', { schema: z.string().trim().min(1) }) code: string) {
    return this.classes.previewJoin(code);
  }

  @Post('join')
  async join(@Body({ schema: joinClassByCodeSchema }) dto: JoinClassByCodeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.joinByCode(actor.id, dto.joinCode);
  }

  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.getClass(actor.id, id);
  }

  @Get(':id/overview')
  async overview(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.getClassOverview(actor.id, id);
  }

  @Get(':id/public')
  async publicView(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.getClassPublic(actor.id, id);
  }

  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateClassSchema }) dto: UpdateClassDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.updateClass(actor.id, id, dto);
  }

  @Post(':id/archive')
  async archive(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.archiveClass(actor.id, id);
  }

  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.classes.deleteClass(actor.id, id);
    return { deleted: true };
  }

  @Get(':id/roster')
  async roster(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.listRoster(actor.id, id);
  }

  @Post(':id/roster')
  async addToRoster(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: addClassRosterMemberSchema }) dto: AddClassRosterMemberDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.classes.addToRoster(actor.id, id, dto.userId);
    return { added: true };
  }

  @Post(':id/roster/identity')
  async addToRosterByIdentity(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: rosterStudentIdentitySchema }) dto: RosterStudentIdentityDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.addRosterStudentByIdentity(actor.id, id, dto);
  }

  @Post(':id/roster/import')
  async importRoster(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: importClassRosterSchema }) dto: ImportClassRosterDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.importRoster(actor.id, id, dto.rows);
  }

  @Post(':id/roster/import-file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ROSTER_UPLOAD_MAX_BYTES } }))
  async importRosterFile(@Param('id', { schema: uuidIdSchema }) id: string, @UploadedFile() file: { buffer: Buffer } | undefined, @CurrentUser() actor: AuthenticatedUser) {
    if (!file) {
      throw new BadRequestException({ message: 'An .xlsx file is required in the multipart field "file"', code: 'class.import_file_required' });
    }
    const rows = await this.classes.parseRosterWorkbook(file.buffer);
    return this.classes.importRoster(actor.id, id, rows);
  }

  @Delete(':id/roster/:userId')
  async removeFromRoster(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.classes.removeFromRoster(actor.id, id, userId);
    return { removed: true };
  }

  @Get(':id/roster/suspended')
  async suspendedMembers(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.listSuspendedMembers(actor.id, id);
  }

  @Get(':id/courses')
  async courses(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.listClassCourses(actor.id, id);
  }

  @Get(':id/staff')
  async staff(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.listStaff(actor.id, id);
  }

  @Post(':id/staff')
  async setStaff(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: setClassStaffRolesSchema }) dto: SetClassStaffRolesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.setStaffRoles(actor.id, id, dto);
  }

  @Get(':id/join-requests')
  async joinRequests(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.listJoinRequests(actor.id, id);
  }

  @Post(':id/join-requests/:requestId/approve')
  async approveJoinRequest(@Param('id', { schema: uuidIdSchema }) id: string, @Param('requestId', { schema: uuidIdSchema }) requestId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.decideJoinRequest(actor.id, id, requestId, true);
  }

  @Post(':id/join-requests/:requestId/reject')
  async rejectJoinRequest(@Param('id', { schema: uuidIdSchema }) id: string, @Param('requestId', { schema: uuidIdSchema }) requestId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.decideJoinRequest(actor.id, id, requestId, false);
  }
}
