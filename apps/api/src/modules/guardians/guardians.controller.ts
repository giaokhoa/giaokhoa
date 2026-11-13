import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { createGuardianLinkSchema, guardianDigestPreferenceSchema, type CreateGuardianLinkDto, type GuardianDigestPreferenceDto } from './dto/guardians.dto';
import { GuardianDigestService } from './guardian-digest.service';
import { GuardianViewService } from './guardian-view.service';
import { GuardiansService } from './guardians.service';

@ApiTags('guardians')
@Controller({ path: 'guardian-links', version: '1' })
export class GuardianLinksController {
  constructor(private readonly guardians: GuardiansService) {}

  @Post()
  async create(@Body({ schema: createGuardianLinkSchema }) dto: CreateGuardianLinkDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.guardians.createLink(actor.id, dto);
  }

  @Get()
  async list(@Query('guardianUserId') guardianUserId: string | undefined, @Query('studentUserId') studentUserId: string | undefined, @Query('status') status: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.guardians.listLinks(actor.id, { guardianUserId, studentUserId, status });
  }

  @Get('mine/students')
  async myStudents(@CurrentUser() actor: AuthenticatedUser) {
    return this.guardians.myStudents(actor.id);
  }

  @Get('mine/guardians')
  async myGuardians(@CurrentUser() actor: AuthenticatedUser) {
    return this.guardians.myGuardians(actor.id);
  }

  @Delete(':linkId')
  async revoke(@Param('linkId', { schema: uuidIdSchema }) linkId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.guardians.revokeLink(actor.id, linkId);
  }
}

@ApiTags('guardians')
@Controller({ path: 'guardian', version: '1' })
export class GuardianController {
  constructor(
    private readonly guardians: GuardiansService,
    private readonly view: GuardianViewService,
    private readonly digests: GuardianDigestService,
  ) {}

  @Get('students/:studentId/gradebooks/:courseId')
  async gradebook(@Param('studentId', { schema: uuidIdSchema }) studentId: string, @Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.guardians.studentGradebook(actor.id, studentId, courseId);
  }

  @Get('students/:studentId/courses/:courseId/gradebook')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async legacyGradebook(@Param('studentId', { schema: uuidIdSchema }) studentId: string, @Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.guardians.studentGradebook(actor.id, studentId, courseId);
  }

  @Get('students/:studentId/overview')
  async overview(@Param('studentId', { schema: uuidIdSchema }) studentId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.view.overview(actor.id, studentId);
  }

  @Get('students/:studentId/results')
  async results(@Param('studentId', { schema: uuidIdSchema }) studentId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.view.results(actor.id, studentId);
  }

  @Get('students/:studentId/digest-preference')
  async digestPreference(@Param('studentId', { schema: uuidIdSchema }) studentId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.digests.getPreference(actor.id, studentId);
  }

  @Put('students/:studentId/digest-preference')
  async setDigestPreference(@Param('studentId', { schema: uuidIdSchema }) studentId: string, @Body({ schema: guardianDigestPreferenceSchema }) dto: GuardianDigestPreferenceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.digests.setPreference(actor.id, studentId, dto.frequency);
  }
}
