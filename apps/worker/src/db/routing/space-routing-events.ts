
export type SpaceRegistryChangedUnsubscribe = () => void;

type SpaceRegistryChangedListener = (slug: string) => void;

const listeners = new Set<SpaceRegistryChangedListener>();

export function onSpaceRegistryChanged(listener: SpaceRegistryChangedListener): SpaceRegistryChangedUnsubscribe {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSpaceRegistryChanged(slug: string): void {
  for (const listener of listeners) listener(slug);
}
