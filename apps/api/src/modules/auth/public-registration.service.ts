import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { ContextsService } from '../access/contexts.service';
import { RolesService } from '../access/roles.service';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { tenantAls } from '../tenants/tenant-als';
import { isPublicLearningHost, PUBLIC_LEARNING_SLUG } from '../tenants/public-learning';
import { TenantsService } from '../tenants/tenants.service';
import { BetterAuthService } from './better-auth/better-auth.service';
import { CredentialBridgeService } from './better-auth/credential-bridge.service';

/** Trường mà người học khai khi đăng ký tài khoản độc lập ở khu công cộng. */
export interface PublicRegistrationInput {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'student' | 'teacher';
}

/**
 * Khu công cộng là một kho nghiệp vụ độc lập. Đường tạo tài khoản
 * đóng mặc định và tuyệt đối không tự chuyển xuống database chung.
 * Tài khoản/credential được tạo nguyên tử trong cùng kho nhờ cầu nối
 * Better Auth; membership và vai được gắn ngay sau đó tại context
 * của chính kho này (không tuyên bố các thao tác hậu đăng ký là một
 * transaction duy nhất).
 * Người chọn dạy chỉ nhận quyền coursecreator trong khu công cộng,
 * không nhận manager/siteadmin hoặc quyền ở trung tâm nào khác.
 */
@Injectable()
export class PublicRegistrationService {
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
      return tenantAls.run({ spaceSlug: PUBLIC_LEARNING_SLUG, tenantId: tenant.id, platform: true }, async () => {
        // Kiểm tra đủ vai/context TRƯỚC khi tạo credential: không
        // để bản ghi tự đăng ký bị mắc kẹt nếu kho chưa gieo vai.
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
        await this.contexts.createContext(CONTEXT_LEVELS.USER, user.id, system.id);
        await this.tenants.ensureActiveMembership(tenant.id, user.id);
        await this.roles.assignRole(user.id, role.id, tenantContext.id);
        return { id: user.id };
      });
    });
  }
}
