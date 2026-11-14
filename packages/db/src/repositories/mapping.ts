export type DefinedField<Source, Target> = {
  [K in keyof Source & string]: {
    [T in keyof Target & string]: Exclude<Source[K], undefined> extends Target[T]
      ? readonly [K, T] | readonly [K, T, (value: never) => unknown]
      : readonly [K, T, (value: never) => unknown];
  }[keyof Target & string];
}[keyof Source & string];

export function applyDefined<Target extends object, Source extends object>(
  target: Target,
  source: Source,
  fields: ReadonlyArray<DefinedField<Source, Target>>,
): void {
  for (const field of fields) {
    const [sourceKey, targetKey, transform] = field;
    const value = (source as Record<string, unknown>)[sourceKey];
    if (value !== undefined) {
      (target as Record<string, unknown>)[targetKey] =
        transform === undefined ? value : transform(value as never);
    }
  }
}

type PickDefinedValue<Source, Field> = Field extends readonly [
  string,
  string,
  infer Transform extends (value: never) => unknown,
]
  ? ReturnType<Transform>
  : Field extends readonly [infer SourceKey2, string]
    ? SourceKey2 extends keyof Source
      ? Source[SourceKey2]
      : never
    : never;

export type PickDefinedResult<
  Source,
  Fields extends ReadonlyArray<
    | readonly [keyof Source & string, string]
    | readonly [keyof Source & string, string, (value: never) => unknown]
  >,
> = {
  [Field in Fields[number] as Field[1]]?: PickDefinedValue<Source, Field>;
};

export function pickDefined<
  Source extends object,
  const Fields extends ReadonlyArray<
    | readonly [keyof Source & string, string]
    | readonly [keyof Source & string, string, (value: never) => unknown]
  >,
>(source: Source, fields: Fields): PickDefinedResult<Source, Fields> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const [sourceKey, targetKey, transform] = field;
    const value = (source as Record<string, unknown>)[sourceKey];
    if (value !== undefined) {
      result[targetKey] = transform === undefined ? value : transform(value as never);
    }
  }
  return result as PickDefinedResult<Source, Fields>;
}
