import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { CentreIdentityService } from './centre-identity.service';
import { activateCentreInviteSchema, updateCentreIdentitySchema, type ActivateCentreInviteDto, type UpdateCentreIdentityDto } from './dto/centres.dto';
import { SkipSpaceContext } from './skip-space-context.decorator';

@ApiTags('centres')
@Controller({ path: 'centres', version: '1' })
export class CentreIdentityController {
  constructor(private readonly centres: CentreIdentityService) {}

  @Public()
  @SkipSpaceContext()
  @Get(':slug/identity')
  async getIdentity(@Param('slug', { schema: z.string().trim().min(1).max(63) }) slug: string, @Headers('host') host: string | undefined) {
    this.centres.assertRequestAddress(slug, host);
    return this.centres.getIdentity(slug);
  }

  @Patch(':slug/identity')
  async updateIdentity(
    @Param('slug', { schema: z.string().trim().min(1).max(63) }) slug: string,
    @Headers('host') host: string | undefined,
    @Body({ schema: updateCentreIdentitySchema }) dto: UpdateCentreIdentityDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    this.centres.assertRequestAddress(slug, host);
    return this.centres.updateIdentity(slug, actor.id, dto);
  }

  @Public()
  @SkipSpaceContext()
  @Post('activate-invite')
  async activateInvite(@Body({ schema: activateCentreInviteSchema }) dto: ActivateCentreInviteDto, @Headers('host') host: string | undefined) {
    this.centres.assertRequestAddress(dto.slug, host);
    return this.centres.activateInvite(dto);
  }
}
