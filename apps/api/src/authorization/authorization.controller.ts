import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { authorizationContract } from '@giaokhoa/shared/http/authorization';
import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

type SystemRoleBody = { role: 'teacher' | 'admin' };

/** Thực thi phân quyền qua dịch vụ ứng dụng, không cung cấp đường quản trị riêng của Better Auth. */
@Controller('authorization')
export class AuthorizationController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Post('check')
  @HttpCode(HttpStatus.OK)
  check(
    @Body({ schema: authorizationContract.check.body }) body: {
      context: {
        kind: 'system' | 'user' | 'bank' | 'question' | 'exam' | 'class' | 'assignment';
        resourceKey: string;
      };
      capabilities: string[];
    },
    @Session() session: UserSession,
  ) {
    return this.authorization.checkCapabilities(session.user.id, body.context, body.capabilities);
  }

  /** Định nghĩa vai trò và các loại ngữ cảnh được phép gán qua capability hệ thống. */
  @Post('roles')
  async createRole(
    @Body({ schema: authorizationContract.createRole.body }) body: {
      key: string;
      contextKind: 'system' | 'class';
      contexts: Array<'system' | 'user' | 'bank' | 'question' | 'exam' | 'class' | 'assignment'>;
    },
    @Session() session: UserSession,
  ) {
    return {
      changed: await this.authorization.createRole(
        session.user.id,
        body.key,
        body.contextKind,
        body.contexts,
      ),
    };
  }

  /** Thay đổi quyền mặc định của vai trò; INHERIT xóa cấu hình riêng của capability. */
  @Put('roles/:roleKey/permissions')
  async setRolePermission(
    @Param('roleKey', { schema: authorizationContract.setRolePermission.pathParams.shape.roleKey })
    roleKey: string,
    @Body({ schema: authorizationContract.setRolePermission.body }) body: {
      capability: string;
      effect: 'INHERIT' | 'ALLOW' | 'PREVENT' | 'PROHIBIT';
    },
    @Session() session: UserSession,
  ) {
    return {
      changed: await this.authorization.setRolePermission(
        session.user.id,
        roleKey,
        body.capability,
        body.effect,
      ),
    };
  }

  /** Giới hạn loại ngữ cảnh được phép gán vai trò. */
  @Put('roles/:roleKey/contexts')
  async setRoleContexts(
    @Param('roleKey', { schema: authorizationContract.setRoleContexts.pathParams.shape.roleKey })
    roleKey: string,
    @Body({ schema: authorizationContract.setRoleContexts.body }) body: {
      contexts: Array<'system' | 'user' | 'bank' | 'question' | 'exam' | 'class' | 'assignment'>;
    },
    @Session() session: UserSession,
  ) {
    return {
      changed: await this.authorization.setRoleContexts(session.user.id, roleKey, body.contexts),
    };
  }

  /** Cấu hình role nào được quyền gán hoặc ghi đè role nào. */
  @Put('roles/:roleKey/matrix')
  async setRoleMatrix(
    @Param('roleKey', { schema: authorizationContract.setRoleMatrix.pathParams.shape.roleKey })
    roleKey: string,
    @Body({ schema: authorizationContract.setRoleMatrix.body }) body: {
      targetRoleKey: string;
      action: 'assign' | 'override';
      allowed: boolean;
    },
    @Session() session: UserSession,
  ) {
    return {
      changed: await this.authorization.setRoleMatrix(
        session.user.id,
        roleKey,
        body.targetRoleKey,
        body.action,
        body.allowed,
      ),
    };
  }

  /** Gán vai trò vào một ngữ cảnh, không suy quyền từ danh tính đăng nhập. */
  @Post('contexts/:contextId/roles/:userId')
  async grantContextRole(
    @Param('contextId', {
      schema: authorizationContract.grantContextRole.pathParams.shape.contextId,
    })
    contextId: string,
    @Param('userId', { schema: authorizationContract.grantContextRole.pathParams.shape.userId })
    userId: string,
    @Body({ schema: authorizationContract.grantContextRole.body }) body: { roleKey: string },
    @Session() session: UserSession,
  ) {
    return {
      changed: await this.authorization.changeRole(
        session.user.id,
        contextId,
        userId,
        body.roleKey,
        true,
      ),
    };
  }

  @Delete('contexts/:contextId/roles/:userId')
  @HttpCode(HttpStatus.OK)
  async revokeContextRole(
    @Param('contextId', {
      schema: authorizationContract.revokeContextRole.pathParams.shape.contextId,
    })
    contextId: string,
    @Param('userId', { schema: authorizationContract.revokeContextRole.pathParams.shape.userId })
    userId: string,
    @Body({ schema: authorizationContract.revokeContextRole.body }) body: { roleKey: string },
    @Session() session: UserSession,
  ) {
    return {
      changed: await this.authorization.changeRole(
        session.user.id,
        contextId,
        userId,
        body.roleKey,
        false,
      ),
    };
  }

  /** INHERIT gỡ ghi đè để trở về định nghĩa quyền toàn cục của vai trò. */
  @Put('contexts/:contextId/overrides')
  async overrideRole(
    @Param('contextId', { schema: authorizationContract.overrideRole.pathParams.shape.contextId })
    contextId: string,
    @Body({ schema: authorizationContract.overrideRole.body }) body: {
      roleKey: string;
      capability: string;
      effect: 'INHERIT' | 'ALLOW' | 'PREVENT' | 'PROHIBIT';
    },
    @Session() session: UserSession,
  ) {
    return {
      changed: await this.authorization.overrideRole(
        session.user.id,
        contextId,
        body.roleKey,
        body.capability,
        body.effect,
      ),
    };
  }

  @Post('system-roles/:userId')
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

  @Delete('system-roles/:userId')
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
