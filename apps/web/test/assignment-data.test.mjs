import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import {
  assignmentDateFields,
  assignmentFieldErrors,
  formatAssignmentDate,
  localDateTimeToIso,
  normalizeDates,
  parseDeliveryContent,
  readAssignmentForm,
  toLocalDateTime,
} from '../app/features/assignments/assignment-data.ts';

const assignmentId = '01900000-0000-7000-8000-000000000001';
const classId = '01900000-0000-7000-8000-000000000002';
const examRevisionId = '01900000-0000-7000-8000-000000000003';
const studentId = '01900000-0000-7000-8000-000000000004';
const openAt = '2026-10-21T01:00:00.000Z';
const closeAt = '2026-10-22T01:00:00.000Z';

function createForm(overrides = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    classId,
    examRevisionId,
    audienceMode: 'ALL_CLASS',
    selectedUserIds: '',
    openAt,
    closeAt,
    maxAttempts: '1',
    releaseScoreAt: '',
    releaseFeedbackAt: '',
    releaseSolutionsAt: '',
    ...overrides,
  }))
    form.set(key, value);
  return form;
}

void test('đổi giờ Việt Nam sang UTC và giữ chính xác giây cùng mili giây khi mở lại', () => {
  const previousZone = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Ho_Chi_Minh';
    assert.equal(localDateTimeToIso('2026-10-21T08:00'), openAt);
    assert.equal(localDateTimeToIso('2026-10-21T08:00:12.345'), '2026-10-21T01:00:12.345Z');
    assert.equal(toLocalDateTime('2026-10-21T01:00:12.345Z'), '2026-10-21T08:00:12.345');
    assert.equal(localDateTimeToIso(toLocalDateTime(openAt)), openAt);
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

void test('dùng độ lệch múi giờ của ngày được chọn và từ chối giờ không tồn tại', () => {
  const previousZone = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(localDateTimeToIso('2026-01-21T08:00'), '2026-01-21T13:00:00.000Z');
    assert.equal(localDateTimeToIso('2026-07-21T08:00'), '2026-07-21T12:00:00.000Z');
    for (const value of ['', '2026-02-30T08:00', '2026-03-08T02:30', openAt, 'không phải ngày']) {
      assert.equal(localDateTimeToIso(value), undefined, value);
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

void test('đọc cấu hình theo hợp đồng, lịch công bố trống thành null và giữ lịch công bố đã nhập', () => {
  const result = readAssignmentForm(createForm({ releaseScoreAt: closeAt }));
  assert.equal(result.success, true);
  assert.equal(result.data.maxAttempts, 1);
  assert.deepEqual(result.data.selectedUserIds, []);
  assert.equal(result.data.releaseScoreAt, closeAt);
  assert.equal(result.data.releaseFeedbackAt, null);
  assert.equal(result.data.releaseSolutionsAt, null);
  const selected = readAssignmentForm(
    createForm({
      audienceMode: 'SELECTED_USERS',
      selectedUserIds: ` ${studentId},\n${assignmentId} `,
    }),
  );
  assert.equal(selected.success, true);
  assert.deepEqual(selected.data.selectedUserIds, [studentId, assignmentId]);
});

void test('từ chối cấu hình sai trước khi gọi API và có thông báo tiếng Việt theo trường', () => {
  for (const overrides of [
    { classId: 'sai' },
    { examRevisionId: 'sai' },
    { audienceMode: 'sai' },
    { closeAt: openAt },
    { openAt: closeAt, closeAt: openAt },
    { openAt: '2026-10-21T08:00' },
    { maxAttempts: '' },
    { maxAttempts: '0' },
    { maxAttempts: '101' },
    { maxAttempts: '1.5' },
    { audienceMode: 'SELECTED_USERS' },
    { selectedUserIds: studentId },
    { audienceMode: 'SELECTED_USERS', selectedUserIds: 'sai' },
    { audienceMode: 'SELECTED_USERS', selectedUserIds: `${studentId},${studentId}` },
    { audienceMode: 'SELECTED_USERS', selectedUserIds: Array(5001).fill(studentId).join(',') },
    { releaseSolutionsAt: 'không phải ngày' },
  ]) {
    const result = readAssignmentForm(createForm(overrides));
    assert.equal(result.success, false, JSON.stringify(overrides));
    assert.ok(
      Object.values(assignmentFieldErrors(result.error.issues)).every((message) =>
        /[À-ỹ]/u.test(message),
      ),
    );
  }
});

const assignment = {
  id: assignmentId,
  classId,
  examRevisionId,
  createdByUserId: studentId,
  audienceMode: 'ALL_CLASS',
  selectedUserIds: [],
  status: 'draft',
  openAt,
  closeAt,
  maxAttempts: 1,
  releaseScoreAt: null,
  releaseFeedbackAt: closeAt,
  releaseSolutionsAt: null,
  createdAt: openAt,
  publishedAt: null,
};

void test('chuẩn hóa đủ ngày JSON của bài giao, giữ nguyên null và từ chối ngày sai kiểu', () => {
  const result = assignmentsContract.get.responses[200].parse(
    normalizeDates(assignment, assignmentDateFields),
  );
  assert.equal(result.openAt.toISOString(), openAt);
  assert.equal(result.releaseFeedbackAt.toISOString(), closeAt);
  assert.equal(result.publishedAt, null);
  assert.equal(result.releaseScoreAt, null);
  assert.equal(assignment.openAt, openAt);
  for (const value of [null, undefined, '', 'không phải ngày', '2026-10-21', 42]) {
    assert.equal(
      assignmentsContract.get.responses[200].safeParse(
        normalizeDates({ ...assignment, openAt: value }, assignmentDateFields),
      ).success,
      false,
    );
  }
  assert.match(formatAssignmentDate(result.openAt), /UTC$/);
});

void test('kiểm tra toàn bộ cấu hình khi sửa và giữ lớp cùng phiên bản đề từ API', () => {
  const current = assignmentsContract.get.responses[200].parse(
    normalizeDates(assignment, assignmentDateFields),
  );
  const parsed = readAssignmentForm(
    createForm({ classId: 'giả mạo', examRevisionId: 'giả mạo' }),
    current,
  );
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.classId, classId);
  assert.equal(parsed.data.examRevisionId, examRevisionId);
  assert.equal(readAssignmentForm(createForm({ closeAt: openAt }), current).success, false);
});

void test('khôi phục ngày người nhận và đề nhận bài đúng trường, giữ nguyên nội dung câu hỏi', () => {
  const recipient = {
    userId: studentId,
    status: 'active',
    source: 'all_class',
    assignedAt: openAt,
    revokedAt: null,
  };
  assert.equal(
    assignmentsContract.recipients.responses[200]
      .parse([normalizeDates(recipient, ['assignedAt', 'revokedAt'])])[0]
      .assignedAt.toISOString(),
    openAt,
  );
  const content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: openAt }] }],
  };
  const delivery = {
    assignmentId,
    examRevisionId,
    title: 'Đề kiểm tra',
    openAt,
    closeAt,
    maxAttempts: 1,
    questions: [
      {
        position: 1,
        question: { id: studentId, version: 1, type: 'short_answer', content, stimulus: null },
      },
    ],
  };
  const normalized = normalizeDates(delivery, ['openAt', 'closeAt']);
  const parsed = assignmentsContract.delivery.responses[200].parse(normalized);
  assert.equal(parsed.openAt.toISOString(), openAt);
  assert.equal(normalized.questions, delivery.questions);
  assert.deepEqual(parsed.questions[0].question.content, content);
  assert.equal(parseDeliveryContent('short_answer', content).success, true);
  for (const value of [
    null,
    'văn bản chưa chuẩn hóa',
    { ...content, solution: 'bí mật' },
    { ...content, answer: 'bí mật' },
    { ...content, guidance: 'bí mật' },
  ]) {
    assert.equal(parseDeliveryContent('short_answer', value).success, false);
  }
});
