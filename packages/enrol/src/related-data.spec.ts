import { describe, expect, it } from 'vitest';
import { hasCourseCompletionData, hasCourseGradeData, hasRelatedCourseData } from './related-data';
import { FakeEnrolDb } from './test-support/fake-db';

/**
 * Ghim hai kiểm tồn tại dữ liệu liên quan (`related-data.ts`): mỗi
 * kiểm chỉ chạy MỘT truy vấn duy nhất nối bảng dữ liệu với bảng
 * gốc của khoá rồi giới hạn một dòng (C-E4) — nhật ký truy vấn của
 * bản giả khẳng định đúng một lượt select với `limit(1)`, thay cho
 * khuôn cũ tải toàn bộ id rồi truy vấn `IN` hai lượt.
 */

const COURSE_ID = 'd5b9e43f-0a6f-5e7d-b084-3c2d4e5f6a7b';
const OTHER_COURSE_ID = 'e6c0f54a-1b7a-6f8e-c195-4d3e5f6a7b8c';
const USER_ID = 'b3f7c21d-8a4e-4c5d-9e62-1f0a2b3c4d5e';
const OTHER_USER_ID = 'c4a8d32e-9b5f-4d6e-af73-2a1b3c4d5e6f';

/** Khẳng định một lượt kiểm chỉ chạy đúng một select với `limit(1)`. */
function expectSingleLimitedSelect(db: FakeEnrolDb, table: string): void {
  const selects = db.selects(table);
  expect(selects).toHaveLength(1);
  expect(selects[0]!.limit).toBe(1);
}

describe('hasCourseCompletionData — dữ liệu hoàn thành', () => {
  it('còn dòng hoàn thành trên module chưa xoá của khoá: trả true và chỉ chạy một truy vấn giới hạn một dòng', async () => {
    const db = new FakeEnrolDb();
    db.seed('course_modules', [{ id: 'module-1', course: COURSE_ID, deletion_in_progress: false }]);
    db.seed('course_modules_completion', [{ id: 'cmc-1', user_id: USER_ID, course_module_id: 'module-1' }]);

    expect(await hasCourseCompletionData(db.handle, COURSE_ID, USER_ID)).toBe(true);
    expectSingleLimitedSelect(db, 'course_modules_completion');
  });

  it('không có dòng hoàn thành nào: trả false', async () => {
    const db = new FakeEnrolDb();
    db.seed('course_modules', [{ id: 'module-1', course: COURSE_ID, deletion_in_progress: false }]);

    expect(await hasCourseCompletionData(db.handle, COURSE_ID, USER_ID)).toBe(false);
    expectSingleLimitedSelect(db, 'course_modules_completion');
  });

  it('dòng hoàn thành thuộc module đã xoá (deletion_in_progress): không tính là còn dữ liệu', async () => {
    const db = new FakeEnrolDb();
    db.seed('course_modules', [{ id: 'module-1', course: COURSE_ID, deletion_in_progress: true }]);
    db.seed('course_modules_completion', [{ id: 'cmc-1', user_id: USER_ID, course_module_id: 'module-1' }]);

    expect(await hasCourseCompletionData(db.handle, COURSE_ID, USER_ID)).toBe(false);
  });

  it('dòng hoàn thành thuộc module của khoá khác: không tính là còn dữ liệu', async () => {
    const db = new FakeEnrolDb();
    db.seed('course_modules', [
      { id: 'module-1', course: COURSE_ID, deletion_in_progress: false },
      { id: 'module-2', course: OTHER_COURSE_ID, deletion_in_progress: false },
    ]);
    db.seed('course_modules_completion', [{ id: 'cmc-1', user_id: USER_ID, course_module_id: 'module-2' }]);

    expect(await hasCourseCompletionData(db.handle, COURSE_ID, USER_ID)).toBe(false);
  });

  it('dòng hoàn thành của người khác trong cùng khoá: không tính là còn dữ liệu', async () => {
    const db = new FakeEnrolDb();
    db.seed('course_modules', [{ id: 'module-1', course: COURSE_ID, deletion_in_progress: false }]);
    db.seed('course_modules_completion', [{ id: 'cmc-1', user_id: OTHER_USER_ID, course_module_id: 'module-1' }]);

    expect(await hasCourseCompletionData(db.handle, COURSE_ID, USER_ID)).toBe(false);
  });
});

describe('hasCourseGradeData — dữ liệu điểm', () => {
  it('còn dòng điểm trên mục điểm của khoá: trả true và chỉ chạy một truy vấn giới hạn một dòng', async () => {
    const db = new FakeEnrolDb();
    db.seed('grade_items', [{ id: 'item-1', course_id: COURSE_ID }]);
    db.seed('grade_grades', [{ id: 'gg-1', user_id: USER_ID, item_id: 'item-1' }]);

    expect(await hasCourseGradeData(db.handle, COURSE_ID, USER_ID)).toBe(true);
    expectSingleLimitedSelect(db, 'grade_grades');
  });

  it('không có dòng điểm nào: trả false', async () => {
    const db = new FakeEnrolDb();
    db.seed('grade_items', [{ id: 'item-1', course_id: COURSE_ID }]);

    expect(await hasCourseGradeData(db.handle, COURSE_ID, USER_ID)).toBe(false);
    expectSingleLimitedSelect(db, 'grade_grades');
  });

  it('dòng điểm thuộc mục điểm của khoá khác: không tính là còn dữ liệu', async () => {
    const db = new FakeEnrolDb();
    db.seed('grade_items', [
      { id: 'item-1', course_id: COURSE_ID },
      { id: 'item-2', course_id: OTHER_COURSE_ID },
    ]);
    db.seed('grade_grades', [{ id: 'gg-1', user_id: USER_ID, item_id: 'item-2' }]);

    expect(await hasCourseGradeData(db.handle, COURSE_ID, USER_ID)).toBe(false);
  });

  it('dòng điểm của người khác trong cùng khoá: không tính là còn dữ liệu', async () => {
    const db = new FakeEnrolDb();
    db.seed('grade_items', [{ id: 'item-1', course_id: COURSE_ID }]);
    db.seed('grade_grades', [{ id: 'gg-1', user_id: OTHER_USER_ID, item_id: 'item-1' }]);

    expect(await hasCourseGradeData(db.handle, COURSE_ID, USER_ID)).toBe(false);
  });
});

describe('hasRelatedCourseData — hợp của hai kiểm', () => {
  it('chỉ còn dữ liệu điểm (không còn dữ liệu hoàn thành): trả true', async () => {
    const db = new FakeEnrolDb();
    db.seed('grade_items', [{ id: 'item-1', course_id: COURSE_ID }]);
    db.seed('grade_grades', [{ id: 'gg-1', user_id: USER_ID, item_id: 'item-1' }]);

    expect(await hasRelatedCourseData(db.handle, COURSE_ID, USER_ID)).toBe(true);
    // Kiểm hoàn thành chạy trước (không thấy) rồi mới tới kiểm điểm: đúng hai lượt truy vấn, mỗi lượt một dòng.
    expect(db.selects('course_modules_completion')).toHaveLength(1);
    expectSingleLimitedSelect(db, 'grade_grades');
  });

  it('không còn dữ liệu nào: trả false', async () => {
    const db = new FakeEnrolDb();

    expect(await hasRelatedCourseData(db.handle, COURSE_ID, USER_ID)).toBe(false);
    expect(db.selects('course_modules_completion')).toHaveLength(1);
    expect(db.selects('grade_grades')).toHaveLength(1);
  });
});
