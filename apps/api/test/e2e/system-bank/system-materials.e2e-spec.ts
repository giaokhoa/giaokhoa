import { ConflictException, type INestApplication } from '@nestjs/common';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestDatabase, dropTestDatabase, withDatabase } from '@giaokhoa/db/test-support';



import { DedicatedTestCentres, type DedicatedTestCentre } from '../../support/dedicated-test-centres';
import { runSpaceProvision, type SpaceProvisionResult } from '../../../src/modules/tenants/space-provision-runner';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../src/modules/files/storage';
import { FileSigningService } from '../../../src/modules/files/file-signing.service';
import { SystemMaterialReferencesRepository } from '@giaokhoa/db/repositories/system-material-references';
import { LEGACY_FILE_DOMAIN, SYSTEM_FILE_DOMAIN, fileDomainForSpace } from '@giaokhoa/db';
import { publicationMediaStorageKey } from '../../../src/modules/system-bank/system-bank-media.service';

let identity: typeof import('../../support/identity-access-helpers');
let courseHelpers: typeof import('../../support/course-enrolment-helpers');

const ROOT = '/api/v1/system-bank/materials';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const suffix = `${process.pid}_${Date.now()}`;
const centreDb = `giaokhoa_test_material_${suffix}`;
const bankDb = `giaokhoa_test_material_bank_${suffix}`;
const originalUrl = process.env.DATABASE_URL!;
const adminUrl = withDatabase(originalUrl, 'postgres');
const oldStorageDir = process.env.FILE_STORAGE_DIR;
const oldBankUrl = process.env.SYSTEM_BANK_DATABASE_URL;
const oldControlPlaneUrl = process.env.CONTROL_PLANE_DATABASE_URL;

describe('Công bố học liệu và dùng phiên bản trong đúng audience khoá học', () => {
  let app: INestApplication;
  let pg: Client;
  let bank: Client;
  let pgB: Client;
  let dedicated: DedicatedTestCentres;
  let dedicatedA: DedicatedTestCentre;
  let dedicatedB: DedicatedTestCentre;
  let hostA: string;
  let hostB: string;
  let storageDir: string;
  let admin: string;
  let tenantA: string;
  let tenantB: string;
  let managerA: string;
  let managerB: string;
  let teacherA: string;
  let teacherB: string;
  let editor: string;
  let studentA: string;
  let studentB: string;
  let outsideB: string;
  let studentBId: string;
  let outsideBId: string;
  let courseId: string;
  let sectionId: string;
  let sourceId: string;
  let materialId: string;
  let resourceId: string;
  let cmId: string;
  const dedicatedFileSpaces: SpaceProvisionResult[] = [];
  const bytes = Buffer.from('%PDF-1.4\nHoc lieu doc lap G16');

  beforeAll(async () => {
    process.env.DATABASE_URL = await buildTestDatabase({ adminUrl, database: centreDb, store: 'centre' });
    process.env.SYSTEM_BANK_DATABASE_URL = await buildTestDatabase({ adminUrl, database: bankDb, store: 'system-bank' });
    dedicated = new DedicatedTestCentres();
    await dedicated.provision([`materials-a-${randomUUID().slice(0, 8)}`, `materials-b-${randomUUID().slice(0, 8)}`]);
    storageDir = await mkdtemp(join(tmpdir(), 'giaokhoa-material-'));
    process.env.FILE_STORAGE_DIR = storageDir;
    identity = await import('../../support/identity-access-helpers');
    courseHelpers = await import('../../support/course-enrolment-helpers');
    app = await identity.createTestApp();
    admin = await identity.adminToken(app);
    [dedicatedA, dedicatedB] = await dedicated.activate(app);
    pg = new Client({ connectionString: withDatabase(adminUrl, dedicatedA.space.databaseName) });
    pgB = new Client({ connectionString: withDatabase(adminUrl, dedicatedB.space.databaseName) });
    bank = new Client({ connectionString: process.env.SYSTEM_BANK_DATABASE_URL });
    await pg.connect(); await pgB.connect(); await bank.connect();
    tenantA = dedicatedA.space.tenantId!;
    tenantB = dedicatedB.space.tenantId!;
    hostA = dedicatedA.host;
    hostB = dedicatedB.host;
    const ma = await dedicated.createUser(app, dedicatedA, 'materialsManagerA');
    const mb = await dedicated.createUser(app, dedicatedB, 'materialsManagerB');
    await dedicated.grantCentreManager(app, dedicatedA, ma.id);
    await dedicated.grantCentreManager(app, dedicatedB, mb.id);
    managerA = ma.token;
    managerB = mb.token;
    const ta = await dedicated.createUser(app, dedicatedA, 'materialsTeacherA');
    const tb = await dedicated.createUser(app, dedicatedB, 'materialsTeacherB');
    teacherA = ta.token;
    teacherB = tb.token;
    await dedicated.grantRole(app, dedicatedA, ta.id, 'editingteacher');
    const sa = await dedicated.createUser(app, dedicatedA, 'materialsStudentA');
    const sb = await dedicated.createUser(app, dedicatedB, 'materialsStudentB');
    const ob = await dedicated.createUser(app, dedicatedB, 'materialsOutsideB');
    studentA = sa.token; studentB = sb.token; outsideB = ob.token;
    studentBId = sb.id; outsideBId = ob.id;
    const system = await identity.systemContextId(app, admin);
    const editorActor = await identity.createUserViaApi(app, admin);
    const editorRole = await identity.createRoleViaApi(app, admin);
    await identity.setOverride(app, admin, editorRole, 'systembank:review', system, 1);
    await identity.assignRole(app, admin, editorActor.id, editorRole, system);
    editor = (await identity.login(app, editorActor.username, identity.STRONG_PASSWORD)).accessToken;
    const category = await courseHelpers.createCategory(app, managerB);
    const course = await courseHelpers.createCourse(app, managerB, category.id);
    courseId = course.id;
    sectionId = await courseHelpers.getFirstSectionId(app, managerB, courseId);
    const content = await identity.http(app).get(`/api/v1/courses/${courseId}/content`).set(bearer(managerB));
    await dedicated.grantRole(app, dedicatedB, tb.id, 'editingteacher', content.body.contextId);
    const instance = await courseHelpers.createEnrolInstance(app, managerB, courseId);
    await courseHelpers.enrolUser(app, managerB, courseId, instance.id, studentBId);
    await courseHelpers.enrolUser(app, managerB, courseId, instance.id, outsideBId);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (app) await app.get<import('pg').Pool>('SHARED_CENTRE_KYSELY').end();
    for (const space of dedicatedFileSpaces) {
      delete process.env[space.secretEnvVar];
      await dropTestDatabase(adminUrl, space.databaseName);
      const cluster = new Client({ connectionString: adminUrl });
      await cluster.connect();
      try { await cluster.query(`DROP ROLE "${space.connectionRole}"`); }
      finally { await cluster.end(); }
    }
    await pg?.end();
    await pgB?.end();
    await bank?.end();
    await dedicated?.cleanup();
    await dropTestDatabase(adminUrl, bankDb);
    await dropTestDatabase(adminUrl, centreDb);
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
    process.env.DATABASE_URL = originalUrl;
    if (oldBankUrl === undefined) delete process.env.SYSTEM_BANK_DATABASE_URL;
    else process.env.SYSTEM_BANK_DATABASE_URL = oldBankUrl;
    if (oldControlPlaneUrl === undefined) delete process.env.CONTROL_PLANE_DATABASE_URL;
    else process.env.CONTROL_PLANE_DATABASE_URL = oldControlPlaneUrl;
    if (oldStorageDir === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = oldStorageDir;
  });

  it('giữ học liệu A riêng, chỉ quản trị gửi và hệ thống duyệt mới công bố byte độc lập kèm nguồn/giấy phép', async () => {
    const created = await identity.http(app).post('/api/v1/contentbank').set(bearer(teacherA)).send({
      name: 'Học liệu riêng A', originalAuthor: 'Tác giả A', sourceKind: 'self', license: 'CC BY 4.0', description: 'Tài liệu bài học',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    sourceId = created.body.id;
    expect(created.body.visibility).toBe('draft');
    const upload = await identity.http(app).post(`/api/v1/contentbank/${sourceId}/file`).set(bearer(teacherA))
      .send({ fileName: 'bai-hoc.pdf', mimeType: 'application/pdf', contentBase64: bytes.toString('base64') });
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    const fileId = upload.body.fileId as string;
    const signedFile = await identity.http(app).post(`/api/v1/files/${fileId}/signed-url`).set(bearer(teacherA));
    expect(signedFile.status, JSON.stringify(signedFile.body)).toBe(201);
    expect((await identity.http(app).get(signedFile.body.url).set('Host', hostA)).body).toEqual(bytes);
    for (const path of [`/api/v1/files/${fileId}`, `/api/v1/files/${fileId}/content`]) {
      expect((await identity.http(app).get(path).set(bearer(managerB))).status).toBe(404);
    }
    expect((await identity.http(app).post(`/api/v1/files/${fileId}/signed-url`).set(bearer(managerB))).status).toBe(404);
    expect((await identity.http(app).get(`/api/v1/contentbank/${sourceId}`).set(bearer(managerB))).status).toBe(404);
    const listB = await identity.http(app).get('/api/v1/contentbank').set(bearer(managerB));
    expect(listB.body.some((row: { id: string }) => row.id === sourceId)).toBe(false);
    expect((await identity.http(app).post(`${ROOT}/submissions`).set(bearer(managerB)).send({ contentId: sourceId })).status).toBe(404);
    expect((await identity.http(app).post(`${ROOT}/submissions`).set(bearer(teacherA)).send({ contentId: sourceId })).status).toBe(403);
    expect((await identity.http(app).get(ROOT).set(bearer(teacherB))).body).toEqual([]);
    const sources = await identity.http(app).get(`${ROOT}/submissions/sources`).set(bearer(managerA));
    expect(sources.status).toBe(200);
    expect(sources.body.some((row: { id: string }) => row.id === sourceId)).toBe(true);
    const submitted = await identity.http(app).post(`${ROOT}/submissions`).set(bearer(managerA)).send({ contentId: sourceId });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const id = submitted.body.id as string;
    const retry = await identity.http(app).post(`${ROOT}/submissions`).set(bearer(managerA)).send({ contentId: sourceId });
    expect(retry.body.id).toBe(id);
    expect((await identity.http(app).get(ROOT).set(bearer(teacherB))).body).toEqual([]);
    for (const token of [teacherB, studentB, managerA]) {
      expect((await identity.http(app).get(`${ROOT}/submissions/${id}`).set(bearer(token))).status).toBe(403);
      expect((await identity.http(app).get(`${ROOT}/submissions/${id}/media`).set(bearer(token))).status).toBe(403);
      expect((await identity.http(app).post(`${ROOT}/submissions/${id}/approve`).set(bearer(token)).send({})).status).toBe(403);
    }
    const reviewMedia = await identity.http(app).get(`${ROOT}/submissions/${id}/media`).set(bearer(editor));
    expect(reviewMedia.status).toBe(200);
    expect(reviewMedia.body).toEqual(bytes);
    const approved = await Promise.all([0, 1].map(() => identity.http(app).post(`${ROOT}/submissions/${id}/approve`).set(bearer(editor)).send({})));
    expect(approved.map((row) => row.status)).toEqual([201, 201]);
    materialId = approved[0]!.body.publishedMaterialId;
    expect(approved[1]!.body.publishedMaterialId).toBe(materialId);
    expect(approved.map((row) => row.body.publishedVersion)).toEqual([1, 1]);
    const published = await identity.http(app).get(`${ROOT}/${materialId}/versions/1`).set(bearer(teacherB));
    expect(published.status).toBe(200);
    expect(published.body.package.source).toMatchObject({ originalAuthor: 'Tác giả A', license: 'CC BY 4.0', sourceKind: 'self', contentId: sourceId });
    expect(JSON.stringify(published.body.package)).not.toContain(fileId);
    expect((await identity.http(app).delete(`/api/v1/files/${fileId}`).set(bearer(teacherA))).status).toBe(200);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const hash = published.body.package.file.contentHash as string;
    await storage.delete(SYSTEM_FILE_DOMAIN, hash);
    expect(await storage.exists(SYSTEM_FILE_DOMAIN, publicationMediaStorageKey(hash))).toBe(true);
    const preserved = await identity.http(app).get(`${ROOT}/${materialId}/versions/1/media`).set(bearer(teacherB));
    expect(preserved.status).toBe(200);
    expect(preserved.headers['cache-control']).toBe('private, no-store');
    expect(preserved.body).toEqual(bytes);
  });

  it('file học liệu ở kho dedicated A ký và tải đúng host; B và platform không mượn được URL hay token', async () => {
    const databasePassword = 'TestG16DedicatedFilesDb!';
    const makeFileSpace = async (label: string) => {
      const slug = `files16-${label}-${randomUUID().slice(0, 8)}`;
      const space = await runSpaceProvision({
        slug, name: `Trung tâm file G16 ${label}`, adminUsername: `filesadmin${label}`,
        adminEmail: `${slug}@example.com`, databasePassword,
        actorId: randomUUID(),
        migrationsDir: join(__dirname, '../../../../../packages/db/migrations/centre'),
        env: { ...process.env }, log: () => undefined,
      });
      dedicatedFileSpaces.push(space);
      const url = new URL(adminUrl);
      url.pathname = `/${space.databaseName}`;
      url.username = space.connectionRole;
      url.password = databasePassword;
      process.env[space.secretEnvVar] = url.toString();
      const activated = await identity.http(app).post('/api/v1/centres/activate-invite')
        .send({ slug, token: space.inviteToken, password: identity.STRONG_PASSWORD });
      expect(activated.status, JSON.stringify(activated.body)).toBe(201);
      const host = `${slug}.test.local`;
      const logged = await identity.http(app).post('/api/v1/auth/token').set('Host', host)
        .send({ username: `filesadmin${label}`, password: identity.STRONG_PASSWORD });
      expect(logged.status, JSON.stringify(logged.body)).toBe(201);
      return { space, host, token: logged.body.accessToken as string };
    };
    const first = await makeFileSpace('a');
    const second = await makeFileSpace('b');
    const created = await identity.http(app).post('/api/v1/contentbank').set(bearer(first.token)).set('Host', first.host).send({
      name: 'Học liệu thuộc host A', originalAuthor: 'Tác giả A', sourceKind: 'self', license: 'CC BY',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const data = Buffer.from('%PDF-1.4\\nHost A');
    const uploaded = await identity.http(app).post(`/api/v1/contentbank/${created.body.id}/file`)
      .set(bearer(first.token)).set('Host', first.host)
      .send({ fileName: 'host-a.pdf', mimeType: 'application/pdf', contentBase64: data.toString('base64') });
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const fileId = uploaded.body.fileId as string;
    const signed = await identity.http(app).post(`/api/v1/files/${fileId}/signed-url`)
      .set(bearer(first.token)).set('Host', first.host);
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    const downloaded = await identity.http(app).get(signed.body.url).set('Host', hostA).set('Host', first.host);
    expect(downloaded.status, JSON.stringify(downloaded.body)).toBe(200);
    expect(downloaded.body).toEqual(data);
    expect((await identity.http(app).get(signed.body.url).set('Host', hostA).set('Host', second.host)).status).toBe(404);
    expect((await identity.http(app).get(signed.body.url).set('Host', hostA)).status).toBe(404);
    expect((await identity.http(app).get(`/api/v1/files/${fileId}/content`).set(bearer(second.token)).set('Host', second.host)).status).toBe(404);
    expect((await identity.http(app).post(`/api/v1/files/${fileId}/signed-url`).set(bearer(second.token)).set('Host', second.host)).status).toBe(404);
  });

  it('học liệu cá nhân và file legacy neo context USER được chủ trung tâm A đọc, B không vượt tenant', async () => {
    const data = Buffer.from('%PDF-1.4\nTai lieu cu A');
    const created = await identity.http(app).post('/api/v1/contentbank').set(bearer(teacherA)).send({
      name: 'Học liệu USER cũ A', originalAuthor: 'Tác giả A', sourceKind: 'self', license: 'CC BY',
    });
    expect(created.status).toBe(201);
    const sourceId = created.body.id as string;
    const uploaded = await identity.http(app).post(`/api/v1/contentbank/${sourceId}/file`).set(bearer(teacherA))
      .send({ fileName: 'legacy.pdf', mimeType: 'application/pdf', contentBase64: data.toString('base64') });
    expect(uploaded.status).toBe(201);
    const fileId = uploaded.body.fileId as string;
    const original = (await pg.query('select content_hash from files where id = $1', [fileId])).rows[0];
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const legacyPath = storage.keyFor(LEGACY_FILE_DOMAIN, original.content_hash);
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, data);
    await pg.query('update files set storage_domain = $1 where id = $2', [LEGACY_FILE_DOMAIN, fileId]);
    expect((await identity.http(app).get(`/api/v1/contentbank/${sourceId}`).set(bearer(teacherA))).status).toBe(200);
    expect((await identity.http(app).get(`/api/v1/contentbank/${sourceId}`).set(bearer(managerB))).status).toBe(404);
    const received = await identity.http(app).get(`/api/v1/files/${fileId}/content`).set(bearer(teacherA));
    expect(received.status, JSON.stringify(received.body)).toBe(200);
    expect(received.body).toEqual(data);
    const signed = await identity.http(app).post(`/api/v1/files/${fileId}/signed-url`).set(bearer(teacherA));
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    const signedDownload = await identity.http(app).get(signed.body.url).set('Host', hostA);
    expect(signedDownload.status, JSON.stringify(signedDownload.body)).toBe(200);
    expect(signedDownload.body).toEqual(data);
    const validUrl = signed.body.url as string;
    const parsed = new URL(validUrl, 'http://localhost');
    const sig = parsed.searchParams.get('sig')!;
    const changedSig = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    const urlWithSig = (newSig: string) => `${parsed.pathname}?sig=${encodeURIComponent(newSig)}`;
    expect((await identity.http(app).get(`/api/v1/files/${fileId}/download`).set('Host', hostA)).status).toBe(401);
    expect((await identity.http(app).get(urlWithSig(changedSig)).set('Host', hostA)).status).toBe(401);
    const wrongDomain = app.get(FileSigningService).sign(fileId, fileDomainForSpace('22222222-2222-7222-8222-222222222222'));
    expect((await identity.http(app).get(urlWithSig(wrongDomain.token)).set('Host', hostA)).status).toBe(401);
    const time = Date.now();
    const timeSpy = vi.spyOn(Date, 'now').mockReturnValue(time - 3_600_000);
    let expiredSigned: { status: number; body: { url: string } };
    try {
      expiredSigned = await identity.http(app).post(`/api/v1/files/${fileId}/signed-url`).set(bearer(teacherA));
    } finally {
      timeSpy.mockRestore();
    }
    expect(expiredSigned.status).toBe(201);
    expect((await identity.http(app).get(expiredSigned.body.url).set('Host', hostA)).status).toBe(401);
    const other = await identity.http(app).post('/api/v1/contentbank').set(bearer(teacherA)).send({
      name: 'Học liệu USER khác A', originalAuthor: 'Tác giả A', sourceKind: 'self', license: 'CC BY',
    });
    expect(other.status).toBe(201);
    const otherUpload = await identity.http(app).post(`/api/v1/contentbank/${other.body.id}/file`).set(bearer(teacherA))
      .send({ fileName: 'khac.pdf', mimeType: 'application/pdf', contentBase64: data.toString('base64') });
    expect(otherUpload.status).toBe(201);
    expect((await identity.http(app).get(validUrl.replace(fileId, otherUpload.body.fileId)).set('Host', hostA)).status).toBe(401);
    expect((await identity.http(app).post(`/api/v1/files/${fileId}/signed-url`).set(bearer(managerB))).status).toBe(404);
    const signedAtDedicatedHost = await identity.http(app).post(`/api/v1/files/${fileId}/signed-url`)
      .set(bearer(teacherA)).set('Host', hostA);
    expect(signedAtDedicatedHost.status).toBe(201);
    expect((await identity.http(app).get(validUrl).set('Host', hostA)).status).toBe(200);
    expect((await identity.http(app).get(validUrl).set('Host', hostB)).status).toBe(404);
    expect((await identity.http(app).get(validUrl)).status).toBe(404);
    expect((await identity.http(app).get(`/api/v1/files/${fileId}/content`).set(bearer(managerB))).status).toBe(404);
    expect((await identity.http(app).get(`/api/v1/files/${fileId}`).set(bearer(managerB))).status).toBe(404);
  });

  it('giáo viên B ghim phiên bản, chỉ học viên đúng nhóm xem được qua player, ID tài nguyên và URL byte', async () => {
    const use = await identity.http(app).post(`${ROOT}/use`).set(bearer(teacherB)).send({ materialId, version: 1, courseId, sectionId });
    expect(use.status, JSON.stringify(use.body)).toBe(201);
    resourceId = use.body.resourceId;
    cmId = use.body.cmId;
    expect((await identity.http(app).get('/api/v1/contentbank').set(bearer(teacherB))).body).toEqual([]);
    const patch = await identity.http(app).patch(`/api/v1/resources/${resourceId}`).set(bearer(teacherB)).send({ name: 'Sửa bản dùng' });
    expect(patch.status).toBe(409);
    const group = await identity.http(app).post(`/api/v1/courses/${courseId}/groups`).set(bearer(teacherB)).send({ name: 'Nhóm được học' });
    expect(group.status).toBe(201);
    expect((await identity.http(app).post(`/api/v1/courses/${courseId}/groups/${group.body.id}/members`).set(bearer(teacherB)).send({ userId: studentBId })).status).toBe(201);
    const restrict = await identity.http(app).patch(`/api/v1/courses/${courseId}/modules/${cmId}`).set(bearer(teacherB))
      .send({ availability: { op: '&', c: [{ type: 'group', id: group.body.id }], showc: [false] } });
    expect(restrict.status, JSON.stringify(restrict.body)).toBe(200);
    const bankBefore = await bank.query('select * from system_material_versions order by id');
    const playerPath = `/api/v1/courses/${courseId}/player/${cmId}`;
    const contentPath = `/api/v1/resources/${resourceId}/system-material/content`;
    const player = await identity.http(app).get(playerPath).set(bearer(studentB));
    expect(player.status, JSON.stringify(player.body)).toBe(200);
    expect(player.body.content.resource.publication.version).toBe(1);
    expect(player.body.content.file.contentUrl).toBe(contentPath);
    expect((await identity.http(app).get(contentPath).set(bearer(studentB))).body).toEqual(bytes);
    expect((await identity.http(app).get(`/api/v1/resources/${resourceId}`).set(bearer(studentB))).status).toBe(200);
    for (const token of [outsideB, studentA]) {
      for (const path of [playerPath, `/api/v1/resources/${resourceId}`, contentPath]) {
        const denied = await identity.http(app).get(path).set(bearer(token));
        expect([403, 404], `${path}: ${JSON.stringify(denied.body)}`).toContain(denied.status);
      }
    }
    expect((await identity.http(app).get(contentPath)).status).toBe(401);
    for (const path of [ROOT, `${ROOT}/${materialId}/versions/1`, `${ROOT}/${materialId}/versions/1/media`]) {
      expect((await identity.http(app).get(path).set(bearer(studentB))).status).toBe(403);
    }
    expect((await bank.query('select * from system_material_versions order by id')).rows).toEqual(bankBefore.rows);
    const columns = await bank.query("select column_name from information_schema.columns where table_name like 'system_material%' ");
    for (const forbidden of ['course_id', 'student_id', 'cm_id', 'enrolment_id']) expect(columns.rows.map((row) => row.column_name)).not.toContain(forbidden);
    const courseData = JSON.stringify((await bank.query('select package from system_material_versions')).rows);
    for (const privateId of [courseId, studentBId, outsideBId, cmId]) expect(courseData).not.toContain(privateId);
    expect((await identity.http(app).delete(`/api/v1/courses/${courseId}/groups/${group.body.id}/members/${studentBId}`).set(bearer(teacherB))).status).toBe(200);
    expect((await identity.http(app).get(contentPath).set(bearer(studentB))).status).toBe(403);
  });

  it('từ chối có lý do, bản nguồn mới thành phiên bản mới; bản cũ vẫn nguyên và nguồn có thể xoá', async () => {
    const v1 = await identity.http(app).get(`${ROOT}/${materialId}/versions/1`).set(bearer(teacherB));
    const changed = await identity.http(app).patch(`/api/v1/contentbank/${sourceId}`).set(bearer(teacherA))
      .send({ name: 'Học liệu A bản mới' });
    expect(changed.status).toBe(200);
    await identity.http(app).post(`/api/v1/contentbank/${sourceId}/file`).set(bearer(teacherA)).send({ fileName: 'ban-moi.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4\nBan moi').toString('base64') }).expect(201);
    const submit = await identity.http(app).post(`${ROOT}/submissions`).set(bearer(managerA)).send({ contentId: sourceId });
    expect(submit.status, JSON.stringify(submit.body)).toBe(201);
    const id = submit.body.id as string;
    expect((await identity.http(app).post(`${ROOT}/submissions/${id}/reject`).set(bearer(editor)).send({ reason: ' ' })).status).toBe(400);
    expect((await identity.http(app).post(`${ROOT}/submissions/${id}/reject`).set(bearer(editor)).send({ reason: 'Cần ghi rõ nguồn' })).status).toBe(201);
    expect((await identity.http(app).post(`${ROOT}/submissions`).set(bearer(managerA)).send({ contentId: sourceId })).status).toBe(409);
    await identity.http(app).patch(`/api/v1/contentbank/${sourceId}`).set(bearer(teacherA)).send({ sourceCitation: 'Nguồn đã kiểm tra' }).expect(200);
    const next = await identity.http(app).post(`${ROOT}/submissions`).set(bearer(managerA)).send({ contentId: sourceId });
    const approved = await identity.http(app).post(`${ROOT}/submissions/${next.body.id}/approve`).set(bearer(editor)).send({});
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body).toMatchObject({ publishedMaterialId: materialId, publishedVersion: 2 });
    expect((await identity.http(app).get(`${ROOT}/${materialId}/versions/1`).set(bearer(teacherB))).body).toEqual(v1.body);
    const sourceFiles = await pg.query('select id, content_hash from files where item_id=$1', [sourceId]);
    expect(sourceFiles.rows.length).toBeGreaterThan(0);
    await identity.http(app).delete(`/api/v1/contentbank/${sourceId}`).set(bearer(teacherA)).expect(200);
    expect((await pg.query('select id from files where item_id=$1', [sourceId])).rows).toEqual([]);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    for (const sourceFile of sourceFiles.rows) await storage.delete(SYSTEM_FILE_DOMAIN, sourceFile.content_hash);
    const v2Media = await identity.http(app).get(`${ROOT}/${materialId}/versions/2/media`).set(bearer(teacherB));
    expect(v2Media.status).toBe(200);
    expect(v2Media.body).toEqual(Buffer.from('%PDF-1.4\nBan moi'));
    expect((await identity.http(app).get(`${ROOT}/${materialId}/versions/1/media`).set(bearer(teacherB))).body).toEqual(bytes);
    const receipt = await pgB.query('select system_material_version from resources where id=$1', [resourceId]);
    expect(receipt.rows[0].system_material_version).toBe(1);
    await expect(bank.query('update system_material_versions set checksum=$1 where material_id=$2', ['0'.repeat(64), materialId])).rejects.toThrow('system_material.version_immutable');
  });

  it('không công bố câu hỏi tham chiếu, nguồn thiếu giấy phép hoặc URL file riêng; liên kết hợp lệ dùng qua player hiện có', async () => {
    const create = async (input: Record<string, unknown>) => {
      const row = await identity.http(app).post('/api/v1/contentbank').set(bearer(teacherA)).send({
        name: 'Bài học liên kết', originalAuthor: 'Tác giả', sourceKind: 'self', license: 'CC BY', ...input,
      });
      expect(row.status, JSON.stringify(row.body)).toBe(201);
      return row.body.id as string;
    };
    for (const input of [
      { license: '', externalUrl: 'https://example.org/lesson' },
      { externalUrl: 'https://example.org/api/v1/files/01961300-0000-7000-8000-000000000123/content' },
      { externalUrl: 'https://centre-a.example.org/private/storage/student-session.pdf' },
      { externalUrl: 'https://centre-a.example.org/download.pdf?access_token=temporary-secret' },
      { externalUrl: 'http://localhost/private-file.pdf' },
      { externalUrl: 'https://files.internal/lesson.pdf' },
      ...(process.env.BETTER_AUTH_URL
        ? [{ externalUrl: `https://trung-tam-a.${new URL(process.env.BETTER_AUTH_URL).hostname}/lesson` }]
        : []),
      { resourceType: 'question_set' },
      { sourceKind: 'cited', externalUrl: 'https://example.org/lesson' },
    ]) {
      const contentId = await create(input);
      expect((await identity.http(app).post(`${ROOT}/submissions`).set(bearer(managerA)).send({ contentId })).status).toBe(400);
    }
    const contentId = await create({ externalUrl: 'https://example.org/lesson' });
    const sent = await identity.http(app).post(`${ROOT}/submissions`).set(bearer(managerA)).send({ contentId });
    expect(sent.status).toBe(201);
    const approved = await identity.http(app).post(`${ROOT}/submissions/${sent.body.id}/approve`).set(bearer(editor)).send({});
    expect(approved.status).toBe(201);
    const used = await identity.http(app).post(`${ROOT}/use`).set(bearer(teacherB)).send({ materialId: approved.body.publishedMaterialId, version: 1, courseId, sectionId });
    expect(used.status).toBe(201);
    const player = await identity.http(app).get(`/api/v1/courses/${courseId}/player/${used.body.cmId}`).set(bearer(studentB));
    expect(player.status).toBe(200);
    expect(player.body.content.resource).toMatchObject({ kind: 'url', url: 'https://example.org/lesson' });
    expect(player.body.content.file).toBeNull();
    expect((await identity.http(app).post(`${ROOT}/use`).set(bearer(studentB)).send({ materialId, version: 1, courseId, sectionId })).status).toBe(403);
    expect((await identity.http(app).post(`${ROOT}/use`).set(bearer(teacherA)).send({ materialId, version: 1, courseId, sectionId })).status).toBe(404);
  });

  it('RLS trên học liệu và tài nguyên fail-closed với role không BYPASSRLS, giữ phiên bản bất biến ở kho công bố', async () => {
    const role = `g16_rls_${suffix}`;
    await pg.query(`CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS`);
    try {
      await pg.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await pg.query(`GRANT SELECT ON content_bank_content, resources, course TO "${role}"`);
      await pg.query(`SET ROLE "${role}"`);
      await pg.query("select set_config('app.platform', 'off', false)");
      await pg.query("select set_config('app.tenant_id', '', false)");
      expect((await pg.query('select id from content_bank_content')).rows).toEqual([]);
      expect((await pg.query('select id from resources')).rows).toEqual([]);
      await pg.query("select set_config('app.tenant_id', $1, false)", [tenantA]);
      expect((await pg.query('select id from content_bank_content')).rows.length).toBeGreaterThan(0);
      expect((await pg.query('select id from resources')).rows).toEqual([]);
      await pg.query("select set_config('app.tenant_id', $1, false)", [tenantB]);
      expect((await pg.query('select id from content_bank_content')).rows).toEqual([]);
      expect((await pg.query('select id from resources where id=$1', [resourceId])).rows).toEqual([]);
    } finally {
      await pg.query('RESET ROLE');
      await pg.query(`DROP OWNED BY "${role}"`);
      await pg.query(`DROP ROLE "${role}"`);
    }
    // The other centre is a physically separate database, not merely another RLS GUC.
    const roleB = `${role}_b`;
    await pgB.query(`CREATE ROLE "${roleB}" NOLOGIN NOBYPASSRLS`);
    try {
      await pgB.query(`GRANT USAGE ON SCHEMA public TO "${roleB}"`);
      await pgB.query(`GRANT SELECT ON resources, content_bank_content, course TO "${roleB}"`);
      await pgB.query(`SET ROLE "${roleB}"`);
      await pgB.query("select set_config('app.platform', 'off', false)");
      await pgB.query("select set_config('app.tenant_id', '', false)");
      expect((await pgB.query('select id from resources')).rows).toEqual([]);
      await pgB.query("select set_config('app.tenant_id', $1, false)", [tenantA]);
      expect((await pgB.query('select id from resources')).rows).toEqual([]);
      await pgB.query("select set_config('app.tenant_id', $1, false)", [tenantB]);
      expect((await pgB.query('select id from resources where id=$1', [resourceId])).rows).toEqual([{ id: resourceId }]);
      expect((await pgB.query('select id from content_bank_content')).rows).toEqual([]);
    } finally {
      await pgB.query('RESET ROLE');
      await pgB.query(`DROP OWNED BY "${roleB}"`);
      await pgB.query(`DROP ROLE "${roleB}"`);
    }
  });


  it('tạo module xong nhưng gắn bản tiếp nhận lỗi thì dọn cả module, context và resource', async () => {
    const before = await pgB.query('select id from course_modules where course=$1 order by id', [courseId]);
    const resourceBefore = await pgB.query('select id from resources where course=$1 order by id', [courseId]);
    const contextsBefore = await pgB.query('select id from context where context_level=70 order by id');
    const failure = vi.spyOn(app.get(SystemMaterialReferencesRepository), 'attach')
      .mockRejectedValueOnce(new ConflictException('Simulated reference write conflict'));
    try {
      const result = await identity.http(app).post(`${ROOT}/use`).set(bearer(teacherB)).send({ materialId, version: 1, courseId, sectionId });
      expect(result.status).toBe(409);
    } finally { failure.mockRestore(); }
    expect((await pgB.query('select id from course_modules where course=$1 order by id', [courseId])).rows).toEqual(before.rows);
    expect((await pgB.query('select id from resources where course=$1 order by id', [courseId])).rows).toEqual(resourceBefore.rows);
    expect((await pgB.query('select id from context where context_level=70 order by id')).rows).toEqual(contextsBefore.rows);
  });


  it('rút nguồn học liệu: chỉ B đã nhận được dùng lại đúng phiên bản, giữ player và phát cảnh báo', async () => {
    const revoked = await identity.http(app).post(`${ROOT}/${materialId}/withdraw`)
      .set(bearer(editor)).send({ reason: 'Nội dung không còn phù hợp' });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(201);
    const reviewer = await identity.http(app).get(`${ROOT}/published`).set(bearer(editor));
    expect(reviewer.status).toBe(200);
    expect(reviewer.body.some((item: { materialId: string }) => item.materialId === materialId)).toBe(false);
    const discovery = await identity.http(app).get(ROOT).set(bearer(teacherB));
    expect(discovery.status).toBe(200);
    expect(discovery.body.some((item: { materialId: string }) => item.materialId === materialId)).toBe(false);
    const used = await identity.http(app).get(`${ROOT}/used`).set(bearer(teacherB));
    expect(used.status).toBe(200);
    expect(used.body).toEqual(expect.arrayContaining([expect.objectContaining({
      resourceId, materialId, version: 1, latestVersion: 2, sourceStatus: 'withdrawn',
    })]));
    expect((await identity.http(app).get(`${ROOT}/${materialId}/versions/1`)
      .set(bearer(teacherB))).status).toBe(200);
    expect((await identity.http(app).get(`${ROOT}/${materialId}/versions/2`)
      .set(bearer(teacherB))).status).toBe(404);
    const denied = await identity.http(app).post(`${ROOT}/use`).set(bearer(teacherB))
      .send({ materialId, version: 2, courseId, sectionId });
    expect(denied.status).toBe(404);
    const reused = await identity.http(app).post(`${ROOT}/use`).set(bearer(teacherB))
      .send({ materialId, version: 1, courseId, sectionId });
    expect(reused.status, JSON.stringify(reused.body)).toBe(201);
    const pinned = await pgB.query('select system_material_id, system_material_version from resources where id=$1', [resourceId]);
    expect(pinned.rows[0]).toMatchObject({ system_material_id: materialId, system_material_version: 1 });
    const pending = await identity.http(app).get('/api/v1/system-bank/events/pending').set(bearer(managerB));
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    const event = pending.body.find((item: { type: string }) => item.type === 'material_withdrawn');
    expect(event?.resourceKey).toBe(materialId);
    expect((await identity.http(app).post(`/api/v1/system-bank/events/${event.id}/acknowledge`)
      .set(bearer(managerB)).send({})).status).toBe(201);
  });

});
