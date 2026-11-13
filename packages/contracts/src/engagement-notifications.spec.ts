import { describe, expect, it } from 'vitest';
import {
  listNotificationGroupsQuerySchema,
  listNotificationItemsQuerySchema,
  readNotificationGroupSchema,
} from './engagement';

describe('Đầu vào thông báo không chấp nhận trường không được khai báo', () => {
  it('từ chối query nhóm có trường lạ thay vì bỏ qua âm thầm', () => {
    expect(listNotificationGroupsQuerySchema.safeParse({ unknownFilter: 'all' }).success).toBe(false);
  });

  it('từ chối query dòng thông báo có trường lạ thay vì bỏ qua âm thầm', () => {
    expect(listNotificationItemsQuerySchema.safeParse({ unknownFilter: 'all' }).success).toBe(false);
  });

  it('từ chối body đánh dấu đọc có trường lạ', () => {
    expect(readNotificationGroupSchema.safeParse({
      eventType: 'comment',
      day: '2026-11-13',
      unexpected: 'not-allowed',
    }).success).toBe(false);
  });
});
