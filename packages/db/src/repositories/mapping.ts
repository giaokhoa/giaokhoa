import type { RawBuilder } from 'kysely';

type Transform<Target, T extends keyof Target & string> = (
  value: never,
) => Target[T] | RawBuilder<unknown>;

export type DefinedField<Source, Target> = {
  [K in keyof Source & string]: {
    [T in keyof Target & string]:
      | readonly [K, T, Transform<Target, T>]
      | (Exclude<Source[K], undefined> extends Target[T]
          ? readonly [K, T]
          : never);
  }[keyof Target & string];
}[keyof Source & string];

type RawField = readonly [string, string, ((value: unknown) => unknown)?];

function eachDefinedField(
  source: object,
  fields: ReadonlyArray<unknown>,
  emit: (targetKey: string, value: unknown) => void,
): void {
  const values = source as Record<string, unknown>;
  const rawFields = fields as ReadonlyArray<RawField>;
  for (const field of rawFields) {
    const [sourceKey, targetKey, transform] = field;
    const value = values[sourceKey];
    if (value !== undefined) {
      emit(targetKey, transform === undefined ? value : transform(value));
    }
  }
}

export function applyDefined<Target extends object, Source extends object>(
  target: Target,
  source: Source,
  fields: ReadonlyArray<DefinedField<Source, Target>>,
): void {
  const targetRecord = target as Record<string, unknown>;
  eachDefinedField(source, fields, (targetKey, value) => {
    targetRecord[targetKey] = value;
  });
}

type PickDefinedValue<Source, Field> = Field extends readonly [
  string,
  string,
  (value: never) => infer Value,
]
  ? Value
  : Field extends readonly [infer SourceKey2, string]
    ? SourceKey2 extends keyof Source
      ? Source[SourceKey2]
      : never
    : never;

export type PickDefinedResult<Source, Fields extends ReadonlyArray<unknown>> = {
  [Field in Fields[number] as Field extends readonly [
    string,
    infer TargetKey,
    ...unknown[],
  ]
    ? TargetKey extends string
      ? TargetKey
      : never
    : never]?: PickDefinedValue<Source, Field>;
};

export function pickDefined<
  Source extends object,
  Target extends Record<string, unknown> = Record<string, unknown>,
  const Fields extends ReadonlyArray<DefinedField<Source, Target>> =
    ReadonlyArray<DefinedField<Source, Target>>,
>(
  source: Source,
  fields: Fields,
): PickDefinedResult<Source, Fields> {
  const result: Record<string, unknown> = {};
  eachDefinedField(source, fields, (targetKey, value) => {
    result[targetKey] = value;
  });
  return result as PickDefinedResult<Source, Fields>;
}
