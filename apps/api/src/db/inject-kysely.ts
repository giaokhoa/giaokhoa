import { Inject } from '@nestjs/common';

export type KyselyStoreName = 'centre' | 'control-plane' | 'system-bank';

export const KYSELY_CENTRE = 'KYSELY_CENTRE';

export const KYSELY_CONTROL_PLANE = 'KYSELY_CONTROL_PLANE';

export const KYSELY_SYSTEM_BANK = 'KYSELY_SYSTEM_BANK';

const STORE_TOKENS: Record<KyselyStoreName, string> = {
  centre: KYSELY_CENTRE,
  'control-plane': KYSELY_CONTROL_PLANE,
  'system-bank': KYSELY_SYSTEM_BANK,
};

export function InjectKysely(store: KyselyStoreName = 'centre'): ParameterDecorator {
  return Inject(STORE_TOKENS[store]);
}
