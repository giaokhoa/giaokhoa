import { users } from '@giaokhoa/database/schema';
import type { Database } from '@giaokhoa/database/types';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';

/** Chặn cả phiên đã tạo trước khi tài khoản bị khóa; không tham gia quyết định vai trò. */
@Injectable()
export class ActiveAccountGuard implements CanActivate {
  constructor(
    @Inject(getDrizzleToken()) private readonly db: Database,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { session?: { user?: { id: string } } }>();
    // Bộ bảo vệ của thư viện và bộ bảo vệ ứng dụng không có thứ tự thực thi bảo đảm.
    // Tự lấy phiên bằng Better Auth nếu thư viện chưa gắn phiên vào yêu cầu.
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const session = request.session ?? (await this.auth.api.getSession({ headers }));
    const userId = session?.user?.id;
    if (!userId) return true; // Better Auth vẫn quyết định 401 cho đường không công khai.
    const [account] = await this.db
      .select({ banned: users.banned, banExpires: users.banExpires })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!account || (account.banned && (!account.banExpires || account.banExpires > new Date())))
      throw new ForbiddenException('Tài khoản đã bị khóa');
    return true;
  }
}
