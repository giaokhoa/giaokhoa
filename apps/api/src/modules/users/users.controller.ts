import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { RequireCapability } from '../../common/require-capability.decorator';
import { createUserSchema, listUsersQueryServerSchema, setUserPreferenceSchema, updateUserSchema, type CreateUserDto, type ListUsersQueryDto, type SetPreferenceDto, type UpdateUserDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @RequireCapability('user:create')
  async create(@Body({ schema: createUserSchema }) dto: CreateUserDto) {
    const user = await this.users.createUser(dto);
    return { id: user.id, username: user.username, email: user.email, firstName: user.firstName, lastName: user.lastName };
  }

  @Get()
  @RequireCapability('user:viewdetails')
  async list(@Query({ schema: listUsersQueryServerSchema }) query: ListUsersQueryDto, @CurrentUser() viewer: AuthenticatedUser) {
    const result = await this.users.listUsers(query.search, query.page ?? 1, query.pageSize ?? 20, {
      status: query.status,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
    });
    const views = await this.users.getProfileViews(result.users, viewer.id);
    return { users: views, total: result.total, page: result.page, pageSize: result.pageSize };
  }

  @Get('me')
  async me(@CurrentUser() viewer: AuthenticatedUser) { return this.users.getProfileView(viewer.id, viewer.id); }

  @Get('me/capabilities')
  async myCapabilities(@CurrentUser() viewer: AuthenticatedUser) {
    return this.users.getMyAccess(viewer.id, { isGuest: viewer.username === 'guest' });
  }

  @Get(':id')
  @RequireCapability('user:viewdetails', 'param:userId:userctx')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.users.getProfileView(id, viewer.id);
  }

  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateUserSchema }) dto: UpdateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.users.assertCanUpdateProfile(actor.id, id);
    const user = await this.users.updateUser(id, dto, actor.id);
    return this.users.getProfileView(user.id, actor.id);
  }

  @Post(':id/suspend')
  @RequireCapability('user:update')
  async suspend(@Param('id', { schema: uuidIdSchema }) id: string) {
    const user = await this.users.setSuspended(id, true);
    return { id: user.id, suspended: user.suspended };
  }
  @Post(':id/reactivate')
  @RequireCapability('user:update')
  async reactivate(@Param('id', { schema: uuidIdSchema }) id: string) {
    const user = await this.users.setSuspended(id, false);
    return { id: user.id, suspended: user.suspended };
  }
  @Post(':id/unsuspend')
  @RequireCapability('user:update')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async unsuspend(@Param('id', { schema: uuidIdSchema }) id: string) {
    return this.reactivate(id);
  }
  @Delete(':id')
  @RequireCapability('user:delete')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string) {
    const user = await this.users.deleteUser(id);
    return { id: user.id, deleted: user.deleted };
  }

  @Put(':id/preferences')
  async setPreference(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: setUserPreferenceSchema }) dto: SetPreferenceDto, @CurrentUser() actor: AuthenticatedUser) {
    await this.users.assertCanUpdateProfile(actor.id, id);
    await this.users.setPreference(id, dto.name, dto.value ?? null);
    return { saved: true };
  }
  @Get(':id/preferences/:name')
  async getPreference(@Param('id', { schema: uuidIdSchema }) id: string, @Param('name') name: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.users.assertCanUpdateProfile(actor.id, id);
    return { name, value: (await this.users.getPreference(id, name)) ?? null };
  }
}
