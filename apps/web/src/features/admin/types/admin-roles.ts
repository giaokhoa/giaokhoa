import type { Capability } from '@giaokhoa/contracts';


export type RoleMatrixDraft = Record<string, number>;

export interface CapabilityGroup {
  resource: string;
  capabilities: Capability[];
}

export function resourceOfCapability(name: string): string {
  const index = name.indexOf(':');
  return index === -1 ? name : name.slice(0, index);
}

export function groupCapabilitiesByResource(capabilities: Capability[]): CapabilityGroup[] {
  const byResource = new Map<string, Capability[]>();
  for (const capability of capabilities) {
    const resource = resourceOfCapability(capability.name);
    const group = byResource.get(resource);
    if (group) group.push(capability);
    else byResource.set(resource, [capability]);
  }
  return [...byResource.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resource, group]) => ({
      resource,
      capabilities: [...group].sort((left, right) => left.name.localeCompare(right.name)),
    }));
}

export function verbOfCapability(name: string): string {
  const index = name.indexOf(':');
  return index === -1 ? name : name.slice(index + 1);
}
