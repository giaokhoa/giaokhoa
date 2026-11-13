import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  adminToken, assignRole, createContextViaApi, createRoleViaApi, createTestApp, createUserViaApi, http, roleIdByShortname, setOverride, systemContextId, uniqueName,
} from '../../support/identity-access-helpers';

describe('Access: tổng hợp vai trò, ma trận thay toàn bộ, bảng gán vai và chốt xoá (issue #545)', () => {
  let app: INestApplication;
  let pg: Client;
  let admin: string;
  let systemId: string;
  let catalog: { name: string; capType: string }[];

  const resourceOf = (capability: string) => capability.split(':')[0];

  beforeAll(async () => {
    app = await createTestApp();
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    admin = await adminToken(app);
    systemId = await systemContextId(app, admin);
    const capsRes = await http(app).get('/api/v1/access/capabilities').set('Authorization', `Bearer ${admin}`);
    if (capsRes.status !== 200) throw new Error(`không nạp được danh mục năng lực: HTTP ${capsRes.status}`);
    catalog = capsRes.body as { name: string; capType: string }[];
  });
  afterAll(async () => { await pg.end(); await app.close(); });

  function sampleCapabilities() {
    const readCap = catalog.find((c) => c.capType === 'read');
    const writeSameResource = catalog.find((c) => c.capType === 'write' && resourceOf(c.name) === resourceOf(readCap!.name));
    const writeOtherResource = catalog.find((c) => c.capType === 'write' && resourceOf(c.name) !== resourceOf(readCap!.name));
    if (!readCap || !writeSameResource || !writeOtherResource) throw new Error('danh mục mẫu thiếu năng lực read/write cần cho ca kiểm');
    return { readCap, writeSameResource, writeOtherResource };
  }

  async function roleRowFromList(roleId: string) {
    const res = await http(app).get('/api/v1/access/roles').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    const row = (res.body as { id: string }[]).find((r) => r.id === roleId);
    if (!row) throw new Error(`role ${roleId} vắng mặt trong danh sách vai`);
    return row as {
      id: string; userCount: number; overrideCount: number;
      readOverrideCount: number; writeOverrideCount: number; resourceCount: number;
    };
  }

  async function savedOverridesAt(roleId: string, contextId: string) {
    const res = await http(app).get(`/api/v1/access/roles/${roleId}/capabilities`).set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    return (res.body as { contextId: string; capability: string; permission: number }[])
      .filter((row) => row.contextId === contextId)
      .map((row) => ({ capability: row.capability, permission: row.permission }))
      .sort((a, b) => a.capability.localeCompare(b.capability));
  }

  it('danh sách vai trả đúng số người giữ phân biệt và tổng hợp năng lực, đối chiếu với bảng gốc', async () => {
    const { readCap, writeSameResource, writeOtherResource } = sampleCapabilities();
    const roleId = await createRoleViaApi(app, admin);
    const catContextId = (await createContextViaApi(app, admin, 40, uuidv7(), systemId)).id;
    const userA = await createUserViaApi(app, admin);
    const userB = await createUserViaApi(app, admin);

    await assignRole(app, admin, userA.id, roleId, systemId);
    await assignRole(app, admin, userA.id, roleId, catContextId);
    await assignRole(app, admin, userB.id, roleId, systemId);

    await setOverride(app, admin, roleId, readCap.name, systemId, 1);
    await setOverride(app, admin, roleId, writeSameResource.name, systemId, -1);
    await setOverride(app, admin, roleId, writeOtherResource.name, catContextId, 1);

    const row = await roleRowFromList(roleId);
    expect(row.userCount).toBe(2);
    expect(row.overrideCount).toBe(3);
    expect(row.readOverrideCount).toBe(1);
    expect(row.writeOverrideCount).toBe(2);
    expect(row.resourceCount).toBe(2);

    const pgUsers = await pg.query<{ n: string }>(
      'select count(distinct user_id) as n from role_assignments where role_id = $1', [roleId]);
    expect(Number(pgUsers.rows[0].n)).toBe(row.userCount);
    const pgAgg = await pg.query<{ total: string; reads: string; writes: string; resources: string }>(
      `select count(*) as total,
              coalesce(sum(case when c.cap_type = 'read' then 1 else 0 end), 0) as reads,
              coalesce(sum(case when c.cap_type = 'write' then 1 else 0 end), 0) as writes,
              count(distinct split_part(rc.capability, ':', 1)) as resources
         from role_capabilities rc
         left join capabilities c on c.name = rc.capability
        where rc.role_id = $1`, [roleId]);
    expect(Number(pgAgg.rows[0].total)).toBe(row.overrideCount);
    expect(Number(pgAgg.rows[0].reads)).toBe(row.readOverrideCount);
    expect(Number(pgAgg.rows[0].writes)).toBe(row.writeOverrideCount);
    expect(Number(pgAgg.rows[0].resources)).toBe(row.resourceCount);

    const emptyRoleId = await createRoleViaApi(app, admin);
    const emptyRow = await roleRowFromList(emptyRoleId);
    expect(emptyRow.userCount).toBe(0);
    expect(emptyRow.overrideCount).toBe(0);
    expect(emptyRow.readOverrideCount).toBe(0);
    expect(emptyRow.writeOverrideCount).toBe(0);
    expect(emptyRow.resourceCount).toBe(0);
  });

  it('lưu ma trận thay toàn bộ: tập cũ bị thay đúng, phần tử bị loại trở về kế thừa, lỗi kiểm chứng không đổi dữ kiện', async () => {
    const [capA, capB, capC, capD] = [...catalog].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 4);
    const roleId = await createRoleViaApi(app, admin);
    const contextId = (await createContextViaApi(app, admin, 40, uuidv7(), systemId)).id;

    await setOverride(app, admin, roleId, capA.name, contextId, 1);
    await setOverride(app, admin, roleId, capB.name, contextId, 1);

    const put = (overrides: { capability: string; permission: number }[]) =>
      http(app).put(`/api/v1/access/roles/${roleId}/capabilities`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ contextId, overrides });

    const applied = await put([
      { capability: capB.name, permission: -1 },
      { capability: capC.name, permission: -1000 },
      { capability: capD.name, permission: 0 },
    ]);
    expect(applied.status).toBe(200);
    expect(applied.body.roleId).toBe(roleId);
    expect(applied.body.contextId).toBe(contextId);
    const expectedSaved = [
      { capability: capB.name, permission: -1 },
      { capability: capC.name, permission: -1000 },
    ].sort((a, b) => a.capability.localeCompare(b.capability));
    expect(applied.body.overrides).toEqual(expectedSaved);
    expect(await savedOverridesAt(roleId, contextId)).toEqual(expectedSaved);
    const pgRows = await pg.query<{ capability: string; permission: number }>(
      'select capability, permission from role_capabilities where role_id = $1 and context_id = $2 order by capability',
      [roleId, contextId]);
    expect(pgRows.rows).toEqual(expectedSaved);

    const unknown = await put([{ capability: 'nosuch:capability', permission: 1 }]);
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('access.unknown_capability');
    expect(await savedOverridesAt(roleId, contextId)).toEqual(expectedSaved);

    const badPermission = await put([{ capability: capA.name, permission: 7 }]);
    expect(badPermission.status).toBe(400);
    expect(badPermission.body.code).toBe('access.invalid_permission');
    expect(await savedOverridesAt(roleId, contextId)).toEqual(expectedSaved);

    const duplicated = await put([
      { capability: capA.name, permission: 1 },
      { capability: capA.name, permission: -1 },
    ]);
    expect(duplicated.status).toBe(400);
    expect(duplicated.body.code).toBe('access.duplicate_capability_override');
    expect(await savedOverridesAt(roleId, contextId)).toEqual(expectedSaved);

    const cleared = await put([]);
    expect(cleared.status).toBe(200);
    expect(cleared.body.overrides).toEqual([]);
    expect(await savedOverridesAt(roleId, contextId)).toEqual([]);
  });

  it('bảng gán vai lọc theo vai, tìm đúng theo tên và email, phân trang kèm tổng số và danh tính người dùng', async () => {
    const roleId = await createRoleViaApi(app, admin);
    const catContextId = (await createContextViaApi(app, admin, 40, uuidv7(), systemId)).id;
    const marker = uniqueName('kt545');
    const userOne = await createUserViaApi(app, admin, {
      firstName: 'Kiem545', lastName: 'Tra545', email: `${marker}@example.com`,
    });
    const userTwo = await createUserViaApi(app, admin, {
      firstName: 'Khac545', lastName: 'Biet545',
    });
    await assignRole(app, admin, userOne.id, roleId, systemId);
    await assignRole(app, admin, userOne.id, roleId, catContextId);
    await assignRole(app, admin, userTwo.id, roleId, systemId);

    const list = (query: Record<string, string | number>) =>
      http(app).get('/api/v1/access/assignments').query(query).set('Authorization', `Bearer ${admin}`);

    const byRole = await list({ roleId });
    expect(byRole.status).toBe(200);
    expect(byRole.body.total).toBe(3);
    expect(byRole.body.page).toBe(1);
    expect(byRole.body.pageSize).toBe(20);
    expect(byRole.body.assignments).toHaveLength(3);
    for (const row of byRole.body.assignments as { roleId: string; component: string; updatedAt: string }[]) {
      expect(row.roleId).toBe(roleId);
      expect(row.component).toBe('');
      expect(typeof row.updatedAt).toBe('string');
    }
    const rowsOfOne = (byRole.body.assignments as { userId: string; userName: string; userEmail: string }[])
      .filter((row) => row.userId === userOne.id);
    expect(rowsOfOne).toHaveLength(2);
    expect(rowsOfOne[0].userName).toBe('Kiem545 Tra545');
    expect(rowsOfOne[0].userEmail).toBe(`${marker}@example.com`);

    const byLastName = await list({ roleId, search: 'Tra545' });
    expect(byLastName.body.total).toBe(2);
    const byFullName = await list({ roleId, search: 'Kiem545 Tra545' });
    expect(byFullName.body.total).toBe(2);
    const byEmail = await list({ roleId, search: marker });
    expect(byEmail.body.total).toBe(2);
    const byOther = await list({ roleId, search: 'Biet545' });
    expect(byOther.body.total).toBe(1);
    expect((byOther.body.assignments as { userId: string }[])[0].userId).toBe(userTwo.id);

    const byContext = await list({ roleId, contextId: catContextId });
    expect(byContext.body.total).toBe(1);
    expect((byContext.body.assignments as { contextId: string }[])[0].contextId).toBe(catContextId);

    const pageRoleId = await createRoleViaApi(app, admin);
    for (let i = 0; i < 5; i += 1) {
      const pageUser = await createUserViaApi(app, admin);
      await assignRole(app, admin, pageUser.id, pageRoleId, systemId);
    }
    const seen = new Set<string>();
    const pageSizes: number[] = [];
    for (const page of [1, 2, 3]) {
      const res = await list({ roleId: pageRoleId, page, pageSize: 2 });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
      expect(res.body.page).toBe(page);
      expect(res.body.pageSize).toBe(2);
      pageSizes.push((res.body.assignments as { id: string }[]).length);
      for (const row of res.body.assignments as { id: string }[]) seen.add(row.id);
    }
    expect(pageSizes).toEqual([2, 2, 1]);
    expect(seen.size).toBe(5);
  });

  it('bảng gán vai lọc theo userId trả đúng các dòng của người đó và kết hợp đúng với lọc vai, context, tìm kiếm và phân trang (issue #560)', async () => {
    const roleId = await createRoleViaApi(app, admin);
    const otherRoleId = await createRoleViaApi(app, admin);
    const catContextId = (await createContextViaApi(app, admin, 40, uuidv7(), systemId)).id;
    const marker = uniqueName('uf560');
    const userOne = await createUserViaApi(app, admin, {
      firstName: 'Loc560', lastName: 'Rieng560', email: `${marker}@example.com`,
    });
    const userTwo = await createUserViaApi(app, admin);
    await assignRole(app, admin, userOne.id, roleId, systemId);
    await assignRole(app, admin, userOne.id, roleId, catContextId);
    await assignRole(app, admin, userOne.id, otherRoleId, systemId);
    await assignRole(app, admin, userTwo.id, roleId, systemId);

    const list = (query: Record<string, string | number>) =>
      http(app).get('/api/v1/access/assignments').query(query).set('Authorization', `Bearer ${admin}`);

    const byUser = await list({ userId: userOne.id });
    expect(byUser.status).toBe(200);
    expect(byUser.body.total).toBe(3);
    expect(byUser.body.assignments).toHaveLength(3);
    for (const row of byUser.body.assignments as { userId: string }[]) {
      expect(row.userId).toBe(userOne.id);
    }

    const noAssignments = await createUserViaApi(app, admin);
    const byEmptyUser = await list({ userId: noAssignments.id });
    expect(byEmptyUser.status).toBe(200);
    expect(byEmptyUser.body.total).toBe(0);
    expect(byEmptyUser.body.assignments).toEqual([]);

    const byUserAndRole = await list({ userId: userOne.id, roleId: otherRoleId });
    expect(byUserAndRole.body.total).toBe(1);
    expect((byUserAndRole.body.assignments as { roleId: string }[])[0].roleId).toBe(otherRoleId);
    const byUserAndMainRole = await list({ userId: userOne.id, roleId });
    expect(byUserAndMainRole.body.total).toBe(2);

    const byUserAndContext = await list({ userId: userOne.id, contextId: catContextId });
    expect(byUserAndContext.body.total).toBe(1);
    expect((byUserAndContext.body.assignments as { contextId: string }[])[0].contextId).toBe(catContextId);

    const byUserAndSearch = await list({ userId: userOne.id, search: 'Rieng560' });
    expect(byUserAndSearch.body.total).toBe(3);
    const byUserAndForeignSearch = await list({ userId: userTwo.id, search: 'Rieng560' });
    expect(byUserAndForeignSearch.body.total).toBe(0);

    const pageTwo = await list({ userId: userOne.id, page: 2, pageSize: 2 });
    expect(pageTwo.status).toBe(200);
    expect(pageTwo.body.total).toBe(3);
    expect(pageTwo.body.page).toBe(2);
    expect(pageTwo.body.pageSize).toBe(2);
    expect(pageTwo.body.assignments).toHaveLength(1);
  });

  it('xoá vai bị chặn với vai dựng sẵn và vai đang còn người giữ — hai lỗi phân biệt được; vai thường không còn người giữ xoá được', async () => {
    const managerId = await roleIdByShortname(app, admin, 'manager');
    const builtin = await http(app).delete(`/api/v1/access/roles/${managerId}`).set('Authorization', `Bearer ${admin}`);
    expect(builtin.status).toBe(400);
    expect(builtin.body.code).toBe('access.role_archetype_delete_forbidden');
    expect((await http(app).get(`/api/v1/access/roles/${managerId}`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);

    const heldRoleId = await createRoleViaApi(app, admin);
    const holder = await createUserViaApi(app, admin);
    await assignRole(app, admin, holder.id, heldRoleId, systemId);
    const held = await http(app).delete(`/api/v1/access/roles/${heldRoleId}`).set('Authorization', `Bearer ${admin}`);
    expect(held.status).toBe(400);
    expect(held.body.code).toBe('access.role_has_assignments');
    expect(held.body.code).not.toBe(builtin.body.code);
    expect((await http(app).get(`/api/v1/access/roles/${heldRoleId}`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);

    const overrideOnlyRoleId = await createRoleViaApi(app, admin);
    const anyCap = catalog[0].name;
    await setOverride(app, admin, overrideOnlyRoleId, anyCap, systemId, 1);
    const removedWithOverrides = await http(app).delete(`/api/v1/access/roles/${overrideOnlyRoleId}`).set('Authorization', `Bearer ${admin}`);
    expect(removedWithOverrides.status).toBe(200);
    expect(removedWithOverrides.body).toEqual({ deleted: true });
    const pgLeftovers = await pg.query<{ n: string }>(
      'select count(*) as n from role_capabilities where role_id = $1', [overrideOnlyRoleId]);
    expect(Number(pgLeftovers.rows[0].n)).toBe(0);

    const plainRoleId = await createRoleViaApi(app, admin);
    const removed = await http(app).delete(`/api/v1/access/roles/${plainRoleId}`).set('Authorization', `Bearer ${admin}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true });
    expect((await http(app).get(`/api/v1/access/roles/${plainRoleId}`).set('Authorization', `Bearer ${admin}`)).status).toBe(404);
  });
});
