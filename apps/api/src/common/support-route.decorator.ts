import { SetMetadata } from '@nestjs/common';

/**
 * Đánh dấu các endpoint chỉ dành cho support token (aud=support).
 * AudienceGuard loại token platform admin, nghiệp vụ và cookie
 * trên bề mặt này; token support cũng không thể gọi API còn lại.
 */
export const IS_SUPPORT_ROUTE_KEY = 'isSupportRoute';
export const SupportRoute = () => SetMetadata(IS_SUPPORT_ROUTE_KEY, true);
