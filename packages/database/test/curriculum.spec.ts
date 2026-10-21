import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PostgresCurriculumRepository } from '../src/repositories/curriculum.js';
import { migrationsFolder } from '../src/migrations.js';
import * as schema from '../src/schema/index.js';
import type { Database } from '../src/types.js';

const databaseName = `gk_curriculum_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
let repository: PostgresCurriculumRepository;

function url(name: string) {
  const value = process.env.DATABASE_URL;
  if (!value || !new URL(value).pathname.includes('test'))
    throw new Error('Cần địa chỉ PostgreSQL riêng cho kiểm thử');
  const parsed = new URL(value);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function adminQuery(query: string) {
  const client = new Client({ connectionString: url('postgres') });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
}

const slug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  await adminQuery(`CREATE DATABASE "${databaseName}"`);
  pool = new Pool({ connectionString: url(databaseName) });
  const db: Database = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  repository = new PostgresCurriculumRepository(db);
}, 30_000);

afterAll(async () => {
  await pool?.end();
  await adminQuery(`DROP DATABASE IF EXISTS "${databaseName}"`);
}, 30_000);

describe('PostgresCurriculumRepository', () => {
  it('tạo, liệt kê, đọc, sửa, xóa môn và báo lỗi trùng mã đường dẫn', async () => {
    const math = await repository.createSubject({ name: 'Toán', slug: slug('toan'), position: 3 });
    const literature = await repository.createSubject({
      name: 'Ngữ văn',
      slug: slug('ngu-van'),
      position: 1,
    });
    expect(await repository.findSubject(math.id)).toEqual(math);
    expect(
      (await repository.listSubjects())
        .filter(({ id }) => id === math.id || id === literature.id)
        .map(({ id }) => id),
    ).toEqual([literature.id, math.id]);
    await expect(
      repository.createSubject({ name: 'Trùng', slug: math.slug }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'subject_slug_conflict' });
    await expect(
      repository.updateSubject(literature.id, { slug: math.slug }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'subject_slug_conflict' });
    expect(await repository.updateSubject(math.id, { name: 'Toán học' })).toMatchObject({
      id: math.id,
      name: 'Toán học',
    });
    expect(await repository.deleteSubject(math.id)).toEqual({ id: math.id });
    expect(await repository.findSubject(math.id)).toBeUndefined();
    expect(await repository.deleteSubject(math.id)).toBeUndefined();
  });

  it('giữ duy nhất chương trình theo môn/khối khi tạo và sửa', async () => {
    const subject = await repository.createSubject({ name: 'Khoa học', slug: slug('khoa-hoc') });
    const six = await repository.createCurriculum({ subjectId: subject.id, grade: 6 });
    const seven = await repository.createCurriculum({ subjectId: subject.id, grade: 7 });
    expect(await repository.findCurriculum(six.id)).toEqual(six);
    expect(await repository.findCurriculumBySubjectAndGrade(subject.id, 7)).toEqual(seven);
    expect((await repository.listCurricula(subject.id)).map(({ grade }) => grade)).toEqual([6, 7]);
    expect((await repository.listAllCurricula()).some(({ id }) => id === six.id)).toBe(true);
    await expect(
      repository.createCurriculum({ subjectId: subject.id, grade: 6 }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'curriculum_conflict' });
    await expect(repository.updateCurriculum(seven.id, { grade: 6 })).rejects.toMatchObject({
      kind: 'conflict',
      code: 'curriculum_conflict',
    });
    expect(await repository.updateCurriculum(seven.id, { grade: 8 })).toMatchObject({ grade: 8 });
    expect(await repository.findCurriculumBySubjectAndGrade(subject.id, 7)).toBeUndefined();
    expect(await repository.deleteCurriculum(six.id)).toEqual({ id: six.id });
    expect(await repository.findCurriculum(six.id)).toBeUndefined();
  });

  it('kiểm tra cây: di chuyển hợp lệ, cha ở chương trình khác và vòng lặp', async () => {
    const subject = await repository.createSubject({ name: 'Sử', slug: slug('lich-su') });
    const course = await repository.createCurriculum({ subjectId: subject.id, grade: 6 });
    const other = await repository.createCurriculum({ subjectId: subject.id, grade: 7 });
    const root = await repository.createNode({
      curriculumId: course.id,
      title: 'Gốc',
      position: 1,
    });
    const sibling = await repository.createNode({
      curriculumId: course.id,
      title: 'Nút khác',
      position: 2,
    });
    const child = await repository.createNode({
      curriculumId: course.id,
      parentId: root.id,
      title: 'Con',
      position: 3,
    });
    const foreign = await repository.createNode({ curriculumId: other.id, title: 'Khác' });
    expect(await repository.findNode(child.id)).toEqual(child);
    expect((await repository.listNodes(course.id)).map(({ id }) => id)).toEqual([
      root.id,
      sibling.id,
      child.id,
    ]);
    expect(await repository.updateNode(child.id, { title: 'Con mới' })).toMatchObject({
      title: 'Con mới',
    });
    expect(await repository.updateNodeTree(child.id, { parentId: sibling.id })).toMatchObject({
      status: 'updated',
      node: { parentId: sibling.id },
    });
    expect(await repository.updateNodeTree(sibling.id, { parentId: child.id })).toEqual({
      status: 'cycle',
    });
    expect(await repository.updateNodeTree(sibling.id, { parentId: sibling.id })).toEqual({
      status: 'cycle',
    });
    expect(await repository.updateNodeTree(child.id, { parentId: foreign.id })).toEqual({
      status: 'invalid_parent',
    });
    expect(await repository.updateNodeTree(randomUUID(), { parentId: null })).toEqual({
      status: 'not_found',
    });
    await expect(
      repository.createNode({
        curriculumId: other.id,
        parentId: root.id,
        title: 'Sai',
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    expect(await repository.deleteNode(sibling.id)).toEqual({ id: sibling.id });
    expect(await repository.findNode(child.id)).toBeUndefined();
  });

  it('quản lý yêu cầu cần đạt, thứ tự và xóa dây chuyền theo nút', async () => {
    const subject = await repository.createSubject({ name: 'Địa', slug: slug('dia-ly') });
    const course = await repository.createCurriculum({ subjectId: subject.id, grade: 10 });
    const node = await repository.createNode({ curriculumId: course.id, title: 'Bản đồ' });
    const a = await repository.createOutcome({
      nodeId: node.id,
      content: 'Đọc bản đồ',
      position: 2,
    });
    const b = await repository.createOutcome({
      nodeId: node.id,
      content: 'Nhận biết',
      position: 1,
    });
    expect(await repository.findOutcome(a.id)).toEqual(a);
    expect((await repository.listOutcomes(node.id)).map(({ id }) => id)).toEqual([b.id, a.id]);
    expect(await repository.updateOutcome(a.id, { content: 'Đọc bản đồ địa hình' })).toMatchObject({
      content: 'Đọc bản đồ địa hình',
    });
    expect(await repository.deleteOutcome(b.id)).toEqual({ id: b.id });
    expect(await repository.findOutcome(b.id)).toBeUndefined();
    await repository.deleteNode(node.id);
    expect(await repository.findOutcome(a.id)).toBeUndefined();
  });

  it('hai thao tác đổi cha đồng thời không thể tạo chu trình', async () => {
    const subject = await repository.createSubject({ name: 'Tin', slug: slug('tin-hoc') });
    const course = await repository.createCurriculum({ subjectId: subject.id, grade: 9 });
    const a = await repository.createNode({ curriculumId: course.id, title: 'A' });
    const b = await repository.createNode({ curriculumId: course.id, title: 'B' });
    const results = await Promise.all([
      repository.updateNodeTree(a.id, { parentId: b.id }),
      repository.updateNodeTree(b.id, { parentId: a.id }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(['cycle', 'updated']);
    const updatedA = await repository.findNode(a.id);
    const updatedB = await repository.findNode(b.id);
    expect(updatedA?.parentId === b.id && updatedB?.parentId === a.id).toBe(false);
  });
});
