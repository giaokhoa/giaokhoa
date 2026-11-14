import { GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound } from '../../common/http-errors';
import { hashCentreInviteToken } from './centre-provision';
import { SpaceRoutingError } from '../../db/routing/space-connection-resolver';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import type { ActivateCentreInviteDto, UpdateCentreIdentityDto } from './dto/centres.dto';
import { UsersService } from '../users/users.service';
import { CentreIdentityRepository } from '@giaokhoa/db/repositories/centre-identity';
import { extractSpaceSlugFromHost } from './space-resolution';
import { tenantAls } from './tenant-als';
import { TenantsRepository } from '@giaokhoa/db/repositories/tenants';

@Injectable()
export class CentreIdentityService {
  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    private readonly tenants: TenantsRepository,
    private readonly centreRepo: CentreIdentityRepository,
    private readonly users: UsersService,
  ) {}

  assertRequestAddress(slug: string, hostHeader: string | string[] | undefined) {
    const addressSlug = extractSpaceSlugFromHost(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader);
    if (addressSlug && addressSlug !== slug) {
      badRequest('Request address does not match the requested centre', 'centre.address_mismatch');
    }
  }

  async getIdentity(slug: string) {
    const binding = this.spaceDb.isSpacePrepared(slug)
      ? this.spaceDb.preparedSpaceScope(slug)
      : await this.bindCentreSpace(slug, false);
    return this.runInCentreSpace(slug, async () => {
      const tenant = await this.tenants.getTenantBySlug(slug);
      if (!tenant) notFound('Centre not found', 'centre.not_found');
      const identity = await this.centreRepo.getIdentity(tenant.id);
      return {
        tenantId: tenant.id,
        displayName: identity?.displayName ?? tenant.name,
        logoPath: identity?.logoPath ?? null,
        brandColor: identity?.brandColor ?? null,
      };
    }, binding);
  }

  async updateIdentity(slug: string, actorId: string, dto: UpdateCentreIdentityDto) {
    const binding = await this.bindCentreSpace(slug, true);
    return this.runInCentreSpace(slug, async () => {
      const tenant = await this.tenants.getTenantBySlug(slug);
      if (!tenant) notFound('Centre not found', 'centre.not_found');
      const admins = await this.centreRepo.listSiteAdmins();
      if (!admins.includes(actorId)) {
        forbidden('Only an admin of this centre may change its identity', 'centre.not_admin');
      }
      const row = await this.centreRepo.upsertIdentity(tenant.id, dto);
      return { tenantId: tenant.id, displayName: row.displayName, logoPath: row.logoPath, brandColor: row.brandColor };
    }, binding);
  }

  async activateInvite(dto: ActivateCentreInviteDto) {
    const binding = await this.bindCentreSpace(dto.slug, true);
    const invite = await this.runInCentreSpace(dto.slug, async () => {
      const tenant = await this.tenants.getTenantBySlug(dto.slug);
      if (!tenant) notFound('Centre not found', 'centre.not_found');
      const found = await this.centreRepo.findInviteByTokenHash(hashCentreInviteToken(dto.token));
      if (!found) notFound('Invite not found', 'centre.invite_not_found');
      if (found.expiresAt <= new Date()) throw new GoneException({ message: 'Invite has expired', code: 'centre.invite_expired' });
      if (found.usedAt) conflict('Invite has already been used', 'centre.invite_consumed');
      if (found.revokedAt) conflict('Invite has been revoked', 'centre.invite_revoked');
      const marked = await this.centreRepo.markInviteUsed(found.id);
      if (!marked) conflict('Invite has already been used', 'centre.invite_consumed');
      return found;
    }, binding);
    await this.runInCentreSpace(dto.slug, async () => {
      await this.users.updateUser(invite.userId, { password: dto.password });
    }, binding);
    return { activated: true as const, userId: invite.userId };
  }

  private async bindCentreSpace(
    slug: string, requireActive: boolean,
  ): Promise<ReturnType<SpaceDatabaseService['preparedSpaceScope']>> {
    let target;
    try {
      target = await this.spaceDb.resolveTarget(slug);
    } catch (err) {
      throw this.mapRoutingError(err);
    }
    if (requireActive && target.status !== 'active') {
      forbidden('Centre is not active', 'space.not_active');
    }
    try {
      const db = await this.spaceDb.getKyselyForSpace(slug);
      const binding = this.spaceDb.preparedSpaceScope(slug, db);
      if ((target.mode === 'dedicated' && binding.spaceId !== target.spaceId)
        || (target.mode === 'shared' && !!binding.spaceId)) {
        throw new SpaceRoutingError('space_routing.prepared_identity_mismatch', `Space ${slug} changed during preparation`);
      }
      return binding;
    } catch (err) {
      throw this.mapRoutingError(err);
    }
  }

  private runInCentreSpace<T>(
    slug: string, fn: () => Promise<T>,
    binding: ReturnType<SpaceDatabaseService['preparedSpaceScope']>,
  ): Promise<T> {
    return tenantAls.run({ platform: true, spaceSlug: slug, ...binding }, async () => fn());
  }

  private mapRoutingError(err: unknown): Error {
    if (err instanceof SpaceRoutingError) {
      if (err.code === 'space_routing.space_not_found') {
        return new NotFoundException({ message: 'Centre not found', code: 'centre.not_found' });
      }
      if (err.code === 'space_routing.not_configured') {
        return new ServiceUnavailableException({ message: 'Control plane is not configured', code: 'control_plane.not_configured' });
      }
    }
    return err instanceof Error ? err : new Error('Unknown routing error');
  }
}
