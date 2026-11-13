export function createEditorControlStore<T>(initialValue: T): {
  get: () => T;
  update: (nextValue: T) => void;
} {
  let value = initialValue;
  return {
    get: () => value,
    update: (nextValue) => {
      value = nextValue;
    },
  };
}
