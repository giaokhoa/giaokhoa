import { describe, expect, it } from 'vitest';
import { CohortMaterializationSurface } from './cohort-materialization';
import { ENROL_ACTIVE, ENROL_SUSPENDED, ENROL_WITHDRAWN } from './enrol-status';
import { SharedDomainError } from './errors';
import { FakeEnrolDb, FakeOutbox, runInPlatformScope } from './test-support/fake-db';
import type { EnrolInstanceRow } from './types';

/**
 * Ghim funnel ghi danh/gỡ ghi danh lõi và hai điểm vào vật chất hoá
 * cohort của `CohortMaterializationSurface` (quyết định đã chốt, xem
 * README của package): chốt tách vai áp trước khi tạo bản ghi; dòng
 * ghi danh mới và sự kiện `user_enrolled` nằm trong cùng một
 * transaction; đua ghi đồng thời nối vào đường cập nhật idempotent;
 * gỡ ghi danh giữ dòng dạng WITHDRAWN khi còn dữ liệu liên quan,
 * xoá cứng khi không còn, và phát cả `user_unenrolled` lẫn
 * `course_completion_reaggregation_requested` trong cùng transaction
 * với thao tác gỡ; vật chất hoá neo vào trạng thái hiện tại của
 * `cohort_members`.
 *
 * Các ca cần database thật (slot gói trung tâm, gán vai giảng dạy
 * qua điểm chặn slot) do các suite integration của app ghim; ở đây
 * chỉ dùng vai học viên (không chạm điểm chặn slot) và vai null.
 */

const COURSE_ID = 'd5b9e43f-0a6f-5e7d-b084-3c2d4e5f6a7b';
const TENANT_ID = '9a7b4d2e-5f36-4a1e-b28c-3d5e7f90a1b2';
const USER_ID = 'b3f7c21d-8a4e-4c5d-9e62-1f0a2b3c4d5e';
const COHORT_ID = 'b9f3c87d-4e0d-9c1b-f4c8-7a6b8c9d0e1f';
const INSTANCE_ID = 'c4a8d32e-9b5f-4d6e-af73-2a1b3c4d5e6f';
const SYS_CTX_ID = '11111111-1111-4111-8111-111111111111';
const COURSE_CTX_ID = '33333333-3333-4333-8333-333333333333';
const ROLE_STUDENT = 'role-student';

function createSurface(db: FakeEnrolDb, outbox: FakeOutbox): CohortMaterializationSurface {
  return new CohortMaterializationSurface({ db: db.handle, outbox, runInPlatformScope });
}

/** Một enrol instance cohort đầy đủ trường (ghi đè qua tham số). */
function makeInstance(overrides: Partial<EnrolInstanceRow> = {}): EnrolInstanceRow {
  return {
    id: INSTANCE_ID,
    courseId: COURSE_ID,
    enrol: 'cohort',
    name: null,
    roleId: null,
    status: ENROL_ACTIVE,
    enrolPeriod: 0,
    timeStart: null,
    timeEnd: null,
    enrolmentKey: null,
    customInt1: COHORT_ID,
    customInt2: null,
    customText1: '',
    cost: 0,
    currency: 'VND',
    paymentAccountId: null,
    sendWelcomeMessage: false,
    welcomeMessage: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Khoá của instance đích (dòng `course` cần cho funnel đảm bảo membership tenant). */
function seedCourse(db: FakeEnrolDb): void {
  db.seed('course', [{ id: COURSE_ID, tenant_id: TENANT_ID }]);
}

/** Một dòng ghi danh hiện hữu (khoá snake_case như database). */
function seedUserEnrolment(db: FakeEnrolDb, status: number): void {
  db.seed('user_enrolments', [{
    id: 'ue-1',
    enrol_id: INSTANCE_ID,
    user_id: USER_ID,
    status,
    time_start: new Date('2026-01-01T00:00:00Z'),
    time_end: null,
    modifier_id: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  }]);
}

/** Dữ liệu hoàn thành của người dùng trong khoá (để gỡ ghi danh giữ dòng). */
function seedCompletionData(db: FakeEnrolDb): void {
  db.seed('course_modules', [{ id: 'module-1', course: COURSE_ID, deletion_in_progress: false }]);
  db.seed('course_modules_completion', [{ id: 'cmc-1', user_id: USER_ID, course_module_id: 'module-1' }]);
}

describe('CohortMaterializationSurface — ghi danh lõi (enrolUserInternal)', () => {
  it('instance đã tắt: ném lỗi enrol.instance_disabled, không tạo bản ghi nào', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();

    let caught: unknown;
    try {
      await createSurface(db, outbox).enrolUserInternal(makeInstance({ status: 1 }), USER_ID);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SharedDomainError);
    expect((caught as SharedDomainError).code).toBe('enrol.instance_disabled');
    expect(db.rows('user_enrolments')).toHaveLength(0);
    expect(outbox.events).toHaveLength(0);
  });

  it('ghi danh mới: chèn dòng active, phát user_enrolled trong cùng transaction, đảm bảo membership tenant', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedCourse(db);

    const result = await createSurface(db, outbox).enrolUserInternal(makeInstance(), USER_ID);

    expect(result.isNewEnrolment).toBe(true);
    expect(result.userEnrolment.status).toBe(ENROL_ACTIVE);
    expect(result.userEnrolment.enrolId).toBe(INSTANCE_ID);
    expect(result.userEnrolment.userId).toBe(USER_ID);
    expect(db.rows('user_enrolments')).toHaveLength(1);
    expect(outbox.events).toHaveLength(1);
    const event = outbox.events[0]!;
    expect(event.standalone).toBe(false);
    expect(event.input).toEqual({
      aggregate: 'enrol',
      type: 'user_enrolled',
      payload: { courseId: COURSE_ID, userId: USER_ID, instanceId: INSTANCE_ID, method: 'cohort', actorId: null },
    });
    // Sự kiện được ghi bằng handle transaction, không phải handle ngoài.
    expect(event.tx).not.toBe(db.handle);
    expect(event.tx).not.toBeNull();
    expect(db.rows('tenant_memberships')).toHaveLength(1);
    expect(db.rows('tenant_memberships')[0]!.status).toBe('active');
  });

  it('đã có ghi danh bị đình chỉ: kích hoạt lại thành active, KHÔNG phát user_enrolled lần nữa', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedCourse(db);
    seedUserEnrolment(db, ENROL_SUSPENDED);

    const result = await createSurface(db, outbox).enrolUserInternal(makeInstance(), USER_ID);

    expect(result.isNewEnrolment).toBe(false);
    expect(result.userEnrolment.status).toBe(ENROL_ACTIVE);
    expect(db.rows('user_enrolments')).toHaveLength(1);
    expect(db.rows('user_enrolments')[0]!.status).toBe(ENROL_ACTIVE);
    expect(outbox.events).toHaveLength(0);
  });

  it('đua ghi đồng thời (phía thắng chèn trước): phía thua nối vào đường cập nhật, không ném lỗi, chỉ có một dòng', async () => {
    const winner = {
      id: 'ue-thang',
      enrol_id: INSTANCE_ID,
      user_id: USER_ID,
      status: ENROL_SUSPENDED,
      time_start: new Date('2026-01-01T00:00:00Z'),
      time_end: null,
      modifier_id: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    };
    let planted = false;
    const db = new FakeEnrolDb({
      beforeInsert: (fake, table, values) => {
        // Mô phỏng phía ghi đồng thời: chèn dòng thắng ngay trước lần chèn thật để lần chèn thật ăn 23505.
        if (table === 'user_enrolments' && !planted && values.enrol_id === INSTANCE_ID) {
          planted = true;
          fake.seed('user_enrolments', [winner]);
        }
      },
    });
    const outbox = new FakeOutbox();
    seedCourse(db);

    const result = await createSurface(db, outbox).enrolUserInternal(makeInstance(), USER_ID);

    expect(result.isNewEnrolment).toBe(false);
    expect(result.userEnrolment.id).toBe('ue-thang');
    expect(result.userEnrolment.status).toBe(ENROL_ACTIVE);
    expect(db.rows('user_enrolments')).toHaveLength(1);
    // Phía thua không phát user_enrolled (phía thắng đã phát).
    expect(outbox.events).toHaveLength(0);
  });

  it('instance cấp vai học viên: cấp đúng dòng gán mang truy vết của instance và phát role_assigned', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedCourse(db);
    db.seed('context', [
      { id: SYS_CTX_ID, context_level: 10, instance_id: null, path: `/${SYS_CTX_ID}`, depth: 1, locked: false, version: 1 },
      { id: COURSE_CTX_ID, context_level: 50, instance_id: COURSE_ID, path: `/${SYS_CTX_ID}/${COURSE_CTX_ID}`, depth: 2, locked: false, version: 1 },
    ]);
    db.seed('role', [{ id: ROLE_STUDENT, name: 'Student', short_name: 'student', description: '', sort_order: 1, archetype: 'student' }]);

    const result = await createSurface(db, outbox).enrolUserInternal(makeInstance({ roleId: ROLE_STUDENT }), USER_ID);

    expect(result.isNewEnrolment).toBe(true);
    expect(db.rows('role_assignments')).toHaveLength(1);
    const assignment = db.rows('role_assignments')[0]!;
    expect(assignment.role_id).toBe(ROLE_STUDENT);
    expect(assignment.user_id).toBe(USER_ID);
    expect(assignment.context_id).toBe(COURSE_CTX_ID);
    expect(assignment.component).toBe('enrol');
    expect(assignment.item_id).toBe(INSTANCE_ID);
    const roleAssigned = outbox.events.find((event) => event.input.type === 'role_assigned');
    expect(roleAssigned).toBeDefined();
    expect(roleAssigned!.standalone).toBe(true);
  });
});

describe('CohortMaterializationSurface — gỡ ghi danh lõi (unenrolInternal)', () => {
  it('chưa từng ghi danh: trả withdrawn false, không làm gì', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();

    expect(await createSurface(db, outbox).unenrolInternal(makeInstance(), USER_ID)).toEqual({ withdrawn: false });
    expect(outbox.events).toHaveLength(0);
  });

  it('còn dữ liệu hoàn thành: giữ dòng dạng WITHDRAWN và phát cả hai sự kiện trong cùng transaction', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedUserEnrolment(db, ENROL_ACTIVE);
    seedCompletionData(db);

    expect(await createSurface(db, outbox).unenrolInternal(makeInstance(), USER_ID)).toEqual({ withdrawn: true });
    expect(db.rows('user_enrolments')).toHaveLength(1);
    expect(db.rows('user_enrolments')[0]!.status).toBe(ENROL_WITHDRAWN);
    expect(outbox.events).toHaveLength(2);
    expect(outbox.events[0]!.input.type).toBe('user_unenrolled');
    expect(outbox.events[0]!.input.payload).toEqual({ courseId: COURSE_ID, userId: USER_ID, instanceId: INSTANCE_ID, keptData: true, actorId: null });
    expect(outbox.events[1]!.input.type).toBe('course_completion_reaggregation_requested');
    expect(outbox.events[1]!.input.payload).toEqual({ courseId: COURSE_ID, userId: USER_ID });
    // Cả hai sự kiện ghi bằng cùng một handle transaction với thao tác gỡ.
    expect(outbox.events[0]!.tx).not.toBe(db.handle);
    expect(outbox.events[0]!.tx).toBe(outbox.events[1]!.tx);
  });

  it('không còn dữ liệu liên quan: xoá cứng dòng và phát user_unenrolled với keptData false', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedUserEnrolment(db, ENROL_ACTIVE);

    expect(await createSurface(db, outbox).unenrolInternal(makeInstance(), USER_ID)).toEqual({ withdrawn: false });
    expect(db.rows('user_enrolments')).toHaveLength(0);
    expect(outbox.events).toHaveLength(2);
    expect(outbox.events[0]!.input.payload).toEqual({ courseId: COURSE_ID, userId: USER_ID, instanceId: INSTANCE_ID, keptData: false, actorId: null });
    expect(outbox.events[1]!.input.type).toBe('course_completion_reaggregation_requested');
  });
});

describe('CohortMaterializationSurface — liệt kê instance cohort (C-E3)', () => {
  it('chỉ trả instance cohort của đúng cohort (lọc theo custom_int1 ngay trong truy vấn)', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    db.seed('enrol', [
      { id: 'inst-1', course_id: COURSE_ID, enrol: 'cohort', custom_int1: COHORT_ID },
      { id: 'inst-2', course_id: COURSE_ID, enrol: 'cohort', custom_int1: COHORT_ID },
      { id: 'inst-3', course_id: COURSE_ID, enrol: 'cohort', custom_int1: 'cohort-khac' },
      { id: 'inst-4', course_id: COURSE_ID, enrol: 'manual', custom_int1: COHORT_ID },
      { id: 'inst-5', course_id: COURSE_ID, enrol: 'cohort', custom_int1: null },
    ]);

    const rows = await createSurface(db, outbox).listCohortInstances(COHORT_ID);

    expect(rows.map((row) => row.id).sort()).toEqual(['inst-1', 'inst-2']);
    // Truy vấn mang điều kiện custom_int1 = cohortId (không tải toàn bộ instance rồi lọc bằng JS).
    const selects = db.selects('enrol');
    expect(selects).toHaveLength(1);
    expect(selects[0]!.whereColumns).toContain('enrol.enrol');
    expect(selects[0]!.whereColumns).toContain('enrol.custom_int1');
  });
});

describe('CohortMaterializationSurface — vật chất hoá theo sự kiện thành viên', () => {
  it('sự kiện thêm thành viên nhưng người dùng hiện không còn trong cohort: không ghi danh', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedCourse(db);

    await createSurface(db, outbox).materializeCohortMemberAdded({ cohortId: COHORT_ID, userId: USER_ID });

    expect(db.rows('user_enrolments')).toHaveLength(0);
    expect(outbox.events).toHaveLength(0);
  });

  it('thành viên mới vào cohort nhưng instance đã tắt: không ghi danh', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedCourse(db);
    db.seed('cohort_members', [{ cohort_id: COHORT_ID, user_id: USER_ID }]);
    db.seed('enrol', [{ id: INSTANCE_ID, course_id: COURSE_ID, enrol: 'cohort', role_id: null, status: 1, enrol_period: 0, custom_int1: COHORT_ID, custom_int2: null, custom_text1: '' }]);

    await createSurface(db, outbox).materializeCohortMemberAdded({ cohortId: COHORT_ID, userId: USER_ID });

    expect(db.rows('user_enrolments')).toHaveLength(0);
  });

  it('thành viên mới vào cohort, instance đang bật: ghi danh vào khoá', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedCourse(db);
    db.seed('cohort_members', [{ cohort_id: COHORT_ID, user_id: USER_ID }]);
    db.seed('enrol', [{ id: INSTANCE_ID, course_id: COURSE_ID, enrol: 'cohort', role_id: null, status: 0, enrol_period: 0, custom_int1: COHORT_ID, custom_int2: null, custom_text1: '' }]);

    await createSurface(db, outbox).materializeCohortMemberAdded({ cohortId: COHORT_ID, userId: USER_ID });

    expect(db.rows('user_enrolments')).toHaveLength(1);
    expect(db.rows('user_enrolments')[0]!.status).toBe(ENROL_ACTIVE);
    expect(outbox.events.some((event) => event.input.type === 'user_enrolled')).toBe(true);
  });

  it('sự kiện rời cohort nhưng người dùng đã vào lại: không rút/đình chỉ gì', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    db.seed('cohort_members', [{ cohort_id: COHORT_ID, user_id: USER_ID }]);
    seedUserEnrolment(db, ENROL_ACTIVE);
    db.seed('enrol', [{ id: INSTANCE_ID, course_id: COURSE_ID, enrol: 'cohort', role_id: null, status: 0, enrol_period: 0, custom_int1: COHORT_ID, custom_int2: null, custom_text1: 'unenrol' }]);

    await createSurface(db, outbox).materializeCohortMemberRemoved({ cohortId: COHORT_ID, userId: USER_ID });

    expect(db.rows('user_enrolments')[0]!.status).toBe(ENROL_ACTIVE);
    expect(outbox.events).toHaveLength(0);
  });

  it('rời cohort, instance đặt chế độ unenrol: rút ghi danh (không còn dữ liệu thì xoá cứng)', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedUserEnrolment(db, ENROL_ACTIVE);
    db.seed('enrol', [{ id: INSTANCE_ID, course_id: COURSE_ID, enrol: 'cohort', role_id: null, status: 0, enrol_period: 0, custom_int1: COHORT_ID, custom_int2: null, custom_text1: 'unenrol' }]);

    await createSurface(db, outbox).materializeCohortMemberRemoved({ cohortId: COHORT_ID, userId: USER_ID });

    expect(db.rows('user_enrolments')).toHaveLength(0);
    expect(outbox.events.some((event) => event.input.type === 'user_unenrolled')).toBe(true);
  });

  it('rời cohort, instance không đặt chế độ unenrol: đình chỉ ghi danh, xoá vết người thao tác, phát sự kiện cohort_removed', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedUserEnrolment(db, ENROL_ACTIVE);
    db.seed('enrol', [{ id: INSTANCE_ID, course_id: COURSE_ID, enrol: 'cohort', role_id: null, status: 0, enrol_period: 0, custom_int1: COHORT_ID, custom_int2: null, custom_text1: '' }]);

    await createSurface(db, outbox).materializeCohortMemberRemoved({ cohortId: COHORT_ID, userId: USER_ID });

    expect(db.rows('user_enrolments')).toHaveLength(1);
    expect(db.rows('user_enrolments')[0]!.status).toBe(ENROL_SUSPENDED);
    expect(db.rows('user_enrolments')[0]!.modifier_id).toBeNull();
    const suspended = outbox.events.find((event) => event.input.type === 'user_enrolment_suspended');
    expect(suspended).toBeDefined();
    expect(suspended!.standalone).toBe(true);
    expect(suspended!.input.payload).toEqual({ courseId: COURSE_ID, userId: USER_ID, instanceId: INSTANCE_ID, reason: 'cohort_removed' });
  });

  it('rời cohort nhưng ghi danh đã ở dạng WITHDRAWN: bỏ qua, không phát sự kiện', async () => {
    const db = new FakeEnrolDb();
    const outbox = new FakeOutbox();
    seedUserEnrolment(db, ENROL_WITHDRAWN);
    db.seed('enrol', [{ id: INSTANCE_ID, course_id: COURSE_ID, enrol: 'cohort', role_id: null, status: 0, enrol_period: 0, custom_int1: COHORT_ID, custom_int2: null, custom_text1: '' }]);

    await createSurface(db, outbox).materializeCohortMemberRemoved({ cohortId: COHORT_ID, userId: USER_ID });

    expect(db.rows('user_enrolments')[0]!.status).toBe(ENROL_WITHDRAWN);
    expect(outbox.events).toHaveLength(0);
  });
});
