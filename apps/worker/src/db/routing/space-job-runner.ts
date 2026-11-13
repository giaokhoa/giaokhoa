import { Injectable } from '@nestjs/common';
import { tenantAls } from '../tenant-als';
import { SpaceRoutingError } from './space-connection-resolver';
import { SpaceDatabaseService } from './space-database.service';

@Injectable()
export class SpaceJobRunner {
  constructor(private readonly spaceDb: SpaceDatabaseService) {}

  async runForJob<T>(
    data: { spaceSlug?: string | null; spaceId?: string | null; tenantId?: string | null },
    fn: () => Promise<T>,
  ): Promise<T> {
    const slug = data.spaceSlug;
    if (!slug) {
      if (data.spaceSlug !== null || data.spaceId !== null) {
        throw new SpaceRoutingError('space_routing.job_scope_missing', 'Scoped job is missing its space slug');
      }
      return tenantAls.run({ platform: true }, async () => fn());
    }
    const target = await this.spaceDb.resolveTarget(slug);
    if (target.status !== 'active') {
      throw new SpaceRoutingError('space_routing.job_space_inactive', `Space ${slug} is not active for background work`);
    }
    if (data.spaceId && data.spaceId !== target.spaceId) {
      throw new SpaceRoutingError('space_routing.job_identity_mismatch', `Space identity changed for ${slug}`);
    }
    if (target.mode === 'dedicated') {
      if (!data.spaceId) {
        throw new SpaceRoutingError('space_routing.job_identity_missing', `Dedicated job ${slug} is missing its registry identity`);
      }
      return this.spaceDb.withSpaceKysely(slug, async () => {
        const prepared = await this.spaceDb.resolveTarget(slug);
        if (tenantAls.getStore()?.spaceId !== data.spaceId || prepared.spaceId !== data.spaceId
          || prepared.mode !== 'dedicated' || prepared.status !== 'active') {
          throw new SpaceRoutingError('space_routing.job_identity_mismatch', `Space identity changed for ${slug}`);
        }
        return fn();
      }, { tenantId: data.tenantId ?? undefined });
    }
    if (data.spaceId) {
      throw new SpaceRoutingError('space_routing.job_storage_changed', `Space ${slug} no longer uses its original store`);
    }
    return tenantAls.run({ platform: true }, async () => fn());
  }
}
