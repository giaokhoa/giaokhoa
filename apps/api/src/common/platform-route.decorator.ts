import { SetMetadata } from '@nestjs/common';
export const IS_PLATFORM_ROUTE_KEY = 'isPlatformRoute';
export const PlatformRoute = () => SetMetadata(IS_PLATFORM_ROUTE_KEY, true);
