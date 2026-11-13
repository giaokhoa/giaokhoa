import { afterAll, describe, expect, it } from 'vitest';
import { tenantAls } from '../modules/tenants/tenant-als';
import { TenantAwarePool } from './tenant-pool';

const GUC_SQL =
  "select current_setting('app.tenant_id', true) as tenant_id, current_setting('app.platform', true) as platform";

interface GucRow {
  tenant_id: string;
  platform: string;
}

const TENANT_A = '018e7a00-0000-7000-8000-00000000000a';
const TENANT_B = '018e7a00-0000-7000-8000-00000000000b';

describe('TenantAwarePool — GUC theo ngữ cảnh ALS (TENANT-1 #196, bước 2)', () => {
  const pool = new TenantAwarePool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  afterAll(async () => {
    await pool.end();
  });

  const readGucViaPoolQuery = async (): Promise<GucRow> => {
    const res = await pool.query<GucRow>(GUC_SQL);
    return res.rows[0];
  };

  it('pool.query ngoài ngữ cảnh: tenant rỗng, platform off (fail-closed)', async () => {
    await expect(readGucViaPoolQuery()).resolves.toEqual({ tenant_id: '', platform: 'off' });
  });

  it('pool.query trong ngữ cảnh tenant: mang đúng tenant của ALS', async () => {
    const guc = await tenantAls.run({ tenantId: TENANT_A }, readGucViaPoolQuery);
    expect(guc).toEqual({ tenant_id: TENANT_A, platform: 'off' });
  });

  it('pool.query trong ngữ cảnh platform: platform on, tenant rỗng', async () => {
    const guc = await tenantAls.run({ platform: true }, readGucViaPoolQuery);
    expect(guc).toEqual({ tenant_id: '', platform: 'on' });
  });

  it('các lượt checkout nối tiếp trên cùng kết nối không rò GUC', async () => {
    const a = await tenantAls.run({ tenantId: TENANT_A }, readGucViaPoolQuery);
    const b = await tenantAls.run({ tenantId: TENANT_B }, readGucViaPoolQuery);
    const none = await readGucViaPoolQuery();
    const platform = await tenantAls.run({ platform: true }, readGucViaPoolQuery);
    const after = await readGucViaPoolQuery();
    expect(a.tenant_id).toBe(TENANT_A);
    expect(b.tenant_id).toBe(TENANT_B);
    expect(none).toEqual({ tenant_id: '', platform: 'off' });
    expect(platform).toEqual({ tenant_id: '', platform: 'on' });
    expect(after).toEqual({ tenant_id: '', platform: 'off' });
  });

  it('connect() tường minh gắn GUC; client tái sử dụng không mang GUC cũ', async () => {
    const inTenant = await tenantAls.run({ tenantId: TENANT_A }, async () => {
      const client = await pool.connect();
      try {
        const res = await client.query<GucRow>(GUC_SQL);
        return res.rows[0];
      } finally {
        client.release();
      }
    });
    expect(inTenant).toEqual({ tenant_id: TENANT_A, platform: 'off' });
    await expect(readGucViaPoolQuery()).resolves.toEqual({ tenant_id: '', platform: 'off' });
  });
});
