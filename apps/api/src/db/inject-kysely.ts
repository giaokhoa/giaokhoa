/**
 * Tạo token inject riêng cho ba kho Kysely tại tầng NestJS: kho trung tâm, kho control plane và kho ngân hàng hệ thống.
 *
 * Kysely không cung cấp module NestJS mặc định; `@InjectKysely()` chọn kho trung tâm khi không truyền tên, giúp các consumer chỉ phụ thuộc vào token đã đăng ký bởi `KyselyModule`.
 */
import { Inject } from '@nestjs/common';

/** Ba kho dữ liệu có handle Kysely — khớp ba factory trong `@giaokhoa/db` (`client.ts`). */
export type KyselyStoreName = 'centre' | 'control-plane' | 'system-bank';

/** Token provider của handle Kysely kho trung tâm (`CentreDb`). */
export const KYSELY_CENTRE = 'KYSELY_CENTRE';

/** Token provider của handle Kysely kho control plane (`ControlPlaneDb`). */
export const KYSELY_CONTROL_PLANE = 'KYSELY_CONTROL_PLANE';

/** Token provider của handle Kysely kho ngân hàng hệ thống (`SystemBankDb`). */
export const KYSELY_SYSTEM_BANK = 'KYSELY_SYSTEM_BANK';

const STORE_TOKENS: Record<KyselyStoreName, string> = {
  centre: KYSELY_CENTRE,
  'control-plane': KYSELY_CONTROL_PLANE,
  'system-bank': KYSELY_SYSTEM_BANK,
};

/**
 * Inject handle Kysely của một kho vào constructor.
 *
 * @param store - Kho cần handle; mặc định là kho trung tâm.
 * @returns Decorator tham số của NestJS (`Inject` với token của kho).
 *
 * @example
 * ```ts
 * constructor(@InjectKysely() private readonly db: CentreDb) {}
 * constructor(@InjectKysely('control-plane') private readonly cp: ControlPlaneDb) {}
 * ```
 */
export function InjectKysely(store: KyselyStoreName = 'centre'): ParameterDecorator {
  return Inject(STORE_TOKENS[store]);
}
