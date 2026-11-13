import { onSpaceRegistryChanged } from './space-routing-events';


export interface SpaceRegistryEntry {
  id: string;
  slug: string;
  status: string;
  databaseName: string;
  storageMode: string;
  connectionRoleRef: string;
  secretRef: string | null;
  schemaVersion: string | null;
}

export type SpaceRegistryReader = (slug: string) => Promise<SpaceRegistryEntry | undefined>;

export interface ResolvedSpaceConnection {
  slug: string;
  spaceId: string;
  status: string;
  schemaVersion: string | null;
  databaseName: string;
  mode: 'shared' | 'dedicated';
  connectionRole: string;
  connectionString?: string;
}

export class SpaceRoutingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SpaceRoutingError';
  }
}

export interface SpaceConnectionResolverDeps {
  readRegistry: SpaceRegistryReader;
  cacheTtlMs: number;
  resolveSecretRef?: (secretRef: string) => string | undefined;
}

function defaultResolveSecretRef(secretRef: string): string | undefined {
  if (!secretRef.startsWith('env:')) return undefined;
  const name = secretRef.slice('env:'.length);
  return name ? process.env[name] : undefined;
}

interface CacheEntry {
  target: ResolvedSpaceConnection;
  expiresAt: number;
}

export class SpaceConnectionResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly invalidationGenerations = new Map<string, number>();
  private readonly resolveSecretRef: (secretRef: string) => string | undefined;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: SpaceConnectionResolverDeps) {
    this.resolveSecretRef = deps.resolveSecretRef ?? defaultResolveSecretRef;
    this.unsubscribe = onSpaceRegistryChanged((slug) => this.invalidate(slug));
  }

  dispose(): void {
    this.unsubscribe();
  }

  invalidate(slug?: string): void {
    if (slug) {
      this.cache.delete(slug);
      this.invalidationGenerations.set(slug, this.generationOf(slug) + 1);
      return;
    }
    this.cache.clear();
    for (const [knownSlug, generation] of this.invalidationGenerations) {
      this.invalidationGenerations.set(knownSlug, generation + 1);
    }
  }

  private generationOf(slug: string): number {
    return this.invalidationGenerations.get(slug) ?? 0;
  }

  async resolve(slug: string): Promise<ResolvedSpaceConnection> {
    const cached = this.cache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.target;
    if (!this.invalidationGenerations.has(slug)) this.invalidationGenerations.set(slug, 0);
    for (;;) {
      const generation = this.generationOf(slug);
      const entry = await this.deps.readRegistry(slug);
      if (this.generationOf(slug) !== generation) continue;
      if (!entry) {
        throw new SpaceRoutingError('space_routing.space_not_found', `Space slug ${slug} is not registered`);
      }
      const target = this.toTarget(entry);
      this.cache.set(slug, { target, expiresAt: Date.now() + this.deps.cacheTtlMs });
      return target;
    }
  }

  private toTarget(entry: SpaceRegistryEntry): ResolvedSpaceConnection {
    const base = {
      slug: entry.slug,
      spaceId: entry.id,
      status: entry.status,
      schemaVersion: entry.schemaVersion,
      databaseName: entry.databaseName,
      connectionRole: entry.connectionRoleRef,
    };
    if (entry.storageMode === 'shared') {
      return { ...base, mode: 'shared' };
    }
    if (entry.storageMode !== 'dedicated') {
      throw new SpaceRoutingError(
        'space_routing.storage_mode_unknown',
        `Space ${entry.slug} has unknown storage mode ${entry.storageMode}`,
      );
    }
    if (!entry.secretRef) {
      throw new SpaceRoutingError(
        'space_routing.secret_missing',
        `Space ${entry.slug} is dedicated but has no connection secret reference`,
      );
    }
    const rawConnection = this.resolveSecretRef(entry.secretRef);
    if (!rawConnection) {
      throw new SpaceRoutingError(
        'space_routing.secret_missing',
        `Connection secret for space ${entry.slug} is not configured`,
      );
    }
    let url: URL;
    try {
      url = new URL(rawConnection);
    } catch {
      throw new SpaceRoutingError(
        'space_routing.secret_invalid',
        `Connection secret for space ${entry.slug} is not a valid connection URL`,
      );
    }
    const role = decodeURIComponent(url.username);
    if (role !== entry.connectionRoleRef) {
      throw new SpaceRoutingError(
        'space_routing.role_mismatch',
        `Connection role for space ${entry.slug} does not match the registered role`,
      );
    }
    url.pathname = `/${entry.databaseName}`;
    return { ...base, mode: 'dedicated', connectionString: url.toString() };
  }
}
