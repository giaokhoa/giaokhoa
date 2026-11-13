import { isPublicLearningHost, PUBLIC_LEARNING_SLUG } from './public-learning';
import type { SpaceDatabaseService } from '../../db/routing/space-database.service';
import type { ResolvedSpaceConnection } from '../../db/routing/space-connection-resolver';


export const SPACE_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function extractSpaceSlugFromHost(host: string | undefined | null): string | null {
  if (!host) return null;
  const hostname = host.trim().toLowerCase().split(':')[0] ?? '';
  if (!hostname) return null;
  const labels = hostname.split('.');
  if (labels.length < 3) return null;
  const candidate = labels[0] ?? '';
  if (!SPACE_LABEL_PATTERN.test(candidate)) return null;
  if (/^\d+$/.test(candidate) && labels.every((label) => /^\d+$/.test(label))) return null;
  return candidate;
}

export function spaceSlugForHost(host: string | string[] | undefined): string | null {
  if (isPublicLearningHost(host)) return PUBLIC_LEARNING_SLUG;
  return extractSpaceSlugFromHost(Array.isArray(host) ? host[0] : host);
}

export interface DedicatedSpace {
  slug: string;
  spaceId: string;
}

export async function resolveDedicatedSpace(
  spaceDb: Pick<SpaceDatabaseService, 'resolveTarget'>,
  host: string | string[] | undefined,
): Promise<DedicatedSpace | null> {
  const slug = spaceSlugForHost(host);
  if (!slug) return null;
  const target: ResolvedSpaceConnection = await spaceDb.resolveTarget(slug);
  if (target.mode !== 'dedicated') {
    if (slug === PUBLIC_LEARNING_SLUG && isPublicLearningHost(host)) {
      throw new Error('public_learning.dedicated_required: public host cannot use the shared database');
    }
    return null;
  }
  return { slug, spaceId: target.spaceId };
}
