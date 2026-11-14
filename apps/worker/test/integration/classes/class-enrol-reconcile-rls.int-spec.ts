import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { tenantAls } from '../../../src/db/tenant-als';
import { ClassEnrolReconcileProcessor } from '../../../src/processors/class-enrol-reconcile.processor';
import { TaskLogService } from '../../../src/task-log.service';
import { TenantAwarePool } from '../../../src/db/tenant-pool';
import { adminDatabaseUrl, ensureOrdinaryRole, ordinaryRoleUrl } from '../../support/ordinary-role';
import { createCentreKysely, sql, type CentreDb } from '@giaokhoa/db';

describe('Worker class enrol reconcile dưới RLS (hồi quy #292)', () => {
  const suffix = `${Date.now() % 100000000}`;
  const runTag = String(Date.now() % 100000).padStart(5, '0');
  const uid = (n: number) => `01900000-0000-7000-8000-${runTag}${String(710000 + n).padStart(7, '0')}`;
  const teacherId = uid(1);
  const memberA = uid(2);
  const memberOk = uid(3);
  const outsiderE = uid(4);

  let adminDb: CentreDb;
  let adminPool: Pool;
  let rlsDb: CentreDb;
  let rlsPool: TenantAwarePool;
  let processor: ClassEnrolReconcileProcessor;
  let classId = '';
  let instanceId = '';
  let courseCtxId = '';

  async function ueOf(userId: string) {
    return adminDb
      .selectFrom('user_enrolments')
      .selectAll()
      .where('enrol_id', '=', instanceId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  beforeAll(async () => {
    const adminUrl = adminDatabaseUrl();

    await ensureOrdinaryRole(adminUrl);

    adminPool = new Pool({ connectionString: adminUrl });
    adminDb = createCentreKysely(adminPool);

    await sql`insert into tenants (slug, name, kind, status) values (${`recon-rls-${suffix}`}, 'Reconcile RLS fixture tenant', 'school', 'active') on conflict (slug) do nothing`.execute(adminDb);
    const tenantRows = await sql<{ id: string }>`select id from tenants where slug = ${`recon-rls-${suffix}`}`.execute(adminDb);
    const tenantId = tenantRows.rows[0]!.id;

    await adminDb.insertInto('users').values({ id: teacherId, username: `recon-rls-teacher-${suffix}`, email: `recon-rls-teacher-${suffix}@example.com` }).execute();

    const catRows = await sql<{ id: string }>`insert into course_categories (name, path, tenant_id) values (${`recon-rls-cat-${suffix}`}, '', ${tenantId}) returning id`.execute(adminDb);
    const catId = catRows.rows[0]!.id;

    const cohortRow = await adminDb.insertInto('cohort').values({
      tenant_id: tenantId, name: `recon-rls-cohort-${suffix}`, context_id: teacherId, component: 'class', visible: false,
    }).returningAll().executeTakeFirstOrThrow();

    const classRow = await adminDb.insertInto('classes').values({
      tenant_id: tenantId, name: `Lớp reconcile RLS ${suffix}`, owner_id: teacherId, cohort_id: cohortRow.id, status: 'active',
    }).returningAll().executeTakeFirstOrThrow();
    classId = classRow.id;

    const courseRow = await adminDb.insertInto('course').values({
      tenant_id: tenantId, category: catId, full_name: 'Reconcile RLS course', short_name: `reconrls${suffix}`, class_id: classId,
    }).returningAll().executeTakeFirstOrThrow();

    const ctxRow = await adminDb.insertInto('context').values({
      context_level: 50, instance_id: courseRow.id, path: '/recon-rls', depth: 3,
    }).returningAll().executeTakeFirstOrThrow();
    courseCtxId = ctxRow.id;

    const groupRow = await adminDb.insertInto('course_groups').values({ course_id: courseRow.id, name: 'Cả lớp' }).returningAll().executeTakeFirstOrThrow();
    const roleRow = await adminDb.insertInto('role').values({
      name: 'Student (reconcile RLS fixture)', short_name: `recon-rls-student-${suffix}`, archetype: 'student',
    }).returningAll().executeTakeFirstOrThrow();

    const instance = await adminDb.insertInto('enrol').values({
      course_id: courseRow.id, enrol: 'cohort', status: 0, role_id: roleRow.id,
      custom_int1: cohortRow.id, custom_int2: groupRow.id, custom_text1: 'suspend',
    }).returningAll().executeTakeFirstOrThrow();
    instanceId = instance.id;

    for (const userId of [memberA, memberOk]) {
      await adminDb.insertInto('cohort_members').values({ cohort_id: cohortRow.id, user_id: userId }).execute();
    }
    await adminDb.insertInto('user_enrolments').values([
      { enrol_id: instanceId, user_id: memberOk, status: 0, modifier_id: null },
      { enrol_id: instanceId, user_id: outsiderE, status: 0, modifier_id: null },
    ]).execute();
    await adminDb.insertInto('role_assignments').values({
      role_id: roleRow.id, user_id: memberOk, context_id: courseCtxId, component: 'enrol', item_id: instanceId,
    }).execute();

    rlsPool = new TenantAwarePool({ connectionString: ordinaryRoleUrl(adminUrl) });
    rlsDb = createCentreKysely(rlsPool);
    const roleDb = createCentreKysely(rlsPool);
    const sharedScope = {
      routedKysely: roleDb,
      sweepDedicatedSpaces: async <T>(sweep: () => Promise<T>) => tenantAls.run({ platform: true }, sweep),
    };
    processor = new ClassEnrolReconcileProcessor(
      sharedScope as never,
      new TaskLogService(sharedScope as never),
    );
  });

  afterAll(async () => {
    await rlsPool?.end();
    await adminPool?.end();
  });

  it('chiều âm: ngoài ngữ cảnh tenant, role thường không thấy lớp nào (RLS fail-closed)', async () => {
    const rows = await rlsDb.selectFrom('classes').selectAll().where('id', '=', classId).execute();
    expect(rows).toHaveLength(0);
  });

  it('job đối soát thấy lớp và sửa đúng lệch dưới role không BYPASSRLS', async () => {
    const result = await processor.process({ data: {} } as never);

    expect(result.skippedClassIds).not.toContain(classId);
    expect(result.classesChecked).toBeGreaterThanOrEqual(1);
    expect(result.enrolled).toBeGreaterThanOrEqual(1);
    expect(result.suspended).toBeGreaterThanOrEqual(1);

    expect((await ueOf(memberA))?.status).toBe(0);
    const assignmentA = await adminDb.selectFrom('role_assignments').selectAll()
      .where('user_id', '=', memberA)
      .where('context_id', '=', courseCtxId)
      .where('component', '=', 'enrol')
      .where('item_id', '=', instanceId)
      .executeTakeFirst();
    expect(assignmentA).toBeTruthy();
    expect((await ueOf(outsiderE))?.status).toBe(1);
    expect((await ueOf(memberOk))?.status).toBe(0);
  });

  it('chạy lại lần hai: trạng thái đã khớp thì không sửa thêm (idempotent)', async () => {
    const before = await ueOf(outsiderE);
    await processor.process({ data: {} } as never);
    const ueE = await ueOf(outsiderE);
    expect(ueE?.status).toBe(1);
    expect((ueE?.updated_at as Date).getTime()).toBe((before?.updated_at as Date).getTime());
    const ueA = await ueOf(memberA);
    expect(ueA?.status).toBe(0);
  });
});
