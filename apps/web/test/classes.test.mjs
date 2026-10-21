import assert from 'node:assert/strict';
import test from 'node:test';
import { classesContract } from '@giaokhoa/shared/http/classes';
import {
  canChangeClassMember,
  getClassAccess,
  getClassErrorStatus,
  normalizeClassDates,
} from '../app/routes/classes/classes.ts';

const userId = '01900000-0000-7000-8000-000000000001';
const classId = '01900000-0000-7000-8000-000000000002';
const date = '2026-10-21T09:30:00.000Z';
const responses = [
  {
    schema: classesContract.get.responses[200],
    fields: ['createdAt', 'updatedAt'],
    value: {
      id: classId,
      name: 'Lớp Toán',
      createdByUserId: userId,
      status: 'active',
      joinMode: 'APPROVAL',
      createdAt: date,
      updatedAt: date,
    },
  },
  {
    schema: classesContract.approve.responses[200],
    fields: ['joinedAt', 'updatedAt'],
    value: { userId, status: 'pending', joinedAt: date, updatedAt: date },
  },
  {
    schema: classesContract.createJoinCode.responses[201],
    fields: ['expiresAt'],
    value: { id: classId, code: 'ma-gia-nhap-lop-hop-le', expiresAt: date },
  },
];

void test('Chuẩn hóa đúng các trường ngày của lớp, thành viên và mã mời trước khi kiểm tra hợp đồng', () => {
  for (const { schema, fields, value } of responses) {
    const parsed = schema.parse(normalizeClassDates(value, fields));
    for (const field of fields) {
      assert.ok(parsed[field] instanceof Date);
      assert.equal(parsed[field].toISOString(), date);
      assert.equal(value[field], date);
    }
  }
});

void test('Từ chối ngày null, số và chuỗi không hợp lệ ở từng trường của hợp đồng', () => {
  for (const { schema, fields, value } of responses) {
    for (const field of fields) {
      for (const invalid of [
        null,
        0,
        1792575000000,
        '',
        'không phải ngày',
        '2026-99-99T00:00:00Z',
        '2026-02-30T00:00:00.000Z',
      ]) {
        const normalized = normalizeClassDates({ ...value, [field]: invalid }, fields);
        assert.equal(schema.safeParse(normalized).success, false, field);
      }
    }
  }
});

void test('Giữ trạng thái lỗi HTTP và đổi trạng thái phản hồi bất thường thành lỗi cổng kết nối', () => {
  for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
    assert.equal(getClassErrorStatus(status), status);
  }
  for (const status of [200, 201, 204, 301, 304]) {
    assert.equal(getClassErrorStatus(status), 502);
  }
});

void test('Chỉ đổi trường được yêu cầu và giữ nguyên dữ liệu không phải đối tượng', () => {
  const value = { createdAt: date, expiresAt: date, name: date };
  const normalized = normalizeClassDates(value, ['createdAt']);
  assert.ok(normalized.createdAt instanceof Date);
  assert.equal(normalized.expiresAt, date);
  assert.equal(normalized.name, date);
  for (const unchanged of [null, undefined, 0, date, [value]]) {
    assert.equal(normalizeClassDates(unchanged, ['createdAt']), unchanged);
  }
});

void test('Chỉ giáo viên hoặc quản trị viên tạo lớp và chỉ quản lý lớp do mình tạo', () => {
  for (const role of ['teacher', 'admin']) {
    assert.deepEqual(getClassAccess({ id: userId, role }, userId), {
      canCreate: true,
      canJoin: true,
      isOwner: true,
      canManage: true,
    });
    assert.deepEqual(getClassAccess({ id: userId, role }, classId), {
      canCreate: true,
      canJoin: true,
      isOwner: false,
      canManage: false,
    });
  }
  assert.deepEqual(getClassAccess({ id: userId, role: 'user' }, userId), {
    canCreate: false,
    canJoin: true,
    isOwner: true,
    canManage: false,
  });
});

void test('Tài khoản bị cấm hoặc vai trò chưa được nhận diện không được tạo, tham gia hay quản lý lớp', () => {
  for (const user of [
    { id: userId },
    { id: userId, role: 'unknown' },
    ...['user', 'teacher', 'admin'].map((role) => ({ id: userId, role, banned: true })),
  ]) {
    assert.deepEqual(getClassAccess(user, userId), {
      canCreate: false,
      canJoin: false,
      isOwner: true,
      canManage: false,
    });
  }
});

void test('Chỉ duyệt người chờ trong lớp hoạt động và đình chỉ người chờ hoặc đang học', () => {
  for (const classStatus of ['active', 'archived']) {
    const allowedApprovals = classStatus === 'active' ? ['pending'] : [];
    for (const memberStatus of ['pending', 'active', 'suspended', 'left']) {
      assert.equal(
        canChangeClassMember('approve', classStatus, memberStatus),
        allowedApprovals.includes(memberStatus),
        `Duyệt ${memberStatus} trong lớp ${classStatus}`,
      );
      assert.equal(
        canChangeClassMember('suspend', classStatus, memberStatus),
        ['pending', 'active'].includes(memberStatus),
        `Đình chỉ ${memberStatus} trong lớp ${classStatus}`,
      );
    }
  }
});
