import { Injectable } from '@nestjs/common';
import { type CentreDb } from '@giaokhoa/db';
import { SharedDomainError } from '@giaokhoa/enrol';
import { tenantAls } from './db/tenant-als';
import {
  SpaceRoutingError,
  type ResolvedSpaceConnection,
} from './db/routing/space-connection-resolver';
import { SpaceDatabaseService } from './db/routing/space-database.service';

@Injectable()
export class WorkerPaymentSpaceScope {
  constructor(private readonly spaceDatabase: SpaceDatabaseService) {}

  get routedKysely(): CentreDb {
    return this.spaceDatabase.routedKysely;
  }

  async runForTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const activeSlug = tenantAls.getStore()?.spaceSlug;
    if (activeSlug) {
      const tenant = await this.spaceDatabase.routedKysely.selectFrom('tenants')
        .select('id').where('id', '=', tenantId).executeTakeFirst();
      if (!tenant) {
        throw new SharedDomainError('tenant.not_found', `Tenant ${tenantId} is not in the pinned space ${activeSlug}`);
      }
      return this.spaceDatabase.withSpaceKysely(activeSlug, async () => fn(), { tenantId });
    }
    const slug = await this.slugForTenant(tenantId);
    let target: ResolvedSpaceConnection;
    try {
      target = await this.spaceDatabase.resolveTarget(slug);
    } catch (err) {
      if (err instanceof SpaceRoutingError && err.code === 'space_routing.not_configured'
        && slug === 'trang-chinh') {
        return tenantAls.run({ platform: true }, async () => fn());
      }
      throw err;
    }
    if (target.mode === 'dedicated') {
      return this.spaceDatabase.withSpaceKysely(slug, async () => fn());
    }
    if (slug !== 'trang-chinh') {
      throw new SpaceRoutingError('space_routing.shared_not_supported', `No shared payment scope for learning space ${slug}`);
    }
    return tenantAls.run({ platform: true }, async () => fn());
  }

  private async slugForTenant(tenantId: string): Promise<string> {
    const row = await tenantAls.run({ platform: true }, async () =>
      this.spaceDatabase.routedKysely
        .selectFrom('tenants')
        .select('slug')
        .where('id', '=', tenantId)
        .executeTakeFirst(),
    );
    if (!row) {
      throw new SharedDomainError(
        'tenant.not_found',
        `Tenant ${tenantId} not found in the shared directory`,
      );
    }
    return row.slug;
  }
}
