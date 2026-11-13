import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomFieldsRepository, type CategoryRow, type FieldRow } from '@giaokhoa/db/repositories/custom-fields';

export type CustomFieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'date';
export interface FieldConfig { required?: boolean; options?: string[]; defaultvalue?: string; maxlength?: number }
export const FIELD_TYPES: CustomFieldType[] = ['text', 'textarea', 'select', 'checkbox', 'date'];

/**
 * Type guard cho `CustomFieldType`: biên controller dùng để thu hẹp `type`
 * chuỗi từ DTO trước khi gọi service, thay cho ép kiểu.
 */
export function isCustomFieldType(value: string): value is CustomFieldType {
  return FIELD_TYPES.some((type) => type === value);
}

/**
 * Facade của CustomFields (Moodle core_customfield). Các định nghĩa là metadata — các bảng nghiệp vụ không bao giờ bị thay đổi. Giá trị được kiểm chứng đối chiếu với khai báo của trường mỗi khi thực thể sở hữu (hồ sơ người dùng) được lưu.
 */
@Injectable()
/**
 * Trường tuỳ biến cho user/khoá học: định nghĩa theo category, kiểu dữ liệu (text, textarea, select, checkbox, date) và kiểm tra giá trị theo configData của từng field trước khi lưu. Đối chiếu Moodle: customfield_* (customfield/classes/handler.php).
 */
export class CustomFieldsService {
  constructor(private readonly repo: CustomFieldsRepository) {}

  /**
   * Tạo category trường cho một component/area.
   */
  async createCategory(input: { name: string; component: string; area: string }): Promise<CategoryRow> {
    const existing = await this.repo.listCategories(input.component, input.area);
    return this.repo.insertCategory({ ...input, sortOrder: existing.length });
  }
  /**
   * Liệt kê category.
   */
  async listCategories(component: string, area: string): Promise<CategoryRow[]> { return this.repo.listCategories(component, area); }
  /**
   * Xoá category.
   */
  async deleteCategory(id: string): Promise<void> {
    if (!(await this.repo.getCategory(id))) throw new NotFoundException({ message: `Category ${id} not found`, code: 'customfield.category_not_found' });
    await this.repo.deleteCategory(id);
  }
  /**
   * Tạo field trong category với configData theo kiểu dữ liệu.
   */
  async createField(categoryId: string, input: { shortName: string; name: string; type: CustomFieldType; configData?: FieldConfig }): Promise<FieldRow> {
    const category = await this.repo.getCategory(categoryId);
    if (!category) throw new NotFoundException({ message: `Category ${categoryId} not found`, code: 'customfield.category_not_found' });
    if (!FIELD_TYPES.includes(input.type)) {
      throw new BadRequestException({ message: `Unsupported field type ${input.type}`, code: 'customfield.invalid_type' });
    }
    const siblings = await this.repo.listFieldsByCategory(categoryId);
    if (siblings.some((f) => f.shortName === input.shortName)) {
      throw new BadRequestException({ message: `Field shortName ${input.shortName} already exists in category`, code: 'customfield.shortname_taken' });
    }
    return this.repo.insertField({ categoryId, shortName: input.shortName, name: input.name, type: input.type, configData: input.configData ?? {}, sortOrder: siblings.length });
  }
  /**
   * Liệt kê field của category.
   */
  async listFields(component: string, area: string): Promise<FieldRow[]> {
    const categories = await this.repo.listCategories(component, area);
    const nested = await Promise.all(categories.map((c) => this.repo.listFieldsByCategory(c.id)));
    return nested.flat();
  }
  /**
   * Xoá field và giá trị của nó.
   */
  async deleteField(id: string): Promise<void> {
    if (!(await this.repo.getField(id))) throw new NotFoundException({ message: `Field ${id} not found`, code: 'customfield.field_not_found' });
    await this.repo.deleteField(id);
  }

  /**
   * Kiểm chứng một giá trị đối chiếu với khai báo trường của nó (bắt buộc, độ dài,
   * danh sách lựa chọn của select, định dạng date); trả về thông báo lỗi hoặc null.
   * Luật nghiệp vụ thuần theo từng kiểu.
   */
  validateValue(field: FieldRow, raw: string | undefined | null): string | null {
    const config = (field.configData ?? {}) as FieldConfig;
    const value = raw ?? '';
    if (config.required && value.trim() === '') return `Field ${field.shortName} is required`;
    if (value === '') return null;
    switch (field.type) {
      case 'text':
        if (config.maxlength && value.length > config.maxlength) return `Field ${field.shortName} exceeds ${config.maxlength} characters`;
        return null;
      case 'textarea': return null;
      case 'select':
        return (config.options ?? []).includes(value) ? null : `Field ${field.shortName} must be one of: ${(config.options ?? []).join(', ')}`;
      case 'checkbox':
        return ['0', '1', 'true', 'false'].includes(value) ? null : `Field ${field.shortName} must be a boolean value`;
      case 'date':
        return Number.isNaN(Date.parse(value)) ? `Field ${field.shortName} must be a valid date` : null;
      default: return `Unknown field type ${field.type}`;
    }
  }

  /**
   * Kiểm toàn bộ bộ giá trị của một instance trước khi ghi. Lượt chỉ kiểm chứng
   * (không ghi) — bên gọi chạy bước này TRƯỚC khi lưu thực thể sở hữu để một hồ sơ
   * lỗi không bao giờ để lại một bản ghi tạo dở.
   */
  async validateValuesForInstance(component: string, area: string, values: Record<string, string>): Promise<void> {
    const fields = await this.listFields(component, area);
    const errors: string[] = [];
    for (const field of fields) {
      const err = this.validateValue(field, values[field.shortName]);
      if (err) errors.push(err);
    }
    if (errors.length) throw new BadRequestException({ message: errors.join('; '), code: 'customfield.validation_failed' });
  }

  /**
   * Kiểm chứng + lưu mọi giá trị cho một instance (ví dụ một id người dùng) sau khi
   * kiểm hợp lệ. Ném lỗi 400 liệt kê mọi vi phạm.
   */
  async setValuesForInstance(component: string, area: string, instanceId: string, values: Record<string, string>): Promise<void> {
    await this.validateValuesForInstance(component, area, values);
    const fields = await this.listFields(component, area);
    for (const field of fields) {
      const value = values[field.shortName];
      if (value !== undefined) await this.repo.upsertData(field.id, instanceId, value);
    }
  }
  /**
   * Đọc giá trị field của instance để hiển thị hồ sơ. Uỷ quyền cho bản theo lô
   * `getValuesForInstances` với một id để dùng chung đường tra cứu theo `Map`.
   */
  async getValuesForInstance(component: string, area: string, instanceId: string): Promise<{ field: FieldRow; value: string | null }[]> {
    const values = await this.getValuesForInstances(component, area, [instanceId]);
    return values.get(instanceId) ?? [];
  }

  /**
   * Đọc giá trị field của NHIỀU instance trong một lượt nạp (DL-07,
   * issue #489): bản theo lô của `getValuesForInstance` — danh sách
   * field của (component, area) nạp một lần, dữ liệu của mọi instance
   * nạp một truy vấn, rồi lắp cho từng instance đúng thứ tự field và
   * luật "không có dòng dữ liệu thì null" của đường lẻ.
   */
  async getValuesForInstances(
    component: string, area: string, instanceIds: string[],
  ): Promise<Map<string, { field: FieldRow; value: string | null }[]>> {
    const fields = await this.listFields(component, area);
    const data = await this.repo.getDataForInstances(fields.map((f) => f.id), instanceIds);
    const valueByInstanceField = new Map<string, string | null>();
    for (const d of data) {
      const key = `${d.instanceId}:${d.fieldId}`;
      if (!valueByInstanceField.has(key)) valueByInstanceField.set(key, d.value);
    }
    const result = new Map<string, { field: FieldRow; value: string | null }[]>();
    for (const instanceId of instanceIds) {
      result.set(instanceId, fields.map((field) => ({
        field, value: valueByInstanceField.get(`${instanceId}:${field.id}`) ?? null,
      })));
    }
    return result;
  }
}
