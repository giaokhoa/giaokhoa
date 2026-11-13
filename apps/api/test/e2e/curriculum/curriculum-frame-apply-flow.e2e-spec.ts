import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminToken, assignRole, createTestApp, createUserViaApi, http, login,
  roleIdByShortname, STRONG_PASSWORD, systemContextId, uniqueName,
} from '../../support/identity-access-helpers';
import { createCategory } from '../../support/course-enrolment-helpers';
import { contextIdByLevelInstance } from '../../support/engagement-helpers';


interface OutcomeDocNode {
  type: string;
  text?: string;
  content?: OutcomeDocNode[];
}
interface OutcomeDoc {
  type: 'doc';
  content?: OutcomeDocNode[];
}

interface ProgramRecord {
  id: string; grade: number; stream: string; section: string | null; topic: string | null;
  content: string; outcomes: (string | OutcomeDoc)[]; outcome_text: string;
}
const toan = JSON.parse(
  readFileSync(join(process.cwd(), 'src/modules/curriculum/program-data/program-toan.json'), 'utf8'),
) as { records: ProgramRecord[] };

function docOutcomeText(doc: OutcomeDoc): string {
  const lines: string[] = [];
  const walk = (node: OutcomeDocNode): void => {
    if (node.type === 'paragraph') {
      lines.push((node.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''));
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return lines.join('\n').trim();
}

function outcomeTexts(r: ProgramRecord): string[] {
  if (r.outcomes.length > 0) {
    return r.outcomes.map((o) => (typeof o === 'string' ? o : docOutcomeText(o)));
  }
  if (r.outcome_text.trim().length > 0) return [r.outcome_text];
  return [];
}
function expectedUnitOutcomes(grade: number, stream: string, section?: string, topic?: string): string[] {
  return toan.records
    .filter((r) => r.grade === grade && r.stream === stream
      && (section === undefined || r.section === section)
      && (topic === undefined || r.topic === topic))
    .flatMap(outcomeTexts);
}

interface TreeNode {
  id: string; title: string; kind: string;
  outcomes: { id: string; content: string; position: number }[];
  children: TreeNode[];
}
function findByPath(nodes: TreeNode[], titles: string[]): TreeNode | undefined {
  let level = nodes;
  let found: TreeNode | undefined;
  for (const title of titles) {
    found = level.find((n) => n.title === title);
    if (!found) return undefined;
    level = found.children;
  }
  return found;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Áp khung chương trình K0a (chương trình → section khoá học, bản sao có neo)', () => {
  let app: INestApplication;
  let admin: string;
  let systemCtxId: string;
  let teacherToken: string;
  let plainToken: string;
  let subjectId: string;
  let curriculum5Id: string;
  let tree5: TreeNode[];
  let categoryId: string;
  let courseId: string;
  let classId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminToken(app);
    systemCtxId = await systemContextId(app, admin);
    const imp = await http(app).post('/api/v1/curriculum/program-import').set(bearer(admin)).send({ datasetKey: 'toan' });
    expect(imp.status).toBe(201);

    const category = await createCategory(app, admin);
    categoryId = category.id;
    const categoryCtxId = await contextIdByLevelInstance(app, admin, 40, categoryId);
    const teacher = await createUserViaApi(app, admin);
    await assignRole(app, admin, teacher.id, await roleIdByShortname(app, admin, 'coursecreator'), categoryCtxId);
    teacherToken = (await login(app, teacher.username, STRONG_PASSWORD)).accessToken;
    const cls = await http(app).post('/api/v1/classes').set(bearer(admin)).send({ name: uniqueName('cls'), ownerId: teacher.id });
    expect(cls.status).toBe(201);
    classId = cls.body.id as string;
    const plain = await createUserViaApi(app, admin);
    plainToken = (await login(app, plain.username, STRONG_PASSWORD)).accessToken;

    const subjects = await http(app).get(`/api/v1/curriculum/subjects?contextId=${systemCtxId}`).set(bearer(admin));
    subjectId = (subjects.body as { id: string; slug: string }[]).find((s) => s.slug === 'toan')!.id;
    const curricula = await http(app).get(`/api/v1/curriculum/curricula?subjectId=${subjectId}`).set(bearer(admin));
    curriculum5Id = (curricula.body as { id: string; grade: number }[]).find((c) => c.grade === 5)!.id;
    const tree = await http(app).get(`/api/v1/curriculum/curricula/${curriculum5Id}/tree`).set(bearer(admin));
    expect(tree.status).toBe(200);
    tree5 = (tree.body as { nodes: TreeNode[] }).nodes;
  }, 180_000);
  afterAll(async () => { await app.close(); });

  it('teacher creates a grade-5 Toán course carrying subject × grade', async () => {
    const res = await http(app).post('/api/v1/courses').set(bearer(teacherToken)).send({
      fullName: 'Toán 5 — khung K0a', shortName: uniqueName('toan5'), category: categoryId,
      subjectId, grade: 5, classId,
    });
    expect(res.status).toBe(201);
    expect(res.body.subjectId).toBe(subjectId);
    expect(res.body.grade).toBe(5);
    courseId = res.body.id as string;

    const bogus = await http(app).post('/api/v1/courses').set(bearer(teacherToken)).send({
      fullName: 'Khoá neo môn ma', shortName: uniqueName('ghost'), category: categoryId,
      subjectId: '01961e2a-7b3c-7def-8abc-0123456789ab', grade: 5, classId,
    });
    expect(bogus.status).toBe(400);
    expect(bogus.body.code).toBe('course.subject_not_found');
  });

  it('giáo viên đọc bộ chọn khung cho chính khoá của họ qua forCourseId, nhưng không đọc cây thuần', async () => {
    const subjects = await http(app).get(`/api/v1/curriculum/subjects?contextId=${systemCtxId}&forCourseId=${courseId}`).set(bearer(teacherToken));
    expect(subjects.status).toBe(200);
    const curricula = await http(app).get(`/api/v1/curriculum/curricula?subjectId=${subjectId}&forCourseId=${courseId}`).set(bearer(teacherToken));
    expect(curricula.status).toBe(200);
    const tree = await http(app).get(`/api/v1/curriculum/curricula/${curriculum5Id}/tree?forCourseId=${courseId}`).set(bearer(teacherToken));
    expect(tree.status).toBe(200);
    const plainTree = await http(app).get(`/api/v1/curriculum/curricula/${curriculum5Id}/tree`).set(bearer(teacherToken));
    expect(plainTree.status).toBe(403);
  });

  it('áp khung chủ đề: một section mang đúng outcome chủ đề từ dataset', async () => {
    const topic = findByPath(tree5, ['Số và phép tính', 'Phân số', 'Số thập phân']);
    expect(topic).toBeTruthy();
    const res = await http(app).post(`/api/v1/courses/${courseId}/curriculum-frame`).set(bearer(teacherToken))
      .send({ curriculumId: curriculum5Id, nodeIds: [topic!.id] });
    expect(res.status).toBe(201);
    const created = res.body as { section: number; name: string; frame: { nodeId: string; nodeTitle: string; outcomes: { content: string }[] } }[];
    expect(created.length).toBe(1);
    expect(created[0]!.section).toBe(1);
    expect(created[0]!.name).toBe('Số thập phân');
    expect(created[0]!.frame.nodeId).toBe(topic!.id);
    expect(created[0]!.frame.outcomes.map((o) => o.content))
      .toEqual(expectedUnitOutcomes(5, 'Số và phép tính', 'Phân số', 'Số thập phân'));
  });

  it('chèn khung cấp section tại một vị trí và dàn ý hiện outcome có neo', async () => {
    const sectionNode = findByPath(tree5, ['Số và phép tính', 'Phân số']);
    expect(sectionNode).toBeTruthy();
    const res = await http(app).post(`/api/v1/courses/${courseId}/curriculum-frame`).set(bearer(teacherToken))
      .send({ curriculumId: curriculum5Id, nodeIds: [sectionNode!.id], insertAtSection: 1 });
    expect(res.status).toBe(201);
    expect((res.body as { section: number }[])[0]!.section).toBe(1);

    const content = await http(app).get(`/api/v1/courses/${courseId}/content`).set(bearer(teacherToken));
    expect(content.status).toBe(200);
    const sections = (content.body as { sections: { section: number; name: string | null; frame: { outcomes: { content: string }[] } | null }[] }).sections;
    expect(sections.map((s) => s.section)).toEqual([0, 1, 2]);
    expect(sections[1]!.name).toBe('Phân số');
    expect(sections[2]!.name).toBe('Số thập phân');
    expect(sections[1]!.frame?.outcomes.map((o) => o.content))
      .toEqual(expectedUnitOutcomes(5, 'Số và phép tính', 'Phân số'));
    expect(sections[2]!.frame?.outcomes.map((o) => o.content))
      .toEqual(expectedUnitOutcomes(5, 'Số và phép tính', 'Phân số', 'Số thập phân'));
    expect(sections[0]!.frame).toBeNull();
  });

  it('sửa cây chương trình sau đó KHÔNG đổi khoá đã áp (snapshot giữ nguyên)', async () => {
    const topic = findByPath(tree5, ['Số và phép tính', 'Phân số', 'Số thập phân'])!;
    const lesson = topic.children.find((n) => n.kind === 'lesson')!;
    const outcome = lesson.outcomes[0]!;
    const renamed = await http(app).patch(`/api/v1/curriculum/nodes/${topic.id}`).set(bearer(admin))
      .send({ title: 'Số thập phân (ĐÃ SỬA THỬ)' });
    expect(renamed.status).toBe(200);
    const edited = await http(app).patch(`/api/v1/curriculum/outcomes/${outcome.id}`).set(bearer(admin))
      .send({ content: 'YCCĐ ĐÃ SỬA THỬ — không được rò vào khoá' });
    expect(edited.status).toBe(200);
    try {
      const content = await http(app).get(`/api/v1/courses/${courseId}/content`).set(bearer(teacherToken));
      const sections = (content.body as { sections: { name: string | null; frame: { outcomes: { content: string }[] } | null }[] }).sections;
      const topicSection = sections.find((s) => s.frame && s.name === 'Số thập phân');
      expect(topicSection).toBeTruthy();
      expect(topicSection!.frame?.outcomes.map((o) => o.content))
        .toEqual(expectedUnitOutcomes(5, 'Số và phép tính', 'Phân số', 'Số thập phân'));
      expect(sections.some((s) => s.name?.includes('ĐÃ SỬA THỬ'))).toBe(false);
    } finally {
      await http(app).patch(`/api/v1/curriculum/nodes/${topic.id}`).set(bearer(admin)).send({ title: 'Số thập phân' });
      await http(app).patch(`/api/v1/curriculum/outcomes/${outcome.id}`).set(bearer(admin)).send({ content: outcome.content });
    }
  });

  it('từ chối áp khung khi thiếu course:update và từ chối node không chọn được', async () => {
    const topic = findByPath(tree5, ['Số và phép tính', 'Phân số', 'Số thập phân'])!;
    const plain = await http(app).post(`/api/v1/courses/${courseId}/curriculum-frame`).set(bearer(plainToken))
      .send({ curriculumId: curriculum5Id, nodeIds: [topic.id] });
    expect(plain.status).toBe(403);
    const lesson = topic.children.find((n) => n.kind === 'lesson')!;
    const lessonPick = await http(app).post(`/api/v1/courses/${courseId}/curriculum-frame`).set(bearer(teacherToken))
      .send({ curriculumId: curriculum5Id, nodeIds: [lesson.id] });
    expect(lessonPick.status).toBe(400);
    expect(lessonPick.body.code).toBe('course.frame_node_not_selectable');
    const bogusCurr = await http(app).post(`/api/v1/courses/${courseId}/curriculum-frame`).set(bearer(teacherToken))
      .send({ curriculumId: '01961e2a-7b3c-7def-8abc-0123456789ab', nodeIds: [topic.id] });
    expect(bogusCurr.status).toBe(404);
  });
});
