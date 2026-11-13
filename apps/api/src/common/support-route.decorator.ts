import { SetMetadata } from '@nestjs/common';

export const IS_SUPPORT_ROUTE_KEY = 'isSupportRoute';
export const SupportRoute = () => SetMetadata(IS_SUPPORT_ROUTE_KEY, true);
