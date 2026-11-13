import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login, roleIdByShortname, STRONG_PASSWORD,
  systemContextId,
} from '../../support/identity-access-helpers';
import { createCategory, createClass, createCourse, createEnrolInstance, enrolUser, grantActiveTeacherPlan } from '../../support/course-enrolment-helpers';
import { addGroupMember, contextIdByLevelInstance, createGroupViaApi } from '../../support/engagement-helpers';


interface Person { id: string; username: string; token: string }

interface TreeLeaf { name: string; myRole: string; conversationId: string | null; unread: number; pinnedAt: string | null }
interface TreeGroup extends TreeLeaf { groupId: string }
interface TreeCourse extends TreeLeaf { courseId: string; groups: TreeGroup[] }
interface TreeClass extends TreeLeaf { classId: string; courses: TreeCourse[] }
interface TreeBody {
  classes: TreeClass[];
  coursesOutsideClasses: TreeCourse[];
  freeGroups: (TreeLeaf & { conversationId: string })[];
  canCreateFreeGroup: boolean;
}


async function insertLegacyEnrolment(instanceId: string, userId: string, courseId: string, contextId: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `insert into user_enrolments (enrol_id, user_id, status) values ($1, $2, 0)`,
      [instanceId, userId],
    );
    await client.query(
      `insert into role_assignments (role_id, user_id, context_id, component, item_id)
         select role_id, $2, $3, 'enrol', id from enrol where id = $1 and role_id is not null`,
      [instanceId, userId, contextId],
    );
    await client.query(
      `insert into tenant_memberships (tenant_id, user_id, status)
         select tenant_id, $2, 'active' from course
          where id = $1 and not exists (
            select 1 from tenant_memberships tm where tm.tenant_id = course.tenant_id and tm.user_id = $2
          )`,
      [courseId, userId],
    );
  } finally {
    await client.end();
  }
}

describe('Messaging — cây nhóm theo vai (MSG-T1, issue #33)', () => {
  let app: INestApplication;
  let admin: string;
  let teacher: Person;
  let student: Person;
  let outsider: Person;
  let staff: Person;
  let class1: string;
  let class2: string;
  let classX: string;
  let course1: string;
  let course2: string;
  let courseX: string;
  let group1: string;
  let convCourse1: string;
  let groupConv: string;
  let freeGroupId: string;

  async function person(): Promise<Person> {
    const u = await createUserViaApi(app, admin);
    const session = await login(app, u.username, STRONG_PASSWORD);
    return { id: u.id, username: u.username, token: session.accessToken };
  }

  async function tree(token: string): Promise<TreeBody> {
    const res = await http(app).get('/api/v1/messages/group-tree').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as TreeBody;
  }

  async function send(token: string, conversationId: string, text: string) {
    return http(app).post(`/api/v1/messages/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`).send({ text });
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    teacher = await person();
    student = await person();
    outsider = await person();
    staff = await person();

    const systemCtx = await systemContextId(app, admin);
    const courseCreator = await roleIdByShortname(app, admin, 'coursecreator');
    await assignRole(app, admin, staff.id, courseCreator, systemCtx);

    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    try {
      await grantActiveTeacherPlan(pg, teacher.id);
    } finally {
      await pg.end();
    }

    class1 = (await createClass(app, admin, { ownerId: teacher.id })).id;
    class2 = (await createClass(app, admin, { ownerId: teacher.id })).id;
    classX = (await createClass(app, admin)).id;

    const category = await createCategory(app, admin);
    course1 = (await createCourse(app, admin, category.id, { classId: class1 })).id;
    course2 = (await createCourse(app, admin, category.id, { classId: class2 })).id;
    courseX = (await createCourse(app, admin, category.id, { classId: classX })).id;

    const editingTeacher = await roleIdByShortname(app, admin, 'editingteacher');
    for (const courseId of [course1, course2, courseX]) {
      const ctx = await contextIdByLevelInstance(app, admin, 50, courseId);
      await assignRole(app, admin, teacher.id, editingTeacher, ctx);
    }

    const roster = await http(app).post(`/api/v1/classes/${class1}/roster`)
      .set('Authorization', `Bearer ${admin}`).send({ userId: student.id });
    expect(roster.status).toBe(201);

    const instanceX = await createEnrolInstance(app, admin, courseX);
    await enrolUser(app, admin, courseX, instanceX.id, student.id);

    const instance1 = await createEnrolInstance(app, admin, course1);
    const course1Ctx = await contextIdByLevelInstance(app, admin, 50, course1);
    await insertLegacyEnrolment(instance1.id, teacher.id, course1, course1Ctx);

    const group = await createGroupViaApi(app, admin, course1, 'Tổ 1');
    group1 = group.id;
    await addGroupMember(app, admin, course1, group1, student.id);
    await addGroupMember(app, admin, course1, group1, teacher.id);

    const free = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 2, memberIds: [teacher.id, student.id], name: 'Nhóm ôn thi' });
    expect(free.status).toBe(201);
    freeGroupId = free.body.id as string;
  });
  afterAll(async () => { await app.close(); });

  it('1. cây của GV: đúng 2 lớp vai teaching, khoá nằm trong lớp, chat chưa ensure thì conversationId null + unread 0', async () => {
    const t = await tree(teacher.token);
    const byId = new Map(t.classes.map((c) => [c.classId, c]));
    expect([...byId.keys()].sort()).toEqual([class1, class2].sort());
    expect(t.coursesOutsideClasses.map((c) => c.courseId)).toEqual([courseX]);
    expect(t.coursesOutsideClasses[0]!.myRole).toBe('teaching');

    const c1 = byId.get(class1)!;
    expect(c1.myRole).toBe('teaching');
    expect(c1.conversationId).toBeNull();
    expect(c1.unread).toBe(0);
    expect(c1.courses.map((c) => c.courseId)).toEqual([course1]);
    const courseNode = c1.courses[0]!;
    expect(courseNode.myRole).toBe('teaching');
    expect(courseNode.conversationId).toBeNull();
    expect(courseNode.unread).toBe(0);
    expect(courseNode.groups.map((g) => g.groupId)).toEqual([group1]);
    expect(courseNode.groups[0]!.conversationId).toBeNull();

    const c2 = byId.get(class2)!;
    expect(c2.courses.map((c) => c.courseId)).toEqual([course2]);
    expect(byId.has(classX)).toBe(false);
  });

  it('2. ensure chat khoá + tin chưa đọc: nút khoá mang conversationId + unread đúng, nút lớp mang tổng con', async () => {
    const ensured = await http(app).get(`/api/v1/messages/courses/${course1}/conversation`)
      .set('Authorization', `Bearer ${teacher.token}`);
    expect(ensured.status).toBe(200);
    convCourse1 = ensured.body.id as string;
    const sent = await send(teacher.token, convCourse1, 'Thông báo cho cả lớp');
    expect(sent.status).toBe(201);

    const teacherTree = await tree(teacher.token);
    const teacherCourse = teacherTree.classes.find((c) => c.classId === class1)!.courses[0]!;
    expect(teacherCourse.conversationId).toBe(convCourse1);
    expect(teacherCourse.unread).toBe(0);

    const studentTree = await tree(student.token);
    const studentCourse = studentTree.classes.find((c) => c.classId === class1)!.courses[0]!;
    expect(studentCourse.conversationId).toBe(convCourse1);
    expect(studentCourse.unread).toBe(1);
    const studentClass = studentTree.classes.find((c) => c.classId === class1)!;
    expect(studentClass.unread).toBe(1);

    await http(app).post(`/api/v1/messages/conversations/${convCourse1}/read`)
      .set('Authorization', `Bearer ${student.token}`).send({});
    const afterRead = await tree(student.token);
    expect(afterRead.classes.find((c) => c.classId === class1)!.courses[0]!.unread).toBe(0);
  });

  it('3. cây của HS: lớp 1 vai learning; khoá X hiện ở mục ngoài lớp trực tiếp, không kéo nút lớp lạ', async () => {
    const t = await tree(student.token);
    expect(t.classes.map((c) => c.classId)).toEqual([class1]);
    expect(t.classes[0]!.myRole).toBe('learning');
    expect(t.classes[0]!.courses.map((c) => c.courseId)).toEqual([course1]);
    expect(t.classes[0]!.courses[0]!.myRole).toBe('learning');
    expect(t.coursesOutsideClasses.map((c) => c.courseId)).toEqual([courseX]);
    expect(t.coursesOutsideClasses[0]!.myRole).toBe('learning');
    expect(JSON.stringify(t)).not.toContain(class2);
  });

  it('4. người ngoài hoàn toàn: cây rỗng cả ba mục', async () => {
    const t = await tree(outsider.token);
    expect(t.classes).toEqual([]);
    expect(t.coursesOutsideClasses).toEqual([]);
    expect(t.freeGroups).toEqual([]);
    expect(t.canCreateFreeGroup).toBe(false);
  });

  it('5. nhóm con ensure xong mang conversationId; nhóm tự do ở freeGroups đúng vai', async () => {
    const created = await http(app).post('/api/v1/messages/conversations/group')
      .set('Authorization', `Bearer ${student.token}`).send({ groupId: group1 });
    expect(created.status).toBe(201);
    groupConv = created.body.id as string;

    const t = await tree(student.token);
    const groupNode = t.classes.find((c) => c.classId === class1)!.courses[0]!.groups
      .find((g) => g.groupId === group1)!;
    expect(groupNode.conversationId).toBe(groupConv);
    expect(t.freeGroups.map((g) => g.conversationId)).toEqual([freeGroupId]);
    expect(t.freeGroups[0]!.myRole).toBe('learning');
    expect(t.canCreateFreeGroup).toBe(false);

    const teacherTree = await tree(teacher.token);
    expect(teacherTree.freeGroups.map((g) => g.conversationId)).toEqual([freeGroupId]);
    expect(teacherTree.freeGroups[0]!.myRole).toBe('learning');
    expect(teacherTree.freeGroups[0]!.name).toBe('Nhóm ôn thi');
    expect(teacherTree.canCreateFreeGroup).toBe(false);

    const staffTree = await tree(staff.token);
    expect(staffTree.canCreateFreeGroup).toBe(false);

    const adminTree = await tree(admin);
    expect(adminTree.canCreateFreeGroup).toBe(true);
  });

  it('6. phân loại trên danh sách conversation: itemType/itemId đúng từng loại, nhóm tự do thì null', async () => {
    const list = await http(app).get('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${student.token}`);
    expect(list.status).toBe(200);
    const rows = list.body as { id: string; component: string | null; itemType: string | null; itemId: string | null }[];
    const courseRow = rows.find((r) => r.id === convCourse1);
    expect(courseRow).toMatchObject({ component: 'core_course', itemType: 'course', itemId: course1 });
    const groupRow = rows.find((r) => r.id === groupConv);
    expect(groupRow).toMatchObject({ component: 'core_group', itemType: 'groups', itemId: group1 });
    const freeRow = rows.find((r) => r.id === freeGroupId);
    expect(freeRow).toMatchObject({ component: null, itemType: null, itemId: null });
  });

  it('7. mốc ghim trên cây dựng từ cả tập đã lưu trữ: nhóm tự do và chat khoá vừa ghim vừa lưu trữ vẫn báo pinnedAt, lưu trữ không ghim thì pinnedAt null', async () => {
    const pinnedFree = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 2, memberIds: [teacher.id, student.id], name: 'Nhóm luyện thi' });
    expect(pinnedFree.status).toBe(201);
    const pinnedFreeId = pinnedFree.body.id as string;
    const archivedFree = await http(app).post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 2, memberIds: [teacher.id, student.id], name: 'Nhóm tài liệu' });
    expect(archivedFree.status).toBe(201);
    const archivedFreeId = archivedFree.body.id as string;

    const statePinnedFree = await http(app).patch(`/api/v1/messages/conversations/${pinnedFreeId}/state`)
      .set('Authorization', `Bearer ${student.token}`).send({ pinned: true, archived: true });
    expect(statePinnedFree.status).toBe(200);
    expect(statePinnedFree.body).toMatchObject({ pinned: true, archived: true });
    const stateArchivedFree = await http(app).patch(`/api/v1/messages/conversations/${archivedFreeId}/state`)
      .set('Authorization', `Bearer ${student.token}`).send({ archived: true });
    expect(stateArchivedFree.status).toBe(200);
    expect(stateArchivedFree.body).toMatchObject({ pinned: false, archived: true });
    const stateCourse = await http(app).patch(`/api/v1/messages/conversations/${convCourse1}/state`)
      .set('Authorization', `Bearer ${student.token}`).send({ pinned: true, archived: true });
    expect(stateCourse.status).toBe(200);
    expect(stateCourse.body).toMatchObject({ pinned: true, archived: true });

    const t = await tree(student.token);
    const pinnedFreeNode = t.freeGroups.find((g) => g.conversationId === pinnedFreeId)!;
    expect(pinnedFreeNode.pinnedAt).not.toBeNull();
    expect(typeof pinnedFreeNode.pinnedAt).toBe('string');
    const archivedFreeNode = t.freeGroups.find((g) => g.conversationId === archivedFreeId)!;
    expect(archivedFreeNode.pinnedAt).toBeNull();
    const courseNode = t.classes.find((c) => c.classId === class1)!.courses
      .find((c) => c.courseId === course1)!;
    expect(courseNode.conversationId).toBe(convCourse1);
    expect(courseNode.pinnedAt).not.toBeNull();

    const teacherTree = await tree(teacher.token);
    expect(teacherTree.freeGroups.find((g) => g.conversationId === pinnedFreeId)!.pinnedAt).toBeNull();
    expect(teacherTree.classes.find((c) => c.classId === class1)!.courses
      .find((c) => c.courseId === course1)!.pinnedAt).toBeNull();
  });
});
