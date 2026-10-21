import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { authorizationContract } from '@giaokhoa/shared/http/authorization';
import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

type SystemRoleBody = { role: 'teacher' | 'admin' };

/** Thực thi phân quyền qua dịch vụ ứng dụng, không cung cấp đường quản trị riêng của Better Auth. */
@Controller('authorization/system-roles')
export class AuthorizationController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Post(':userId')
  async grant(
    @Param('userId', { schema: authorizationContract.grantSystemRole.pathParams.shape.userId })
    userId: string,
    @Body({ schema: authorizationContract.grantSystemRole.body }) body: SystemRoleBody,
    @Session() session: UserSession,
  ) {
    return authorizationContract.grantSystemRole.responses[201].parse({
      changed: await this.authorization.changeSystemRole(session.user.id, userId, body.role, true),
    });
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('userId', { schema: authorizationContract.revokeSystemRole.pathParams.shape.userId })
    userId: string,
    @Body({ schema: authorizationContract.revokeSystemRole.body }) body: SystemRoleBody,
    @Session() session: UserSession,
  ) {
    return authorizationContract.revokeSystemRole.responses[200].parse({
      changed: await this.authorization.changeSystemRole(session.user.id, userId, body.role, false),
    });
  }
}
