import { quoteIdentifier, quoteLiteral } from '../control-plane/control-plane-provision';

export type RoleEndpoint = {
  database: string;
  role: string;
  rolePassword: string;
};

export function parseRoleEndpoint(url: string, envName: string): RoleEndpoint {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const role = decodeURIComponent(parsed.username);
  if (!database) throw new Error(`${envName} must name a database in its path`);
  if (!role) throw new Error(`${envName} must carry the connection role as username`);
  return { database, role, rolePassword: decodeURIComponent(parsed.password) };
}

export function buildEnsureRoleStatements(endpoint: RoleEndpoint, roleExists: boolean): string[] {
  const role = quoteIdentifier(endpoint.role);
  const rolePasswordLiteral = quoteLiteral(endpoint.rolePassword);
  const posture = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  if (!roleExists) {
    return [`CREATE ROLE ${role} WITH ${posture} PASSWORD ${rolePasswordLiteral}`];
  }
  return [`ALTER ROLE ${role} WITH ${posture} PASSWORD ${rolePasswordLiteral}`];
}

export function buildTransferDatabaseOwnerStatement(endpoint: RoleEndpoint): string {
  return `ALTER DATABASE ${quoteIdentifier(endpoint.database)} OWNER TO ${quoteIdentifier(endpoint.role)}`;
}

export function buildOwnershipTransferQuery(fromRole: string, toRole: string): string {
  const from = quoteLiteral(fromRole);
  const to = quoteLiteral(toRole);
  const ownerPredicate = (column: string) => `${column} = (SELECT oid FROM pg_roles WHERE rolname = ${from})`;
  return [
    `SELECT format('ALTER TABLE %I.%I OWNER TO %I', ns.nspname, c.relname, ${to}) AS statement`,
    `FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace`,
    `WHERE ${ownerPredicate('c.relowner')} AND c.relkind IN ('r', 'p', 'm', 'v', 'S')`,
    `AND ns.nspname NOT IN ('pg_catalog', 'information_schema')`,
    `AND NOT (c.relkind = 'S' AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_class'::regclass AND d.refobjsubid <> 0 AND d.deptype IN ('a', 'i')))`,
    `UNION ALL`,
    `SELECT format('ALTER FUNCTION %I.%I(%s) OWNER TO %I', ns.nspname, p.proname, pg_get_function_identity_arguments(p.oid), ${to})`,
    `FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace`,
    `WHERE ${ownerPredicate('p.proowner')} AND ns.nspname NOT IN ('pg_catalog', 'information_schema')`,
    `UNION ALL`,
    `SELECT format('ALTER TYPE %I.%I OWNER TO %I', ns.nspname, t.typname, ${to})`,
    `FROM pg_type t JOIN pg_namespace ns ON ns.oid = t.typnamespace`,
    `WHERE ${ownerPredicate('t.typowner')} AND t.typtype IN ('e', 'd')`,
    `AND ns.nspname NOT IN ('pg_catalog', 'information_schema')`,
    `UNION ALL`,
    `SELECT format('ALTER SCHEMA %I OWNER TO %I', ns.nspname, ${to})`,
    `FROM pg_namespace ns`,
    `WHERE ${ownerPredicate('ns.nspowner')} AND ns.nspname NOT IN ('pg_catalog', 'information_schema', 'public')`,
    `AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp%'`,
  ].join(' ');
}

export function buildRoleConnectStatements(database: string, migratorRole: string, runtimeRole: string): string[] {
  const db = quoteIdentifier(database);
  return [
    `REVOKE CONNECT ON DATABASE ${db} FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${db} TO ${quoteIdentifier(migratorRole)}`,
    `GRANT CONNECT ON DATABASE ${db} TO ${quoteIdentifier(runtimeRole)}`,
  ];
}

export function buildRuntimeGrantStatements(migratorRole: string, runtimeRole: string): string[] {
  const runtime = quoteIdentifier(runtimeRole);
  const migrator = quoteIdentifier(migratorRole);
  return [
    `GRANT USAGE ON SCHEMA public TO ${runtime}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtime}`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${runtime}`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${runtime}`,
    `DO $$ DECLARE t record; BEGIN FOR t IN SELECT n.nspname AS schema_name, p.typname AS type_name FROM pg_type p JOIN pg_namespace n ON n.oid = p.typnamespace WHERE p.typcategory = 'E' AND n.nspname = 'public' LOOP EXECUTE format('GRANT USAGE ON TYPE %I.%I TO %I', t.schema_name, t.type_name, ${quoteLiteral(runtimeRole)}); END LOOP; END $$;`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public GRANT USAGE ON TYPES TO ${runtime}`,
  ];
}
