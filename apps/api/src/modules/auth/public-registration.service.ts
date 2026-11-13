import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { ContextsService } from '../access/contexts.service';
import { RolesService } from '../access/roles.service';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { tenantAls } from '../tenants/tenant-als';
import { isPublicLearningHost, PUBLIC_LEARNING_SLUG } from '../tenants/public-learning';
import { TenantsService } from '../tenants/tenants.service';
import { BetterAuthService } from './better-auth/better-auth.service';
import { CredentialBridgeService } from './better-auth/credential-bridge.service';

export interface PublicRegistrationInput {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'student' | 'teacher';
}

@Injectable()
export class PublicRegistrationService {
  private readonly logger = new Logger(PublicRegistrationService.name);

  constructor(
    private readonly spaces: SpaceDatabaseService,
    private readonly tenants: TenantsService,
    private readonly bridge: CredentialBridgeService,
    private readonly betterAuth: BetterAuthService,
    private readonly contexts: ContextsService,
    private readonly roles: RolesService,
  ) {}

  async register(host: string | string[] | undefined, input: PublicRegistrationInput): Promise<{ id: string }> {
    if (!isPublicLearningHost(host) || !this.betterAuth.enabled) {
      throw new ForbiddenException({ message: 'Registration is only available on the public learning site', code: 'public_learning.registration_denied' });
    }
    const target = await this.spaces.resolveTarget(PUBLIC_LEARNING_SLUG);
    if (target.mode !== 'dedicated' || target.status !== 'active') {
      throw new ServiceUnavailableException({ message: 'Public learning store is not active', code: 'public_learning.store_unavailable' });
    }
    return this.spaces.withSpaceKysely(PUBLIC_LEARNING_SLUG, async () => {
      const tenant = await this.tenants.getTenantInSpace(PUBLIC_LEARNING_SLUG);
      if (!tenant || tenant.kind !== 'platform' || tenant.status !== 'active') {
        throw new ServiceUnavailableException({ message: 'Public learning tenant is not ready', code: 'public_learning.tenant_unavailable' });
      }
      return tenantAls.run({ spaceSlug: PUBLIC_LEARNING_SLUG, spaceId: tenantAls.getStore()?.spaceId, spaceHandle: tenantAls.getStore()?.spaceHandle, tenantId: tenant.id, platform: true }, async () => {
        const role = await this.roles.getRoleByShortname(input.role === 'teacher' ? 'coursecreator' : 'student');
        if (!role) throw new ServiceUnavailableException({ message: 'Public learning role baseline is missing', code: 'public_learning.role_missing' });
        const system = await this.contexts.ensureSystemContext();
        const tenantContext = await this.contexts.ensureTenantContext(tenant.id);
        const user = await this.bridge.createUserWithCredential({
          username: input.username,
          email: input.email,
          password: input.password,
          firstName: input.firstName,
          lastName: input.lastName,
          emailVerified: false,
        });
        try {
          await this.contexts.createContext(CONTEXT_LEVELS.USER, user.id, system.id);
          await this.tenants.ensureActiveMembership(tenant.id, user.id);
          await this.roles.assignRole(user.id, role.id, tenantContext.id);
        } catch (error) {
          try {
            await this.spaces.routedKysely.transaction().execute(async (tx) => {
              await tx.deleteFrom('role_assignments').where('user_id', '=', user.id).execute();
              await tx.deleteFrom('context')
                .where('context_level', '=', CONTEXT_LEVELS.USER)
                .where('instance_id', '=', user.id)
                .execute();
              const removed = await tx.deleteFrom('users').where('id', '=', user.id)
                .returning('id').executeTakeFirst();
              if (!removed) throw new Error('New public user disappeared during compensation');
            });
          } catch (cleanupError) {
            this.logger.error(
              'Unable to compensate public registration for ' + user.id,
              cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
            );
            throw new ServiceUnavailableException({
              message: 'Public registration cleanup failed',
              code: 'public_learning.registration_cleanup_failed',
            });
          }
          throw error;
        }
        return { id: user.id };
      });
    });
  }
}
