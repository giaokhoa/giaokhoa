import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { BadgesService } from './badges.service';
import { badgeUserSchema, createBadgeSchema, setBadgeCriteriaSchema, setBadgeStatusSchema, updateBadgeSchema, type CreateBadgeDto, type EvaluateDto, type ManualAwardDto, type SetCriteriaDto, type SetStatusDto, type UpdateBadgeDto } from './dto/badges.dto';

@ApiTags('badges')
@Controller({ path: 'badges', version: '1' })
export class BadgesController {
  constructor(private readonly badges: BadgesService) {}

  @Post()
  async create(@Body({ schema: createBadgeSchema }) dto: CreateBadgeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.createBadge(actor.id, dto);
  }
  @Get()
  async list() { return this.badges.listBadges(); }
  @Get('mine')
  async mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.badges.listMyBadges(actor.id);
  }
  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string) { return this.badges.getBadge(id); }
  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateBadgeSchema }) dto: UpdateBadgeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.updateBadge(actor.id, id, dto);
  }
  @Delete(':id')
  async archive(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.archiveBadge(actor.id, id);
  }
  @Post(':id/status')
  async setStatus(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: setBadgeStatusSchema }) dto: SetStatusDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.setStatus(actor.id, id, dto.status);
  }
  @Post(':id/copy')
  async copy(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.duplicateBadge(actor.id, id);
  }
  @Post(':id/duplicate')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async duplicate(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.copy(id, actor);
  }
  @Get(':id/criteria')
  async criteria(@Param('id', { schema: uuidIdSchema }) id: string) { return this.badges.getCriteria(id); }
  @Put(':id/criteria')
  async setCriteria(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: setBadgeCriteriaSchema }) dto: SetCriteriaDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.setCriteria(actor.id, id, dto);
  }
  @Post(':id/award')
  async award(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: badgeUserSchema }) dto: ManualAwardDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.manualAward(actor.id, id, dto.userId);
  }
  @Get(':id/issued')
  async issued(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.listIssuedForBadge(actor.id, id);
  }
  @Post(':id/evaluate')
  async evaluate(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: badgeUserSchema }) dto: EvaluateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.evaluateBadgeFor(actor.id, id, dto.userId);
  }
  @Post('evaluate-user')
  async evaluateUser(@Body({ schema: badgeUserSchema }) dto: EvaluateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.evaluateUserBadgesFor(actor.id, dto.userId);
  }
  @Get('issued/:issuedId')
  async getIssued(@Param('issuedId', { schema: uuidIdSchema }) issuedId: string) {
    return this.badges.getIssued(issuedId);
  }
  @Post('issued/:issuedId/revoke')
  async revoke(@Param('issuedId', { schema: uuidIdSchema }) issuedId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.badges.revokeIssued(actor.id, issuedId);
  }
}
