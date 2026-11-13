import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { createCohortSchema, createGroupSchema, createGroupingSchema, groupMemberSchema, groupingGroupSchema, updateCohortSchema, updateGroupSchema, type CreateCohortDto, type CreateGroupDto, type CreateGroupingDto, type GroupingGroupDto, type MemberDto, type UpdateCohortDto, type UpdateGroupDto } from './dto/groups.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@Controller({ path: 'courses/:courseId/groups', version: '1' })
export class CourseGroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  async createGroup(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createGroupSchema }) dto: CreateGroupDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.createGroup(actor.id, courseId, dto);
  }
  @Get()
  async listGroups(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.listGroups(actor.id, courseId);
  }
  @Get('visible-members')
  async visibleMembers(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.listVisibleMembers(actor.id, courseId);
  }
  @Patch(':groupId')
  async updateGroup(@Param('groupId', { schema: uuidIdSchema }) groupId: string, @Body({ schema: updateGroupSchema }) dto: UpdateGroupDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.updateGroup(actor.id, groupId, dto);
  }
  @Delete(':groupId')
  async deleteGroup(@Param('groupId', { schema: uuidIdSchema }) groupId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.groups.deleteGroup(actor.id, groupId);
    return { deleted: true };
  }
  @Post(':groupId/members')
  async addMember(@Param('groupId', { schema: uuidIdSchema }) groupId: string, @Body({ schema: groupMemberSchema }) dto: MemberDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.groups.addMember(actor.id, groupId, dto.userId);
    return { added: true };
  }
  @Delete(':groupId/members/:userId')
  async removeMember(@Param('groupId', { schema: uuidIdSchema }) groupId: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.groups.removeMember(actor.id, groupId, userId);
    return { removed: true };
  }
  @Get(':groupId/members')
  async members(@Param('groupId', { schema: uuidIdSchema }) groupId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.listMembers(actor.id, groupId);
  }
}

@ApiTags('groups')
@Controller({ path: 'courses/:courseId/groupings', version: '1' })
export class CourseGroupingsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  async createGrouping(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @Body({ schema: createGroupingSchema }) dto: CreateGroupingDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.createGrouping(actor.id, courseId, dto);
  }
  @Get()
  async listGroupings(@Param('courseId', { schema: uuidIdSchema }) courseId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.listGroupings(courseId, actor.id);
  }
  @Post(':groupingId/groups')
  async addToGrouping(@Param('groupingId', { schema: uuidIdSchema }) groupingId: string, @Body({ schema: groupingGroupSchema }) dto: GroupingGroupDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.groups.addGroupToGrouping(actor.id, groupingId, dto.groupId);
    return { added: true };
  }
  @Get(':groupingId/groups')
  async groupingGroups(@Param('groupingId', { schema: uuidIdSchema }) groupingId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.groupsInGrouping(groupingId, actor.id);
  }
  @Delete(':groupingId')
  async deleteGrouping(@Param('groupingId', { schema: uuidIdSchema }) groupingId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.groups.deleteGrouping(actor.id, groupingId);
    return { deleted: true };
  }
}

@ApiTags('cohorts')
@Controller({ path: 'cohorts', version: '1' })
export class CohortsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  async create(@Body({ schema: createCohortSchema }) dto: CreateCohortDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.createCohort(actor.id, dto);
  }
  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) { return this.groups.listCohorts(actor.id); }
  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) { return this.groups.getCohort(id, actor.id); }
  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateCohortSchema }) dto: UpdateCohortDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.groups.updateCohort(actor.id, id, dto);
  }
  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.groups.deleteCohort(actor.id, id);
    return { deleted: true };
  }
  @Get(':id/members')
  async members(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) { return this.groups.listCohortMembers(id, actor.id); }
  @Post(':id/members')
  async addMember(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: groupMemberSchema }) dto: MemberDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.groups.addCohortMember(actor.id, id, dto.userId);
    return { added: true };
  }
  @Delete(':id/members/:userId')
  async removeMember(@Param('id', { schema: uuidIdSchema }) id: string, @Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.groups.removeCohortMember(actor.id, id, userId);
    return { removed: true };
  }
}
