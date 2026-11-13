import { createHash } from 'node:crypto';
import { PUBLIC_LEARNING_SLUG } from './public-learning';
import { Client, Pool } from 'pg';
import type { SpaceRegistryRow } from '@giaokhoa/db/repositories/control-plane';
import { applyStoreMigrations } from '@giaokhoa/db/migrate';
import {
  buildCentreDatabaseUrl,
  CENTRE_INVITE_TTL_MS,
  CENTRE_PROGRAM_PACKAGE_KEY,
  deriveCentreDatabaseName,
  deriveCentreRoleName,
  deriveCentreSecretEnvVar,
  generateCentreDatabasePassword,
  generateCentreInviteToken,
  hashCentreInviteToken,
  normalizeSpaceSlug,
} from './centre-provision';
import {
  buildEnsureDatabaseStatements,
  buildEnsureRoleStatements,
  buildRestrictConnectStatements,
} from '../control-plane/control-plane-provision';
import {
  listMigrationFolders,
  readDatabaseAppliedMigrations,
  readDatabaseSchemaVersion,
  resolveCentreMigrationsDir,
  retargetUrl,
} from '../fleet/fleet-common';
import { FleetRegistryWriter } from '../fleet/fleet-registry-writer';
import { AccessRepository } from '@giaokhoa/db/repositories/access';
import { ContextsService } from '../access/contexts.service';
import { RolesService } from '../access/roles.service';
import { PlanLimitsService } from '../access/plan-limits.service';
import { RoleSeparationService } from '../access/role-separation.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { CONTEXT_LEVELS, DEFAULT_ROLES } from '../access/domain/capabilities';
import { createCentreKysely, sql as kyselySql, type CentreDb, type JsonValue } from '@giaokhoa/db';
import { isDedicatedDatabaseNameConflict } from '@giaokhoa/db/repositories/control-plane';
import {
  loadProgramDumpSql,
  PROGRAM_DUMP_VERSION,
  restoreProgramDumpSql,
} from '../curriculum/program-dump';

export type SpaceProvisionOptions = {
  kind?: 'center' | 'platform';
  slug: string;
  name: string;
  plan?: string | null;
  adminUsername?: string;
  adminEmail: string;
  adminFirstName?: string;
  adminLastName?: string;
  databaseName?: string;
  databasePassword?: string;
  actorId: string;
  migrationsDir?: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

export type SpaceProvisionResult = {
  slug: string;
  spaceId: string;
  databaseName: string;
  connectionRole: string;
  secretEnvVar: string;
  tenantId: string | null;
  adminUserId: string | null;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
  passwordWasGenerated: boolean;
  generatedPassword: string | null;
  status: 'active' | 'already-active';
  steps: { name: string; outcome: 'created' | 'reused' }[];
};

async function assertCentreRoleIsClean(admin: Client, role: string): Promise<void> {
  const attrs = await admin.query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
  }>('SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname = $1', [role]);
  const row = attrs.rows[0];
  if (!row) return;
  const offending = (['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'rolreplication'] as const)
    .filter((key) => row[key])
    .map((key) => key.replace(/^rol/, '').toUpperCase());
  if (offending.length > 0) {
    throw new Error(`Role ${role} already exists with privileged attributes (${offending.join(', ')}) — refusing to adopt it as a centre connection role`);
  }
  const members = await admin.query<{ rolname: string }>(
    `SELECT r.rolname FROM pg_roles r JOIN pg_auth_members m ON m.roleid = r.oid
     WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
     AND (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)`,
    [role],
  );
  if ((members.rowCount ?? 0) > 0) {
    const names = members.rows.map((member) => member.rolname).join(', ');
    throw new Error(`Role ${role} is a member of privileged role(s) (${names}) — refusing to adopt it as a centre connection role`);
  }
}

const ROLE_BASELINE_MARKER_KEY = 'rolebaseline';
const ROLE_BASELINE_MARKER_VERSION = 1;

async function installCentreRoleBaseline(accessDb: CentreDb): Promise<'created' | 'reused'> {
  const accessRepository = new AccessRepository(accessDb);
  const contextsService = new ContextsService(accessRepository);
  const rolesService = new RolesService(
    accessRepository,
    contextsService,
    new OutboxService(accessDb),
    new PlanLimitsService({ routedKysely: accessDb } as unknown as SpaceDatabaseService),
    new RoleSeparationService({ routedKysely: accessDb } as unknown as SpaceDatabaseService),
  );
  const existingRoles = await rolesService.listRoles();
  const presentShortNames = new Set(existingRoles.map((row) => row.shortName));
  const allRolesPresent = DEFAULT_ROLES.every((definition) => presentShortNames.has(definition.shortName));
  const marker = await accessRepository.getConfigValue(ROLE_BASELINE_MARKER_KEY);
  const installCompleted =
    typeof marker === 'object' &&
    marker !== null &&
    (marker as { version?: unknown }).version === ROLE_BASELINE_MARKER_VERSION;
  if (allRolesPresent && installCompleted) {
    return 'reused';
  }
  await rolesService.seedDefaults();
  await accessRepository.setConfigValue(ROLE_BASELINE_MARKER_KEY, { version: ROLE_BASELINE_MARKER_VERSION });
  return 'created';
}

export async function runSpaceProvision(options: SpaceProvisionOptions): Promise<SpaceProvisionResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => console.log(message));
  const slug = normalizeSpaceSlug(options.slug);
  const kind = options.kind ?? 'center';
  if (kind === 'platform' && slug !== PUBLIC_LEARNING_SLUG) {
    throw new Error(`Only ${PUBLIC_LEARNING_SLUG} may be provisioned as a public platform store`);
  }
  if (kind === 'center' && slug === PUBLIC_LEARNING_SLUG) {
    throw new Error(`Slug ${PUBLIC_LEARNING_SLUG} is reserved for the public learning store`);
  }
  const name = options.name.trim();
  if (!name) throw new Error('Space name is required');
  const adminUsername = (options.adminUsername ?? 'admin').trim().toLowerCase();
  if (!adminUsername) throw new Error('Admin username is required');
  const adminEmail = options.adminEmail.trim().toLowerCase();
  if (!adminEmail) throw new Error('Admin email is required');
  const actorId = options.actorId.trim();
  if (!actorId) throw new Error('actorId is required: pass the operator admin user id with --actor-id (history rows require an actor)');
  if (!env.CONTROL_PLANE_DATABASE_URL) throw new Error('CONTROL_PLANE_DATABASE_URL is required for provisioning');
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to derive the cluster admin connection');

  const databaseName = options.databaseName ?? deriveCentreDatabaseName(slug);
  const connectionRole = deriveCentreRoleName(slug);
  const secretEnvVar = deriveCentreSecretEnvVar(slug);
  const migrationsDir = options.migrationsDir ?? resolveCentreMigrationsDir();
  const steps: SpaceProvisionResult['steps'] = [];
  const step = (stepName: string, outcome: 'created' | 'reused') => {
    steps.push({ name: stepName, outcome });
    log(`[provision:${slug}] ${stepName}: ${outcome}`);
  };

  const writer = new FleetRegistryWriter(env);
  const adminUrl = retargetUrl(env.DATABASE_ADMIN_URL ?? databaseUrl, 'postgres');
  const adminParsed = new URL(adminUrl);
  const clusterHost = adminParsed.hostname;
  const clusterPort = adminParsed.port ? Number(adminParsed.port) : 5432;
  try {
    const existing = await writer.findSpaceBySlug(slug);
    let spaceId: string;
    if (existing) {
      if (existing.kind !== kind) {
        throw new Error(`Space ${slug} is registered as ${existing.kind}, expected ${kind}`);
      }
      if (existing.storageMode !== 'dedicated') {
        throw new Error(`Slug ${slug} is already registered as a ${existing.storageMode} space (id ${existing.id}) — refusing to take it over`);
      }
      if (existing.databaseName !== databaseName) {
        throw new Error(`Slug ${slug} is already registered with database ${existing.databaseName}, not ${databaseName} — refusing to take it over`);
      }
      if (existing.status === 'active') {
        log(`[provision:${slug}] already active — nothing changed`);
        return {
          slug, spaceId: existing.id, databaseName, connectionRole, secretEnvVar,
          tenantId: null, adminUserId: null, inviteToken: null, inviteExpiresAt: null,
          passwordWasGenerated: false, generatedPassword: null, status: 'already-active', steps,
        };
      }
      if (existing.status !== 'provisioning') {
        throw new Error(`Space ${slug} is in status ${existing.status} — refusing to re-run provisioning; resume it only through an explicit lifecycle status change`);
      }
      spaceId = existing.id;
      step('registration', 'reused');
    } else {
      const clash = await writer.findSpaceByDatabaseName(databaseName);
      if (clash) {
        throw new Error(`Database name ${databaseName} is already used by space ${clash.slug} — refusing to provision a second centre on it`);
      }
      let row: SpaceRegistryRow | undefined;
      try {
        row = await writer.createSpaceRegistration(actorId, {
          slug, name, kind, databaseName, connectionRoleRef: connectionRole, secretRef: `env:${secretEnvVar}`, plan: options.plan ?? null,
        });
      } catch (error) {
        if (isDedicatedDatabaseNameConflict(error)) {
          throw new Error(`Database name ${databaseName} is already used by another dedicated space — refusing to provision a second centre on it`, { cause: error });
        }
        throw error;
      }
      if (!row) throw new Error(`Slug ${slug} was registered concurrently — re-run provisioning to resume`);
      spaceId = row.id;
      step('registration', 'created');
    }

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    let passwordWasGenerated = false;
    let generatedPassword: string | null = null;
    try {
      const roleRow = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [connectionRole]);
      const roleExists = (roleRow.rowCount ?? 0) > 0;
      if (roleExists) await assertCentreRoleIsClean(admin, connectionRole);
      const providedPassword = options.databasePassword ?? env.SPACE_PROVISION_DB_PASSWORD;
      let rolePassword: string | null;
      if (providedPassword) {
        rolePassword = providedPassword;
      } else if (!roleExists) {
        rolePassword = generateCentreDatabasePassword();
        passwordWasGenerated = true;
        generatedPassword = rolePassword;
      } else {
        rolePassword = null;
      }
      if (rolePassword !== null) {
        for (const stmt of buildEnsureRoleStatements({ database: databaseName, role: connectionRole, rolePassword }, roleExists)) {
          await admin.query(stmt);
        }
      }
      const dbRow = await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1', [databaseName]);
      if (dbRow.rows.length > 0) {
        const owner = dbRow.rows[0].owner as string;
        if (owner !== connectionRole) {
          throw new Error(`Database ${databaseName} already exists owned by ${owner}, not ${connectionRole} — refusing to take it over`);
        }
      } else {
        for (const stmt of buildEnsureDatabaseStatements({ database: databaseName, role: connectionRole, rolePassword: rolePassword ?? '' }, false)) {
          await admin.query(stmt);
        }
      }
      for (const stmt of buildRestrictConnectStatements({ database: databaseName, role: connectionRole, rolePassword: rolePassword ?? '' })) {
        await admin.query(stmt);
      }
      step('database-role', roleExists ? 'reused' : 'created');
    } finally {
      await admin.end().catch(() => undefined);
    }

    let centrePassword = options.databasePassword ?? env.SPACE_PROVISION_DB_PASSWORD ?? generatedPassword ?? null;
    if (!centrePassword && env[secretEnvVar]) {
      try {
        centrePassword = decodeURIComponent(new URL(env[secretEnvVar]!).password);
      } catch {
        centrePassword = null;
      }
    }
    if (!centrePassword) {
      throw new Error(`Cannot connect to the centre database: role ${connectionRole} already exists but no password was provided (set SPACE_PROVISION_DB_PASSWORD or ${secretEnvVar})`);
    }
    const centreUrl = buildCentreDatabaseUrl({ host: clusterHost, port: clusterPort, role: connectionRole, password: centrePassword, databaseName });

    const migrationPool = new Pool({ connectionString: centreUrl });
    try {
      const folders = listMigrationFolders(migrationsDir);
      if (folders.length === 0) throw new Error(`No migration folders found under ${migrationsDir}`);
      const targetVersion = folders[folders.length - 1]!;
      const probe = new Client({ connectionString: centreUrl });
      await probe.connect();
      let applied: string[];
      let currentVersion: string | null;
      try {
        applied = await readDatabaseAppliedMigrations(probe);
        currentVersion = await readDatabaseSchemaVersion(probe);
      } finally {
        await probe.end().catch(() => undefined);
      }
      if (!applied.includes(targetVersion)) {
        const migrationDb = createCentreKysely(migrationPool);
        await applyStoreMigrations(migrationDb, 'centre', migrationsDir);
        const verify = new Client({ connectionString: centreUrl });
        await verify.connect();
        try {
          const appliedAfter = await readDatabaseAppliedMigrations(verify);
          const reached = await readDatabaseSchemaVersion(verify);
          const missing = folders.filter((folder) => !appliedAfter.includes(folder));
          if (missing.length > 0 || reached !== targetVersion) {
            throw new Error(`Migration verification failed: missing ${missing.join(', ') || 'none'}, version ${reached ?? 'none'} != ${targetVersion}`);
          }
        } finally {
          await verify.end().catch(() => undefined);
        }
        await writer.recordMigrationOutcome(spaceId, {
          runId: `provision-${slug}-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14)}`,
          fromVersion: currentVersion,
          toVersion: targetVersion,
          status: 'success',
          steps: [{ name: 'apply-migrations', status: 'success' }],
        });
        step('migrations', 'created');
      } else {
        step('migrations', 'reused');
      }
    } finally {
      await migrationPool.end().catch(() => undefined);
    }

    const seedPool = new Pool({ connectionString: centreUrl, max: 1 });
    const db = createCentreKysely(seedPool);
    try {
      await kyselySql`SELECT set_config('app.platform', 'on', false)`.execute(db);
      const existingSystem = await db.selectFrom('context').selectAll()
        .where('context_level', '=', CONTEXT_LEVELS.SYSTEM).where('instance_id', 'is', null)
        .limit(1).executeTakeFirst();
      let systemContextId: string;
      if (existingSystem) {
        systemContextId = existingSystem.id;
      } else {
        const inserted = await db.insertInto('context')
          .values({ context_level: CONTEXT_LEVELS.SYSTEM, instance_id: null, path: '', depth: 0 })
          .returningAll().executeTakeFirstOrThrow();
        const path = `/${inserted.id}`;
        await db.updateTable('context').set({ path, depth: 1 }).where('id', '=', inserted.id).execute();
        systemContextId = inserted.id;
      }
      const existingTenant = await db.selectFrom('tenants').selectAll()
        .where('slug', '=', slug).limit(1).executeTakeFirst();
      let tenantId: string;
      if (existingTenant) {
        tenantId = existingTenant.id;
        if (existingTenant.kind !== kind || existingTenant.status !== 'active') {
          throw new Error(`Tenant ${slug} already exists in the centre database with kind ${existingTenant.kind} / status ${existingTenant.status} — refusing to take it over`);
        }
      } else {
        const inserted = await db.insertInto('tenants')
          .values({ slug, name, kind, status: 'active', plan: options.plan ?? null })
          .returningAll().executeTakeFirstOrThrow();
        tenantId = inserted.id;
      }
      const existingTenantContext = await db.selectFrom('context').selectAll()
        .where('context_level', '=', CONTEXT_LEVELS.TENANT).where('instance_id', '=', tenantId)
        .limit(1).executeTakeFirst();
      if (!existingTenantContext) {
        const inserted = await db.insertInto('context')
          .values({ context_level: CONTEXT_LEVELS.TENANT, instance_id: tenantId, path: '', depth: 0 })
          .returningAll().executeTakeFirstOrThrow();
        await db.updateTable('context').set({ path: `${'/' + systemContextId}/${inserted.id}`, depth: 2 }).where('id', '=', inserted.id).execute();
      }
      if (kind === 'platform') {
        const existing = await db.selectFrom('course_categories').selectAll()
          .where('tenant_id', '=', tenantId)
          .where('id_number', '=', 'public-root')
          .limit(1).executeTakeFirst();
        let categoryId: string;
        if (existing) {
          categoryId = existing.id;
        } else {
          const category = await db.insertInto('course_categories').values({
            tenant_id: tenantId,
            id_number: 'public-root',
            name: 'Khoá học công cộng',
            path: '',
            depth: 1,
          }).returning('id').executeTakeFirstOrThrow();
          categoryId = category.id;
          await db.updateTable('course_categories').set({ path: `/${categoryId}` })
            .where('id', '=', categoryId).execute();
        }

        const parentCtx = await db.selectFrom('context').selectAll()
          .where('context_level', '=', CONTEXT_LEVELS.TENANT)
          .where('instance_id', '=', tenantId)
          .limit(1).executeTakeFirstOrThrow();
        const categoryCtx = await db.selectFrom('context').selectAll()
          .where('context_level', '=', CONTEXT_LEVELS.COURSECAT)
          .where('instance_id', '=', categoryId)
          .limit(1).executeTakeFirst();
        if (!categoryCtx) {
          const created = await db.insertInto('context').values({
            context_level: CONTEXT_LEVELS.COURSECAT,
            instance_id: categoryId,
            path: '',
            depth: parentCtx.depth + 1,
          }).returning('id').executeTakeFirstOrThrow();
          await db.updateTable('context')
            .set({ path: `${parentCtx.path}/${created.id}` })
            .where('id', '=', created.id).execute();
        }
        step('public-category', existing && categoryCtx ? 'reused' : 'created');
      }
      const dumpSql = loadProgramDumpSql();
      const dumpChecksum = createHash('sha256').update(dumpSql).digest('hex');
      const existingInstall = await db.selectFrom('program_package_installs').selectAll()
        .where('tenant_id', '=', tenantId).where('package_key', '=', CENTRE_PROGRAM_PACKAGE_KEY)
        .limit(1).executeTakeFirst();
      let programRecordsPresent = false;
      if (!existingInstall || existingInstall.version !== PROGRAM_DUMP_VERSION || existingInstall.checksum !== dumpChecksum) {
        const executed = await kyselySql<{ c: string }>`SELECT COUNT(*) AS c FROM subjects`.execute(db);
        programRecordsPresent = Number(executed.rows[0]?.c ?? 0) > 0;
        if (!existingInstall && !programRecordsPresent) {
          const restorePool = new Pool({ connectionString: centreUrl, max: 1 });
          const restoreDb = createCentreKysely(restorePool);
          try {
            await kyselySql`SELECT set_config('app.platform', 'on', false)`.execute(restoreDb);
            await restoreProgramDumpSql(restoreDb, dumpSql, { anchorContextId: systemContextId });
          } finally {
            await restoreDb.destroy().catch(() => undefined);
          }
        }
        if (!existingInstall) {
          await db.insertInto('program_package_installs').values({
            tenant_id: tenantId, package_key: CENTRE_PROGRAM_PACKAGE_KEY, version: PROGRAM_DUMP_VERSION, checksum: dumpChecksum,
          }).execute();
        } else {
          throw new Error(`Centre database already has program package ${CENTRE_PROGRAM_PACKAGE_KEY} at version ${existingInstall.version} (expected ${PROGRAM_DUMP_VERSION}) — refusing to overwrite; upgrade the package instead`);
        }
      }
      step('seed', 'created');
      const accessPool = new Pool({ connectionString: centreUrl, max: 1 });
      const accessDb = createCentreKysely(accessPool);
      try {
        await kyselySql`SELECT set_config('app.platform', 'on', false)`.execute(accessDb);
        step('role-baseline', await installCentreRoleBaseline(accessDb));
      } finally {
        await accessDb.destroy().catch(() => undefined);
      }
      const existingIdentity = await db.selectFrom('centre_identity').selectAll()
        .where('tenant_id', '=', tenantId).limit(1).executeTakeFirst();
      if (!existingIdentity) {
        await db.insertInto('centre_identity')
          .values({ tenant_id: tenantId, display_name: name, logo_path: null, brand_color: null })
          .execute();
        step('identity', 'created');
      } else {
        step('identity', 'reused');
      }
      const existingUser = await db.selectFrom('users').selectAll()
        .where('username', '=', adminUsername).limit(1).executeTakeFirst();
      let adminUserId: string;
      if (existingUser) {
        if (existingUser.email !== adminEmail) {
          throw new Error(`Username ${adminUsername} already exists in the centre database with a different email — refusing to take it over`);
        }
        adminUserId = existingUser.id;
      } else {
        const inserted = await db.insertInto('users').values({
          username: adminUsername, email: adminEmail, password_hash: null,
          first_name: options.adminFirstName ?? '', last_name: options.adminLastName ?? '',
          force_password_change: true,
        }).returningAll().executeTakeFirstOrThrow();
        adminUserId = inserted.id;
      }
      await db.insertInto('tenant_memberships').values({ tenant_id: tenantId, user_id: adminUserId, status: 'active' })
        .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doNothing())
        .execute();
      const siteAdminsRow = await db.selectFrom('config').selectAll()
        .where('key', '=', 'siteadmins').limit(1).executeTakeFirst();
      const currentAdmins = Array.isArray(siteAdminsRow?.value) ? (siteAdminsRow!.value as unknown[]).map((v) => String(v)) : [];
      if (!currentAdmins.includes(adminUserId)) {
        const next = [...currentAdmins, adminUserId];
        const nextValue = kyselySql<JsonValue>`${JSON.stringify(next)}::jsonb`;
        if (siteAdminsRow) {
          await db.updateTable('config').set({ value: nextValue }).where('id', '=', siteAdminsRow.id).execute();
        } else {
          await db.insertInto('config').values({ key: 'siteadmins', value: nextValue }).execute();
        }
      }
      const pendingInvite = await db.selectFrom('centre_invites').selectAll()
        .where('user_id', '=', adminUserId)
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', kyselySql<Date>`now()`)
        .limit(1).executeTakeFirst();
      let inviteToken: string | null = null;
      let inviteExpiresAt: Date | null = null;
      if (pendingInvite) {
        inviteExpiresAt = pendingInvite.expires_at as Date;
        step('admin-invite', 'reused');
      } else {
        inviteToken = generateCentreInviteToken();
        inviteExpiresAt = new Date(Date.now() + CENTRE_INVITE_TTL_MS);
        await db.insertInto('centre_invites').values({
          tenant_id: tenantId, user_id: adminUserId, email: adminEmail,
          token_hash: hashCentreInviteToken(inviteToken), expires_at: inviteExpiresAt,
        }).execute();
        step('admin-invite', 'created');
      }

      await writer.changeSpaceStatus(spaceId, 'active', actorId);
      step('activation', 'created');
      return {
        slug, spaceId, databaseName, connectionRole, secretEnvVar,
        tenantId, adminUserId, inviteToken, inviteExpiresAt,
        passwordWasGenerated, generatedPassword, status: 'active', steps,
      };
    } finally {
      await db.destroy().catch(() => undefined);
    }
  } finally {
    await writer.close().catch(() => undefined);
  }
}

export type CentreInviteOptions = {
  slug: string;
  email: string;
  revokeOnly?: boolean;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

export type CentreInviteResult = {
  slug: string;
  userId: string;
  revokedCount: number;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
};

export async function manageCentreInvite(options: CentreInviteOptions): Promise<CentreInviteResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => console.log(message));
  const slug = normalizeSpaceSlug(options.slug);
  const email = options.email.trim().toLowerCase();
  if (!email) throw new Error('Email is required');
  if (!env.CONTROL_PLANE_DATABASE_URL) throw new Error('CONTROL_PLANE_DATABASE_URL is required');
  const writer = new FleetRegistryWriter(env);
  try {
    const space = await writer.findSpaceBySlug(slug);
    if (!space) throw new Error(`Space ${slug} is not registered`);
    if (space.storageMode !== 'dedicated') throw new Error(`Space ${slug} is not a dedicated centre space`);
    const secretRef = space.secretRef;
    if (!secretRef?.startsWith('env:')) throw new Error(`Space ${slug} has no env secret reference to connect with`);
    const secretEnvVar = secretRef.slice('env:'.length);
    const centreUrl = env[secretEnvVar];
    if (!centreUrl) throw new Error(`Connection URL env var ${secretEnvVar} is not set in this environment`);
    const pool = new Pool({ connectionString: centreUrl, max: 1 });
    const db = createCentreKysely(pool);
    try {
      await kyselySql`SELECT set_config('app.platform', 'on', false)`.execute(db);
      const tenant = await db.selectFrom('tenants').selectAll()
        .where('slug', '=', slug).limit(1).executeTakeFirst();
      if (!tenant) throw new Error(`Tenant ${slug} does not exist in the centre database yet`);
      const user = await db.selectFrom('users').selectAll()
        .where('email', '=', email).limit(1).executeTakeFirst();
      if (!user) throw new Error(`No user with email ${email} in the centre database`);
      const pending = await db.selectFrom('centre_invites').selectAll()
        .where('user_id', '=', user.id)
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', kyselySql<Date>`now()`)
        .execute();
      for (const invite of pending) {
        await db.updateTable('centre_invites').set({ revoked_at: new Date() }).where('id', '=', invite.id).execute();
      }
      log(`[invite:${slug}] revoked ${pending.length} pending invite(s) for ${email}`);
      if (options.revokeOnly) {
        return { slug, userId: user.id, revokedCount: pending.length, inviteToken: null, inviteExpiresAt: null };
      }
      const inviteToken = generateCentreInviteToken();
      const inviteExpiresAt = new Date(Date.now() + CENTRE_INVITE_TTL_MS);
      await db.insertInto('centre_invites').values({
        tenant_id: tenant.id, user_id: user.id, email,
        token_hash: hashCentreInviteToken(inviteToken), expires_at: inviteExpiresAt,
      }).execute();
      return { slug, userId: user.id, revokedCount: pending.length, inviteToken, inviteExpiresAt };
    } finally {
      await db.destroy().catch(() => undefined);
    }
  } finally {
    await writer.close().catch(() => undefined);
  }
}

export type SpaceRoleBaselineOptions = {
  slug: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

export type SpaceRoleBaselineResult = {
  slug: string;
  outcome: 'created' | 'reused';
};

export async function installSpaceRoleBaseline(options: SpaceRoleBaselineOptions): Promise<SpaceRoleBaselineResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => console.log(message));
  const slug = normalizeSpaceSlug(options.slug);
  if (!env.CONTROL_PLANE_DATABASE_URL) throw new Error('CONTROL_PLANE_DATABASE_URL is required');
  const writer = new FleetRegistryWriter(env);
  try {
    const space = await writer.findSpaceBySlug(slug);
    if (!space) throw new Error(`Space ${slug} is not registered`);
    if (space.storageMode !== 'dedicated') throw new Error(`Space ${slug} is not a dedicated centre space`);
    const secretRef = space.secretRef;
    if (!secretRef?.startsWith('env:')) throw new Error(`Space ${slug} has no env secret reference to connect with`);
    const secretEnvVar = secretRef.slice('env:'.length);
    const centreUrl = env[secretEnvVar];
    if (!centreUrl) throw new Error(`Connection URL env var ${secretEnvVar} is not set in this environment`);
    const accessPool = new Pool({ connectionString: centreUrl, max: 1 });
    const accessDb = createCentreKysely(accessPool);
    try {
      await kyselySql`SELECT set_config('app.platform', 'on', false)`.execute(accessDb);
      const tenant = await accessDb.selectFrom('tenants').selectAll()
        .where('slug', '=', slug).limit(1).executeTakeFirst();
      if (!tenant) throw new Error(`Tenant ${slug} does not exist in the centre database yet`);
      const outcome = await installCentreRoleBaseline(accessDb);
      log(`[install-roles:${slug}] role-baseline: ${outcome}`);
      return { slug, outcome };
    } finally {
      await accessDb.destroy().catch(() => undefined);
    }
  } finally {
    await writer.close().catch(() => undefined);
  }
}
