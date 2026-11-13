import { setSiteSettingSchema, type SetSiteSetting } from '@giaokhoa/contracts';

/**
 * Validation của Site Config dùng Zod qua Standard Schema — schema nền ở `@giaokhoa/contracts` là nguồn sự thật duy nhất; kiểu và miền giá trị của từng setting do registry phía máy chủ kiểm chứng tiếp vì phụ thuộc vào khoá.
 */
export { setSiteSettingSchema };
export type SetSettingDto = SetSiteSetting;
