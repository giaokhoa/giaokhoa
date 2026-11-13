import { SetMetadata } from '@nestjs/common';
export const REQUIRE_CAPABILITY_KEY = 'requireCapability';
export interface CapabilityRequirement {
  capability: string;
  contextResolver?: 'system' | 'param:contextId' | 'query:contextId' | 'body:contextId' | 'param:userId:userctx';
}
export const RequireCapability = (capability: string, contextResolver: CapabilityRequirement['contextResolver'] = 'system') =>
  SetMetadata(REQUIRE_CAPABILITY_KEY, { capability, contextResolver } satisfies CapabilityRequirement);
