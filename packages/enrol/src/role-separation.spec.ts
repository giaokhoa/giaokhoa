import { describe, expect, it } from 'vitest';
import { RoleContextConflictError } from './errors';
import { RoleSeparationCore } from './role-separation';
import { FakeEnrolDb, runInPlatformScope } from './test-support/fake-db';

/**
 * Ghim bất biến TÁCH VAI (quyết định đã chốt, xem README của package):
 * trong một khoá, tài khoản hoặc là giáo viên hoặc là học viên,
 * không bao giờ cả hai; dạy ở khoá này và học ở khoá khác là hợp lệ.
 * Hai kiểm nền được kiểm trực tiếp — (a) cấp quyền giảng dạy bao phủ
 * khoá (loại trừ gán do ghi danh cấp và cấp ở context hệ thống),
 * (b) ghi danh học viên đang hoạt động — cùng hai chốt gọi về chúng
 * và báo cáo kiểm toán chỉ-đọc phân loại cùng-khoá/khác-khoá.
 */

const COURSE_1 = 'd5b9e43f-0a6f-5e7d-b084-3c2d4e5f6a7b';
const COURSE_2 = 'e6c0f54a-1b7a-6f8e-c195-4d3e5f6a7b8c';
const CLASS_ID = 'f7d1a65b-2c8b-7a9f-d2a6-5e4f6a7b8c9d';
const OTHER_CLASS_ID = 'a8e2b76c-3d9c-8b0a-e3b7-6f5a7b8c9d0e';
const COHORT_ID = 'b9f3c87d-4e0d-9c1b-f4c8-7a6b8c9d0e1f';
const USER_A = 'b3f7c21d-8a4e-4c5d-9e62-1f0a2b3c4d5e';
const USER_B = 'c4a8d32e-9b5f-4d6e-af73-2a1b3c4d5e6f';
const USER_C = 'd5b9e43f-0a6f-5e7d-b084-3c2d4e5f6a7b';
const USER_D = 'e6c0f54a-1b7a-6f8e-c195-4d3e5f6a7b8c';
const SYS_CTX_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_CTX_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_CTX_ID = '33333333-3333-4333-8333-333333333333';
const COURSE_1_CTX_ID = '44444444-4444-4444-8444-444444444444';
const COURSE_2_CTX_ID = '55555555-5555-4555-8555-555555555555';
const ROLE_TEACHER = 'role-teacher';
const ROLE_EDITING_TEACHER = 'role-editingteacher';
const ROLE_STUDENT = 'role-student';

function createCore(db: FakeEnrolDb): RoleSeparationCore {
  return new RoleSeparationCore(db.handle, runInPlatformScope);
}

/** Cây context giả: hệ thống → tenant → lớp → khoá học (hai khoá). */
function seedContextTree(db: FakeEnrolDb): void {
  db.seed('context', [
    { id: SYS_CTX_ID, context_level: 10, instance_id: null, path: `/${SYS_CTX_ID}`, depth: 1, locked: false, version: 1 },
    { id: TENANT_CTX_ID, context_level: 20, instance_id: 'tenant-1', path: `/${SYS_CTX_ID}/${TENANT_CTX_ID}`, depth: 2, locked: false, version: 1 },
    { id: CLASS_CTX_ID, context_level: 45, instance_id: CLASS_ID, path: `/${SYS_CTX_ID}/${TENANT_CTX_ID}/${CLASS_CTX_ID}`, depth: 3, locked: false, version: 1 },
    { id: COURSE_1_CTX_ID, context_level: 50, instance_id: COURSE_1, path: `/${SYS_CTX_ID}/${TENANT_CTX_ID}/${CLASS_CTX_ID}/${COURSE_1_CTX_ID}`, depth: 4, locked: false, version: 1 },
    { id: COURSE_2_CTX_ID, context_level: 50, instance_id: COURSE_2, path: `/${SYS_CTX_ID}/${TENANT_CTX_ID}/${CLASS_CTX_ID}/${COURSE_2_CTX_ID}`, depth: 4, locked: false, version: 1 },
  ]);
}

/** Ba vai mẫu: hai archetype giảng dạy và một archetype học viên. */
function seedRoles(db: FakeEnrolDb): void {
  db.seed('role', [
    { id: ROLE_TEACHER, name: 'Teacher', short_name: 'teacher', description: '', sort_order: 1, archetype: 'teacher' },
    { id: ROLE_EDITING_TEACHER, name: 'Editing teacher', short_name: 'editingteacher', description: '', sort_order: 2, archetype: 'editingteacher' },
    { id: ROLE_STUDENT, name: 'Student', short_name: 'student', description: '', sort_order: 3, archetype: 'student' },
  ]);
}

/** Một dòng gán vai (khoá snake_case như database). */
function assignment(id: string, userId: string, roleId: string, contextId: string, component = ''): Record<string, unknown> {
  return { id, role_id: roleId, user_id: userId, context_id: contextId, component, item_id: null };
}

/** Một enrol instance của một khoá, cấp kèm một vai (khoá snake_case như database). */
function enrolInstance(id: string, courseId: string, roleId: string | null, enrol = 'manual', customInt1: string | null = null): Record<string, unknown> {
  return { id, course_id: courseId, enrol, role_id: roleId, status: 0, custom_int1: customInt1 };
}

/** Một dòng ghi danh của một người dùng qua một instance. */
function userEnrolment(id: string, enrolId: string, userId: string, status: number): Record<string, unknown> {
  return { id, enrol_id: enrolId, user_id: userId, status };
}

describe('RoleSeparationCore — vai cấp kèm của instance có phải vai học viên', () => {
  it('instance không cấp vai nào: tính là ghi danh học viên', async () => {
    const db = new FakeEnrolDb();

    expect(await createCore(db).isLearnerGrantRole(null)).toBe(true);
    // Không cần truy vấn nào khi vai vắng mặt.
    expect(db.log).toHaveLength(0);
  });

  it('vai archetype student: là vai học viên', async () => {
    const db = new FakeEnrolDb();
    seedRoles(db);

    expect(await createCore(db).isLearnerGrantRole(ROLE_STUDENT)).toBe(true);
  });

  it('vai archetype teacher: KHÔNG phải vai học viên', async () => {
    const db = new FakeEnrolDb();
    seedRoles(db);

    expect(await createCore(db).isLearnerGrantRole(ROLE_TEACHER)).toBe(false);
  });

  it('vai archetype editingteacher: KHÔNG phải vai học viên', async () => {
    const db = new FakeEnrolDb();
    seedRoles(db);

    expect(await createCore(db).isLearnerGrantRole(ROLE_EDITING_TEACHER)).toBe(false);
  });

  it('vai không tồn tại: tính là vai học viên (không có archetype giảng dạy nào)', async () => {
    const db = new FakeEnrolDb();
    seedRoles(db);

    expect(await createCore(db).isLearnerGrantRole('role-khong-ton-tai')).toBe(true);
  });
});

describe('RoleSeparationCore — kiểm (b): ghi danh học viên đang hoạt động', () => {
  it('ghi danh đang hoạt động qua instance cấp vai học viên: kiểm dương tính', async () => {
    const db = new FakeEnrolDb();
    seedRoles(db);
    db.seed('enrol', [enrolInstance('enrol-1', COURSE_1, ROLE_STUDENT)]);
    db.seed('user_enrolments', [userEnrolment('ue-1', 'enrol-1', USER_A, 0)]);

    expect(await createCore(db).hasActiveLearnerEnrolment(USER_A, COURSE_1)).toBe(true);
  });

  it('ghi danh đã đình chỉ (status 1): kiểm âm tính', async () => {
    const db = new FakeEnrolDb();
    seedRoles(db);
    db.seed('enrol', [enrolInstance('enrol-1', COURSE_1, ROLE_STUDENT)]);
    db.seed('user_enrolments', [userEnrolment('ue-1', 'enrol-1', USER_A, 1)]);

    expect(await createCore(db).hasActiveLearnerEnrolment(USER_A, COURSE_1)).toBe(false);
  });

  it('ghi danh đang hoạt động qua instance cấp vai giảng dạy: KHÔNG tính là ghi danh học viên', async () => {
    const db = new FakeEnrolDb();
    seedRoles(db);
    db.seed('enrol', [enrolInstance('enrol-1', COURSE_1, ROLE_TEACHER)]);
    db.seed('user_enrolments', [userEnrolment('ue-1', 'enrol-1', USER_A, 0)]);

    expect(await createCore(db).hasActiveLearnerEnrolment(USER_A, COURSE_1)).toBe(false);
  });

  it('ghi danh đang hoạt động ở khoá khác: kiểm âm tính với khoá đích', async () => {
    const db = new FakeEnrolDb();
    seedRoles(db);
    db.seed('enrol', [enrolInstance('enrol-1', COURSE_2, ROLE_STUDENT)]);
    db.seed('user_enrolments', [userEnrolment('ue-1', 'enrol-1', USER_A, 0)]);

    expect(await createCore(db).hasActiveLearnerEnrolment(USER_A, COURSE_1)).toBe(false);
  });

  it('instance không cấp vai nào: ghi danh đang hoạt động vẫn tính là ghi danh học viên', async () => {
    const db = new FakeEnrolDb();
    seedRoles(db);
    db.seed('enrol', [enrolInstance('enrol-1', COURSE_1, null)]);
    db.seed('user_enrolments', [userEnrolment('ue-1', 'enrol-1', USER_A, 0)]);

    expect(await createCore(db).hasActiveLearnerEnrolment(USER_A, COURSE_1)).toBe(true);
  });
});

describe('RoleSeparationCore — chốt ghi danh học viên (kiểm (a))', () => {
  it('người đã có gán vai giảng dạy bao phủ khoá: ghi danh học viên bị chặn bằng lỗi xung đột vai', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);
    db.seed('role_assignments', [assignment('asg-a', USER_A, ROLE_TEACHER, COURSE_1_CTX_ID)]);

    let caught: unknown;
    try {
      await createCore(db).assertLearnerEnrolmentAllowed(USER_A, COURSE_1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RoleContextConflictError);
    expect((caught as RoleContextConflictError).code).toBe('access.role_context_conflict');
  });

  it('gán vai giảng dạy ở lớp chứa khoá cũng bao phủ khoá: ghi danh học viên bị chặn', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);
    db.seed('role_assignments', [assignment('asg-a', USER_A, ROLE_EDITING_TEACHER, CLASS_CTX_ID)]);

    await expect(createCore(db).assertLearnerEnrolmentAllowed(USER_A, COURSE_1)).rejects.toBeInstanceOf(RoleContextConflictError);
  });

  it('gán vai giảng dạy do ghi danh cấp (component enrol): KHÔNG tính vào kiểm (a), ghi danh được phép', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);
    db.seed('role_assignments', [assignment('asg-a', USER_A, ROLE_TEACHER, COURSE_1_CTX_ID, 'enrol')]);

    await expect(createCore(db).assertLearnerEnrolmentAllowed(USER_A, COURSE_1)).resolves.toBeUndefined();
  });

  it('gán vai giảng dạy chỉ ở context hệ thống: KHÔNG tính vào kiểm (a), ghi danh được phép', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);
    db.seed('role_assignments', [assignment('asg-a', USER_A, ROLE_TEACHER, SYS_CTX_ID)]);

    await expect(createCore(db).assertLearnerEnrolmentAllowed(USER_A, COURSE_1)).resolves.toBeUndefined();
  });

  it('người không có gán vai giảng dạy nào: ghi danh được phép', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);

    await expect(createCore(db).assertLearnerEnrolmentAllowed(USER_A, COURSE_1)).resolves.toBeUndefined();
  });
});

describe('RoleSeparationCore — các khoá bị bao phủ và khoá do cohort cấp', () => {
  it('context khoá bao phủ đúng khoá của nó', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);

    expect(await createCore(db).coveredCoursesForContext(COURSE_1_CTX_ID)).toEqual([COURSE_1]);
  });

  it('context lớp bao phủ mọi khoá thuộc lớp, không bao phủ khoá lớp khác', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    db.seed('course', [
      { id: COURSE_1, class_id: CLASS_ID },
      { id: COURSE_2, class_id: CLASS_ID },
      { id: 'course-khac', class_id: OTHER_CLASS_ID },
    ]);

    const covered = await createCore(db).coveredCoursesForContext(CLASS_CTX_ID);
    expect([...covered].sort()).toEqual([COURSE_1, COURSE_2].sort());
  });

  it('context tenant không thuộc phạm vi chốt chiều ngược: bao phủ rỗng', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);

    expect(await createCore(db).coveredCoursesForContext(TENANT_CTX_ID)).toEqual([]);
  });

  it('cohort cấp học viên vào khoá qua cả instance cohort và lớp nền, hợp nhất không trùng', async () => {
    const db = new FakeEnrolDb();
    db.seed('enrol', [
      enrolInstance('enrol-1', COURSE_1, ROLE_STUDENT, 'cohort', COHORT_ID),
      enrolInstance('enrol-2', COURSE_2, ROLE_STUDENT, 'cohort', COHORT_ID),
      enrolInstance('enrol-3', COURSE_1, ROLE_STUDENT, 'manual'),
    ]);
    db.seed('course', [
      { id: COURSE_1, class_id: CLASS_ID },
      { id: COURSE_2, class_id: CLASS_ID },
    ]);
    db.seed('classes', [{ id: CLASS_ID, cohort_id: COHORT_ID }]);

    const courses = await createCore(db).coursesFedByCohort(COHORT_ID);
    expect([...courses].sort()).toEqual([COURSE_1, COURSE_2].sort());
  });
});

describe('RoleSeparationCore — chốt thêm thành viên cohort và chốt chiều ngược', () => {
  it('thêm vào cohort mà người dùng đang dạy một khoá do cohort cấp: bị chặn bằng lỗi xung đột vai', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);
    db.seed('enrol', [enrolInstance('enrol-1', COURSE_1, ROLE_STUDENT, 'cohort', COHORT_ID)]);
    db.seed('course', [{ id: COURSE_1, class_id: CLASS_ID }]);
    db.seed('classes', [{ id: CLASS_ID, cohort_id: COHORT_ID }]);
    db.seed('role_assignments', [assignment('asg-a', USER_A, ROLE_TEACHER, COURSE_1_CTX_ID)]);

    await expect(createCore(db).assertCohortMembershipAllowed(USER_A, COHORT_ID)).rejects.toBeInstanceOf(RoleContextConflictError);
  });

  it('gán vai giảng dạy cho người đang là học viên đang hoạt động trong khoá bị bao phủ: bị chặn (chốt chiều ngược)', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);
    db.seed('course', [
      { id: COURSE_1, class_id: CLASS_ID },
      { id: COURSE_2, class_id: CLASS_ID },
    ]);
    db.seed('enrol', [enrolInstance('enrol-1', COURSE_2, ROLE_STUDENT)]);
    db.seed('user_enrolments', [userEnrolment('ue-1', 'enrol-1', USER_A, 0)]);

    await expect(createCore(db).assertTeachingAssignmentAllowed(USER_A, CLASS_CTX_ID)).rejects.toBeInstanceOf(RoleContextConflictError);
  });

  it('gán vai giảng dạy cho người không học ở khoá nào bị bao phủ: được phép', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);
    db.seed('course', [{ id: COURSE_1, class_id: CLASS_ID }]);

    await expect(createCore(db).assertTeachingAssignmentAllowed(USER_A, CLASS_CTX_ID)).resolves.toBeUndefined();
  });
});

describe('RoleSeparationCore — kiểm toán tách vai', () => {
  it('phân loại đúng nhóm cùng khoá (vi phạm) và nhóm khác khoá (hợp lệ), bỏ qua người chỉ dạy hoặc chỉ học', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);
    db.seed('enrol', [
      enrolInstance('enrol-1', COURSE_1, ROLE_STUDENT),
      enrolInstance('enrol-2', COURSE_2, ROLE_STUDENT),
    ]);
    db.seed('user_enrolments', [
      userEnrolment('ue-a', 'enrol-1', USER_A, 0),
      userEnrolment('ue-b', 'enrol-2', USER_B, 0),
      userEnrolment('ue-d', 'enrol-1', USER_D, 0),
    ]);
    db.seed('role_assignments', [
      assignment('asg-a', USER_A, ROLE_TEACHER, COURSE_1_CTX_ID),
      assignment('asg-b', USER_B, ROLE_TEACHER, COURSE_1_CTX_ID),
      assignment('asg-c', USER_C, ROLE_TEACHER, COURSE_1_CTX_ID),
    ]);
    db.seed('users', [
      { id: USER_A, username: 'an', email: 'an@example.test' },
      { id: USER_B, username: 'binh', email: 'binh@example.test' },
      { id: USER_C, username: 'cuong', email: 'cuong@example.test' },
      { id: USER_D, username: 'dung', email: 'dung@example.test' },
    ]);

    const report = await createCore(db).auditRoleConflicts();

    expect(report.sameCourse).toEqual([
      { userId: USER_A, username: 'an', email: 'an@example.test', conflictingCourseIds: [COURSE_1], teachingOnlyCourseCount: 0, learnerOnlyCourseCount: 0 },
    ]);
    expect(report.crossCourse).toEqual([
      { userId: USER_B, username: 'binh', email: 'binh@example.test', conflictingCourseIds: [], teachingOnlyCourseCount: 1, learnerOnlyCourseCount: 1 },
    ]);
  });

  it('không có ai vừa dạy vừa học: báo cáo rỗng cả hai nhóm', async () => {
    const db = new FakeEnrolDb();
    seedContextTree(db);
    seedRoles(db);
    db.seed('role_assignments', [assignment('asg-c', USER_C, ROLE_TEACHER, COURSE_1_CTX_ID)]);

    expect(await createCore(db).auditRoleConflicts()).toEqual({ sameCourse: [], crossCourse: [] });
  });
});
