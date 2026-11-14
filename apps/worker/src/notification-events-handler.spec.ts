import { describe, expect, it, vi } from 'vitest';
import { NotificationEventsHandlerService } from './notification-events-handler.service';

type Row = Record<string, unknown>;

function makeSpaceDb(rowsByTable: Record<string, Row | Row[] | undefined>) {
  const builderFor = (table: string) => {
    const builder = {
      select: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      distinct: () => builder,
      executeTakeFirst: async () => {
        const rows = rowsByTable[table];
        return Array.isArray(rows) ? rows[0] : rows;
      },
      execute: async () => {
        const rows = rowsByTable[table];
        if (Array.isArray(rows)) return rows;
        return rows ? [rows] : [];
      },
    };
    return builder;
  };
  return { selectFrom: (table: string) => builderFor(table) };
}

function makeHandler(rowsByTable: Record<string, Row | Row[] | undefined>) {
  const notify = vi.fn(async () => ({ notificationId: 'notif-1', channels: { popup: 'delivered' } }));
  const warn = vi.fn();
  const service = new NotificationEventsHandlerService(
    { routedKysely: makeSpaceDb(rowsByTable) } as never,
    { notify } as never,
    { t: (key: string) => key } as never,
  );
  (service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger = { warn };
  return { service, notify, warn };
}

function eventIdOf(notify: ReturnType<typeof vi.fn>): string | undefined {
  return (notify.mock.calls[0]![2] as { eventId?: string }).eventId;
}

describe('NotificationEventsHandlerService — eventId nhúng vào job BullMQ không chứa dấu hai chấm', () => {
  it('hoàn thành khoá học: eventId mang epoch mili-giây của thời điểm hoàn thành thay vì chuỗi ISO, nên jobId không chứa dấu hai chấm', async () => {
    const completedAt = new Date('2026-11-14T03:00:00.000Z');
    const { service, notify } = makeHandler({
      course: { fullName: 'Toán' },
      course_completions: { timeCompleted: completedAt },
    });

    const handled = await service.handle('course_completed', { userId: 'user-1', courseId: 'course-1', tenantId: 'tenant-1' });

    expect(handled).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(eventIdOf(notify)).toBe(`course-completed-course-1-${completedAt.getTime()}`);
    expect(eventIdOf(notify)).not.toContain(':');
  });

  it('hoàn thành khoá học nhưng chưa có dòng completion: eventId giữ undefined như trước thay vì sinh chuỗi thời gian rỗng', async () => {
    const { service, notify } = makeHandler({ course: { fullName: 'Toán' } });

    await service.handle('course_completed', { userId: 'user-1', courseId: 'course-1', tenantId: 'tenant-1' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(eventIdOf(notify)).toBeUndefined();
  });

  it('cảnh báo hết hạn ghi danh: eventId mang epoch mili-giây của timeEnd ISO thay vì chuỗi ISO thô', async () => {
    const timeEnd = '2026-12-01T00:00:00.000Z';
    const { service, notify } = makeHandler({ course: { fullName: 'Toán' } });

    await service.handle('enrol_expiry_warning', { userId: 'user-1', courseId: 'course-1', enrolmentId: 'enrol-1', timeEnd, tenantId: 'tenant-1' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(eventIdOf(notify)).toBe(`enrol-expiry-enrol-1-${new Date(timeEnd).getTime()}`);
    expect(eventIdOf(notify)).not.toContain(':');
  });

  it('cảnh báo hết hạn ghi danh với timeEnd không parse được: thông báo vẫn phát và eventId giữ chuỗi gốc đã loại dấu hai chấm', async () => {
    const { service, notify } = makeHandler({ course: { fullName: 'Toán' } });

    await service.handle('enrol_expiry_warning', { userId: 'user-1', courseId: 'course-1', enrolmentId: 'enrol-1', timeEnd: 'ngay:khong-hop-le', tenantId: 'tenant-1' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(eventIdOf(notify)).toBe('enrol-expiry-enrol-1-ngay-khong-hop-le');
    expect(eventIdOf(notify)).not.toContain(':');
  });

  it('nhắc hạn bài tập: eventId mang epoch mili-giây của timeClose ISO thay vì chuỗi ISO thô', async () => {
    const timeClose = '2026-11-20T10:00:00.000Z';
    const { service, notify } = makeHandler({ course: { fullName: 'Toán' } });

    await service.handle('activity_due_reminder', { userId: 'user-1', courseId: 'course-1', activityType: 'assign', assignmentId: 'assign-1', timeClose, tenantId: 'tenant-1' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(eventIdOf(notify)).toBe(`activity-due-assign-1-${new Date(timeClose).getTime()}`);
    expect(eventIdOf(notify)).not.toContain(':');
  });

  it('nhắc hạn bài kiểm tra với timeClose không parse được: thông báo vẫn phát và eventId giữ chuỗi gốc đã loại dấu hai chấm', async () => {
    const { service, notify } = makeHandler({ course: { fullName: 'Toán' } });

    await service.handle('activity_due_reminder', { userId: 'user-1', courseId: 'course-1', activityType: 'quiz', pinId: 'pin-1', timeClose: 'gio:khong-hop-le', tenantId: 'tenant-1' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(eventIdOf(notify)).toBe('activity-due-pin-1-gio-khong-hop-le');
    expect(eventIdOf(notify)).not.toContain(':');
  });

  it('cập nhật điểm nhưng không còn dòng grade: không phát thông báo và ghi log warn để không mất dấu lặng', async () => {
    const { service, notify, warn } = makeHandler({
      grade_items: { itemType: 'assign', itemName: 'Bài 1', hidden: false, courseId: 'course-1' },
      grade_grades: undefined,
    });

    const handled = await service.handle('grade_updated', { userId: 'user-1', itemId: 'item-1', finalGrade: 8.5, tenantId: 'tenant-1' });

    expect(handled).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('item-1');
  });

  it('cập nhật điểm còn dòng grade: eventId mang epoch mili-giây của lần sửa điểm nên jobId không chứa dấu hai chấm', async () => {
    const updatedAt = new Date('2026-11-14T01:00:00.000Z');
    const { service, notify } = makeHandler({
      grade_items: { itemType: 'assign', itemName: 'Bài 1', hidden: false, courseId: 'course-1' },
      grade_grades: { hidden: false, updatedAt },
      course: { fullName: 'Toán' },
    });

    await service.handle('grade_updated', { userId: 'user-1', itemId: 'item-1', finalGrade: 8.5, tenantId: 'tenant-1' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(eventIdOf(notify)).toBe(`grade-item-1-8.5-${updatedAt.getTime()}`);
    expect(eventIdOf(notify)).not.toContain(':');
  });
});
