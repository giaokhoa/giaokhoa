import { Body, Controller, Get, Param, Post, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { CompetenciesService } from './competencies.service';
import { addCompetencyEvidenceSchema, addTemplateCohortSchema, addTemplateCompetencySchema, competencyNoteSchema, competencyReviewDecisionSchema, createCompetencyFrameworkSchema, createCompetencySchema, createLearningPlanSchema, createLearningPlanTemplateSchema, frameworkExportSchema, gradeUserCompetencySchema, linkCompetencySchema, setCompetencyRuleSchema, type AddEvidenceDto, type AddTemplateCohortDto, type AddTemplateCompetencyDto, type CreateCompetencyDto, type CreateFrameworkDto, type CreatePlanDto, type CreateTemplateDto, type FrameworkExportDto, type GradeUsercompDto, type LinkCompetencyDto, type NoteDto, type ReviewDecisionDto, type SetCompetencyRuleDto } from './dto/competencies.dto';

@ApiTags('competencies')
@Controller({ path: 'competencies', version: '1' })
export class CompetenciesController {
  constructor(private readonly competencies: CompetenciesService) {}

  @Post('frameworks')
  async createFramework(@Body({ schema: createCompetencyFrameworkSchema }) dto: CreateFrameworkDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.createFramework(actor.id, dto);
  }
  @Get('frameworks')
  async listFrameworks() { return this.competencies.listFrameworks(); }
  @Get('frameworks/:id')
  async getFramework(@Param('id', { schema: uuidIdSchema }) id: string) { return this.competencies.getFramework(id); }
  @Post('frameworks/:id/competencies')
  async createCompetency(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: createCompetencySchema }) dto: CreateCompetencyDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.createCompetency(actor.id, id, dto);
  }
  @Get('frameworks/:id/competencies')
  async listCompetencies(@Param('id', { schema: uuidIdSchema }) id: string) { return this.competencies.listCompetencies(id); }
  @Get('frameworks/:id/export')
  async exportFramework(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.exportFramework(actor.id, id);
  }
  @Post('frameworks/import')
  async importFramework(@Body({ schema: frameworkExportSchema }) dto: FrameworkExportDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.importFramework(actor.id, dto);
  }
  @Post('frameworks/:id/copy')
  async copyFramework(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.duplicateFramework(actor.id, id);
  }
  @Post('frameworks/:id/duplicate')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async duplicateFramework(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.copyFramework(id, actor);
  }
  @Get('frameworks/:frameworkId/competencies/:competencyId/rule')
  async getCompetencyRule(@Param('competencyId', { schema: uuidIdSchema }) competencyId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.getCompetencyRuleFor(actor.id, competencyId);
  }
  @Post('frameworks/:frameworkId/competencies/:competencyId/rule')
  async setCompetencyRule(@Param('competencyId', { schema: uuidIdSchema }) competencyId: string, @Body({ schema: setCompetencyRuleSchema }) dto: SetCompetencyRuleDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.setCompetencyRule(actor.id, competencyId, dto);
  }

  @Post('courses/:courseId/links')
  async linkCourse(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: linkCompetencySchema }) dto: LinkCompetencyDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.linkCourseCompetency(actor.id, courseId, dto);
  }
  @Get('courses/:courseId/links')
  async courseLinks(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) { return this.competencies.listCourseCompetencies(actor.id, courseId); }
  @Post('modules/:cmId/links')
  async linkModule(@Param('cmId', { schema: uuidIdSchema }) cmId: string, @Body({ schema: linkCompetencySchema }) dto: LinkCompetencyDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.linkModuleCompetency(actor.id, cmId, dto);
  }
  @Get('modules/:cmId/links')
  async moduleLinks(@Param('cmId', { schema: uuidIdSchema }) cmId: string, @CurrentUser() actor: AuthenticatedUser) { return this.competencies.listModuleCompetencies(actor.id, cmId); }

  @Post('templates')
  async createTemplate(@Body({ schema: createLearningPlanTemplateSchema }) dto: CreateTemplateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.createTemplate(actor.id, dto);
  }
  @Get('templates')
  async listTemplates() { return this.competencies.listTemplates(); }
  @Post('templates/:id/competencies')
  async addTemplateCompetency(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: addTemplateCompetencySchema }) dto: AddTemplateCompetencyDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.addTemplateCompetency(actor.id, id, dto.competencyId);
  }
  @Post('templates/:id/cohorts')
  async addTemplateCohort(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: addTemplateCohortSchema }) dto: AddTemplateCohortDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.addTemplateCohort(actor.id, id, dto.cohortId);
  }
  @Post('templates/:id/create-plans')
  async createPlans(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.createPlansFromTemplate(actor.id, id);
  }

  @Post('plans')
  async createPlan(@Body({ schema: createLearningPlanSchema }) dto: CreatePlanDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.createPlan(actor.id, dto);
  }
  @Get('plans/user/:userId')
  async plansForUser(@Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.listPlansForUser(actor.id, userId);
  }
  @Get('plans/:id')
  async planView(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.getPlanView(actor.id, id);
  }
  @Post('plans/:id/activate')
  async activate(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.activatePlan(actor.id, id);
  }
  @Post('plans/:id/request-review')
  async requestReview(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.requestPlanReview(actor.id, id);
  }
  @Post('plans/:id/cancel-review')
  async cancelReview(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.cancelPlanReview(actor.id, id);
  }
  @Post('plans/:id/start-review')
  async startReview(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.startPlanReview(actor.id, id);
  }
  @Post('plans/:id/stop-review')
  async stopReview(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.stopPlanReview(actor.id, id);
  }
  @Post('plans/:id/approve')
  async approve(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.approvePlan(actor.id, id);
  }
  @Post('plans/:id/unapprove')
  async unapprove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.unapprovePlan(actor.id, id);
  }
  @Post('plans/:id/complete')
  async complete(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.completePlan(actor.id, id);
  }

  @Post('evidence')
  async addEvidence(@Body({ schema: addCompetencyEvidenceSchema }) dto: AddEvidenceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.addEvidence(actor.id, dto);
  }
  @Get('usercomp/user/:userId')
  async usercomps(@Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.listUsercompsForUserFor(actor.id, userId);
  }
  @Get('usercomp/:id/evidence')
  async evidence(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.listEvidenceFor(actor.id, id);
  }
  @Post('usercomp/grade')
  async grade(@Body({ schema: gradeUserCompetencySchema }) dto: GradeUsercompDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.gradeUsercomp(actor.id, dto);
  }
  @Post('usercomp/:id/request-review')
  async requestUcReview(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.requestUsercompReview(actor.id, id);
  }
  @Post('usercomp/:id/start-review')
  async startUcReview(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.startUsercompReview(actor.id, id);
  }
  @Post('usercomp/:id/approve')
  async approveUcReview(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: competencyReviewDecisionSchema }) dto: ReviewDecisionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.approveUsercompReview(actor.id, id, dto.grade, dto.note);
  }
  @Post('usercomp/:id/reject')
  async rejectUcReview(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: competencyNoteSchema }) dto: NoteDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.competencies.rejectUsercompReview(actor.id, id, dto.note);
  }
}
