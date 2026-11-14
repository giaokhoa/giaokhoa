import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';
import { buildTestDatabase, dropTestDatabase, withDatabase } from '@giaokhoa/db/test-support';
import { runSpaceProvision, type SpaceProvisionResult } from '../../src/modules/tenants/space-provision-runner';
import { SpaceDatabaseService } from '../../src/db/routing/space-database.service';
import { RolesService } from '../../src/modules/access/roles.service';
import { ContextsService } from '../../src/modules/access/contexts.service';
import { bindTestSpaceToken, http, STRONG_PASSWORD, uniqueName } from './identity-access-helpers';

export type DedicatedTestCentre = {
  space: SpaceProvisionResult;
  slug: string;
  host: string;
  adminUsername: string;
  adminToken: string;
  dbUrl: string;
};

export type DedicatedTestActor = { id: string; username: string; email: string; token: string };

export class DedicatedTestCentres {
  private readonly previousCpUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  private readonly adminUrl = withDatabase(process.env.DATABASE_URL!, 'postgres');
  private readonly password = 'TestDedicated62DB!';
  private readonly centres: DedicatedTestCentre[] = [];
  private readonly migrations = join(__dirname, '../../../../packages/db/migrations/centre');
  private cpDatabase = '';

  async provision(slugs: string[]): Promise<void> {
    this.cpDatabase = 'giaokhoa_test_cp_' + randomUUID().replaceAll('-', '').slice(0, 12);
    const cpUrl = await buildTestDatabase({ adminUrl: this.adminUrl, database: this.cpDatabase, store: 'control-plane' });
    process.env.CONTROL_PLANE_DATABASE_URL = cpUrl;
    for (const slug of slugs) {
      const adminUsername = 'dedadmin' + randomUUID().replaceAll('-', '').slice(0, 10);
      const space = await runSpaceProvision({
        slug, name: 'Trung tâm kiểm nghiệm ' + slug,
        adminEmail: adminUsername + '@example.com', adminUsername,
        databasePassword: this.password, actorId: randomUUID(),
        migrationsDir: this.migrations,
        env: { ...process.env, CONTROL_PLANE_DATABASE_URL: cpUrl },
        log: () => undefined,
      });
      const roleUrl = new URL(this.adminUrl);
      roleUrl.pathname = '/' + space.databaseName;
      roleUrl.username = space.connectionRole;
      roleUrl.password = this.password;
      process.env[space.secretEnvVar] = roleUrl.toString();
      this.centres.push({ space, slug, host: slug + '.test.local', adminUsername, adminToken: '', dbUrl: roleUrl.toString() });
    }
  }

  async activate(app: INestApplication): Promise<DedicatedTestCentre[]> {
    for (const centre of this.centres) {
      const activated = await http(app).post('/api/v1/centres/activate-invite')
        .send({ slug: centre.slug, token: centre.space.inviteToken, password: STRONG_PASSWORD });
      if (activated.status !== 201) throw new Error('activate ' + centre.slug + ': ' + activated.status + ' ' + JSON.stringify(activated.body));
      const logged = await http(app).post('/api/v1/auth/token').set('Host', centre.host)
        .send({ username: centre.adminUsername, password: STRONG_PASSWORD });
      if (logged.status !== 201) throw new Error('login ' + centre.slug + ': ' + logged.status + ' ' + JSON.stringify(logged.body));
      centre.adminToken = logged.body.accessToken as string;
      bindTestSpaceToken(app, centre.adminToken, centre.host);
    }
    return this.centres;
  }

  async createUser(app: INestApplication, centre: DedicatedTestCentre, name?: string): Promise<DedicatedTestActor> {
    const username = uniqueName(name ?? 'deduser').toLowerCase();
    const email = username + '@example.com';
    const created = await http(app).post('/api/v1/tenants/' + centre.space.tenantId + '/users')
      .set('Authorization', 'Bearer ' + centre.adminToken)
      .send({ username, email, password: STRONG_PASSWORD, firstName: 'Test', lastName: 'Dedicated' });
    if (created.status !== 201) throw new Error('create ' + centre.slug + ': ' + created.status + ' ' + JSON.stringify(created.body));
    const token = await this.login(app, centre, username);
    return { id: created.body.id as string, username, email, token };
  }

  async login(app: INestApplication, centre: DedicatedTestCentre, username: string): Promise<string> {
    const logged = await http(app).post('/api/v1/auth/token').set('Host', centre.host)
      .send({ username, password: STRONG_PASSWORD });
    if (logged.status !== 201) throw new Error('login ' + username + ': ' + logged.status + ' ' + JSON.stringify(logged.body));
    const token = logged.body.accessToken as string;
    bindTestSpaceToken(app, token, centre.host);
    return token;
  }

  async grantRole(app: INestApplication, centre: DedicatedTestCentre, userId: string, shortName: string, contextId?: string): Promise<string> {
    return app.get(SpaceDatabaseService).withSpaceKysely(centre.slug, async () => {
      const roles = app.get(RolesService);
      const role = await roles.getRoleByShortname(shortName);
      if (!role) throw new Error('Dedicated role not found: ' + shortName);
      const context = contextId ?? (await app.get(ContextsService).ensureSystemContext()).id;
      await roles.assignRole(userId, role.id, context);
      return role.id;
    });
  }

  async grantCentreManager(app: INestApplication, centre: DedicatedTestCentre, userId = centre.space.adminUserId!): Promise<void> {
    const tenantContext = await app.get(SpaceDatabaseService).withSpaceKysely(centre.slug, async () =>
      app.get(ContextsService).ensureTenantContext(centre.space.tenantId!),
    );
    await this.grantRole(app, centre, userId, 'manager', tenantContext.id);
  }

  async roleId(app: INestApplication, centre: DedicatedTestCentre, shortName: string): Promise<string> {
    return app.get(SpaceDatabaseService).withSpaceKysely(centre.slug, async () => {
      const role = await app.get(RolesService).getRoleByShortname(shortName);
      if (!role) throw new Error('Dedicated role not found: ' + shortName);
      return role.id;
    });
  }

  bindApp(app: INestApplication, tokens: ReadonlyArray<{ token: string; host: string }>): void {
    for (const { token, host } of tokens) bindTestSpaceToken(app, token, host);
  }

  async cleanup(): Promise<void> {
    for (const centre of [...this.centres].reverse()) {
      delete process.env[centre.space.secretEnvVar];
      await dropTestDatabase(this.adminUrl, centre.space.databaseName);
      const admin = new Client({ connectionString: this.adminUrl });
      await admin.connect();
      try { await admin.query('DROP ROLE IF EXISTS "' + centre.space.connectionRole + '"'); }
      finally { await admin.end(); }
    }
    if (this.cpDatabase) await dropTestDatabase(this.adminUrl, this.cpDatabase);
    if (this.previousCpUrl === undefined) delete process.env.CONTROL_PLANE_DATABASE_URL;
    else process.env.CONTROL_PLANE_DATABASE_URL = this.previousCpUrl;
  }
}
