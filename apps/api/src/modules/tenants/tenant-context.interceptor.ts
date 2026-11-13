import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../../common/current-user.decorator';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{
      tenantId?: string;
      spaceSlug?: string;
      spaceId?: string;
      spaceHandle?: object;
      user?: AuthenticatedUser;
    }>();
    const tenantId = request.tenantId;
    const spaceSlug = request.spaceSlug;
    const spaceId = request.spaceId;
    const spaceHandle = request.spaceHandle;
    if (!tenantId && !spaceSlug) return next.handle();
    return new Observable((subscriber) => {
      const subscription = this.tenantContext.run(
        { tenantId, userId: request.user?.id, ...(spaceSlug ? { spaceSlug } : {}), ...(spaceId ? { spaceId, spaceHandle } : {}) },
        () => next.handle().subscribe(subscriber),
      );
      return () => subscription.unsubscribe();
    });
  }
}
