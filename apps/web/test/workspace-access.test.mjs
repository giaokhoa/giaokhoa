import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspacePermissions } from '../app/features/workspace/access.ts';
import { reviveApiDates, toInstant, toLocalDateTime, formatDate } from '../app/lib/http/dates.ts';

void test('học sinh chỉ thấy không gian học tập và không nhận nút biên soạn hay mục quản trị', () => {
  const actual = workspacePermissions(
    ['class:join'],
    [{ capabilities: ['class:view', 'assignment:attempt'] }],
  );
  assert.equal(actual.classes, true);
  assert.equal(actual.assignments, true);
  assert.equal(actual.attempts, true);
  for (const key of ['questions', 'createQuestion', 'exams', 'curriculum', 'authorization'])
    assert.equal(actual[key], false);
});
void test('giáo viên hệ thống và giáo viên được ủy quyền có các mục điều hướng riêng', () => {
  const teacher = workspacePermissions(
    ['question:create_own', 'question:manage_own', 'exam:manage_own', 'class:create'],
    [],
  );
  assert.equal(teacher.createQuestion, true);
  assert.equal(teacher.questions, true);
  assert.equal(teacher.exams, true);
  assert.equal(teacher.curriculum, false);
  const scoped = workspacePermissions(
    [],
    [{ capabilities: ['class:view', 'assignment:grade', 'assignment:create'] }],
  );
  assert.equal(scoped.assignments, true);
  assert.equal(scoped.createQuestion, false);
  assert.equal(scoped.exams, false);
  assert.equal(scoped.attempts, false);
});
void test('quyền quản lý vai trò và chương trình được xét độc lập, thu hồi quyền ẩn ngay các mục liên quan', () => {
  const admin = workspacePermissions(['platform:moderate', 'role:assign_system'], []);
  assert.equal(admin.curriculum, true);
  assert.equal(admin.authorization, true);
  assert.equal(admin.createQuestion, false);
  const revoked = workspacePermissions([], []);
  assert.ok(Object.values(revoked).every((value) => value === false));
});
void test('chuẩn hóa ngày HTTP lồng nhau, giữ nguyên nội dung và các giá trị rỗng', () => {
  const text = '2026-10-22T00:00:00.000Z';
  const result = reviveApiDates([
    {
      startedAt: text,
      submittedAt: null,
      responses: [{ updatedAt: text, answer: { answer: text } }],
    },
  ]);
  assert.ok(result[0].startedAt instanceof Date);
  assert.equal(result[0].submittedAt, null);
  assert.ok(result[0].responses[0].updatedAt instanceof Date);
  assert.equal(result[0].responses[0].answer.answer, text);
});
void test('chuyển giờ Việt Nam sang thời điểm UTC và hiển thị thống nhất khi kết xuất ở máy chủ', () => {
  assert.equal(toInstant('2026-10-22T08:30'), '2026-10-22T01:30:00.000Z');
  assert.equal(toLocalDateTime('2026-10-22T01:30:00.000Z'), '2026-10-22T08:30');
  assert.equal(toInstant(''), null);
  assert.equal(toInstant(null), null);
  assert.equal(formatDate(null), 'Chưa công bố');
});

void test('quyền chỉ cấp tại bài giao vẫn mở mục bài giao mà không tự mở lớp học', () => {
  const permissions = workspacePermissions([], [], [{ capabilities: ['assignment:grade'] }]);
  assert.equal(permissions.assignments, true);
  assert.equal(permissions.classes, false);
  assert.equal(permissions.questions, false);
});
void test('từ chối thời gian sai định dạng hoặc ngày không tồn tại', () => {
  for (const value of ['2026-02-30T08:30', '2026-13-01T08:30', '2026-10-22T25:30', 'không hợp lệ'])
    assert.equal(toInstant(value), null);
});
