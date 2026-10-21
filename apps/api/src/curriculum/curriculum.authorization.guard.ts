import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/** Xét quyền theo context hệ thống, không phụ thuộc vào vai trò trong phiên Better Auth. */
@Injectable()
export class CurriculumAuthorizationGuard implements CanActivate {
  constructor(private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    if (!request.user?.id) throw new UnauthorizedException();
    await this.authorization.assertAuthorized({
      actorId: request.user.id,
      capability: 'platform:moderate',
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
    return true;
  }
}
