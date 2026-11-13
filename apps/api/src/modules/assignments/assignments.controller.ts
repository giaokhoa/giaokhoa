import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { AssignmentsService } from './assignments.service';
import {
  createAssignAnnotationSchema, createAssignFeedbackMessageSchema, createAssignmentSchema,
  createTeacherCommentBankEntrySchema, gradeAssignmentSubmissionSchema, releaseAssignmentGradesSchema,
  updateAssignAnnotationSchema, updateAssignmentSchema, upsertAssignRubricSchema,
  type CreateAssignAnnotationDto, type CreateAssignFeedbackMessageDto, type CreateAssignmentDto,
  type CreateTeacherCommentBankEntryDto, type GradeAssignmentSubmissionDto,
  type ReleaseAssignmentGradesDto, type UpdateAssignAnnotationDto, type UpdateAssignmentDto,
  type UpsertAssignRubricDto,
} from './dto/assignments.dto';

export const ASSIGN_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

@ApiTags('assignments')
@Controller({ path: 'courses/:courseId/assignments', version: '1' })
export class CourseAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post()
  async create(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createAssignmentSchema }) dto: CreateAssignmentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.createAssignment(actor.id, courseId, dto);
  }
  @Get()
  async list(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.listAssignments(actor.id, courseId);
  }
}

@ApiTags('assignments')
@Controller({ path: 'assignments', version: '1' })
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get(':id')
  async getForUser(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.getAssignmentForUser(actor.id, id);
  }
  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateAssignmentSchema }) dto: UpdateAssignmentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.updateAssignment(actor.id, id, dto);
  }
  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.assignments.deleteAssignment(actor.id, id);
    return { deleted: true };
  }

  @Post(':id/submission/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ASSIGN_UPLOAD_MAX_BYTES } }))
  async uploadFile(@Param('id', { schema: uuidIdSchema }) id: string, @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string }, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.uploadSubmissionFile(actor.id, id, {
      fileName: file.originalname, data: file.buffer, mimeType: file.mimetype,
    });
  }
  @Delete(':id/submission/files/:fileId')
  async removeFile(@Param('id', { schema: uuidIdSchema }) id: string, @Param('fileId', { schema: uuidIdSchema }) fileId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.assignments.removeSubmissionFile(actor.id, id, fileId);
    return { deleted: true };
  }
  @Post(':id/submission/submit')
  async submit(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.submitSubmission(actor.id, id);
  }
  @Post(':id/submission/reopen')
  async reopen(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.reopenSubmission(actor.id, id);
  }

  @Get(':id/submissions')
  async listSubmissions(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.listSubmissionsForTeacher(actor.id, id);
  }

  @Get(':id/results')
  async results(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.getResults(actor.id, id);
  }
  @Get(':id/submissions/:userId')
  async getSubmission(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.getSubmissionForTeacher(actor.id, id, userId);
  }
  @Post(':id/submissions/:userId/grade')
  async grade(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @Body({ schema: gradeAssignmentSubmissionSchema }) dto: GradeAssignmentSubmissionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.gradeSubmission(actor.id, id, userId, dto);
  }
  @Post(':id/submissions/:userId/release')
  async release(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.releaseSubmission(actor.id, id, userId);
  }
  @Post(':id/release-batch')
  async releaseBatch(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: releaseAssignmentGradesSchema }) dto: ReleaseAssignmentGradesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.releaseBatch(actor.id, id, dto.userIds);
  }

  @Get(':id/rubric')
  async getRubric(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return { rubric: await this.assignments.getRubric(actor.id, id) };
  }
  @Put(':id/rubric')
  async putRubric(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: upsertAssignRubricSchema }) dto: UpsertAssignRubricDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.upsertRubric(actor.id, id, dto);
  }

  @Get(':id/submissions/:userId/annotations')
  async listAnnotations(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.listAnnotationsForTeacher(actor.id, id, userId);
  }
  @Post(':id/submissions/:userId/annotations')
  async createAnnotation(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @Body({ schema: createAssignAnnotationSchema }) dto: CreateAssignAnnotationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.createAnnotation(actor.id, id, userId, dto);
  }
  @Patch(':id/submissions/:userId/annotations/:annotationId')
  async updateAnnotation(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @Param('annotationId', { schema: uuidIdSchema }) annotationId: string, @Body({ schema: updateAssignAnnotationSchema }) dto: UpdateAssignAnnotationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.updateAnnotation(actor.id, id, userId, annotationId, dto);
  }
  @Delete(':id/submissions/:userId/annotations/:annotationId')
  async deleteAnnotation(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @Param('annotationId', { schema: uuidIdSchema }) annotationId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.assignments.deleteAnnotation(actor.id, id, userId, annotationId);
    return { deleted: true };
  }

  @Get(':id/submissions/:userId/messages')
  async listMessages(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.listFeedbackMessages(actor.id, id, userId);
  }
  @Post(':id/submissions/:userId/messages')
  async postMessage(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @Body({ schema: createAssignFeedbackMessageSchema }) dto: CreateAssignFeedbackMessageDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.postFeedbackMessage(actor.id, id, userId, dto.body);
  }
}

@ApiTags('assignments')
@Controller({ path: 'assign-comment-bank', version: '1' })
export class AssignCommentBankController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.listMyCommentBank(actor.id);
  }
  @Post()
  async create(@Body({ schema: createTeacherCommentBankEntrySchema }) dto: CreateTeacherCommentBankEntryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.addCommentBankEntry(actor.id, dto);
  }
  @Delete(':entryId')
  async remove(@Param('entryId', { schema: uuidIdSchema }) entryId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.assignments.deleteCommentBankEntry(actor.id, entryId);
    return { deleted: true };
  }
}
