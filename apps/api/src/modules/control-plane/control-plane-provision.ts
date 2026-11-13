
export type ControlPlaneTarget = {
  database: string;
  role: string;
  rolePassword: string;
};

export function parseControlPlaneTarget(controlPlaneUrl: string): ControlPlaneTarget {
  const parsed = new URL(controlPlaneUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const role = decodeURIComponent(parsed.username);
  if (!database) throw new Error('CONTROL_PLANE_DATABASE_URL must name a database in its path');
  if (!role) throw new Error('CONTROL_PLANE_DATABASE_URL must carry the connection role as username');
  return { database, role, rolePassword: decodeURIComponent(parsed.password) };
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildEnsureRoleStatements(target: ControlPlaneTarget, roleExists: boolean): string[] {
  const role = quoteIdentifier(target.role);
  const rolePasswordLiteral = quoteLiteral(target.rolePassword);
  if (!roleExists) {
    return [`CREATE ROLE ${role} LOGIN PASSWORD ${rolePasswordLiteral}`];
  }
  return [`ALTER ROLE ${role} WITH LOGIN PASSWORD ${rolePasswordLiteral}`];
}

export function buildEnsureDatabaseStatements(target: ControlPlaneTarget, databaseExists: boolean): string[] {
  if (databaseExists) return [];
  return [`CREATE DATABASE ${quoteIdentifier(target.database)} OWNER ${quoteIdentifier(target.role)}`];
}

export function buildRestrictConnectStatements(target: ControlPlaneTarget): string[] {
  const database = quoteIdentifier(target.database);
  const role = quoteIdentifier(target.role);
  return [
    `REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${database} TO ${role}`,
  ];
}

export type BusinessDatabaseTarget = {
  database: string;
  roles: string[];
};

export function parseBusinessTarget(businessUrl: string): BusinessDatabaseTarget {
  const parsed = new URL(businessUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const role = decodeURIComponent(parsed.username);
  if (!database) throw new Error('DATABASE_URL must name a database in its path');
  if (!role) throw new Error('DATABASE_URL must carry the business connection role as username');
  return { database, roles: [role] };
}

export function buildRestrictBusinessConnectStatements(target: BusinessDatabaseTarget): string[] {
  const database = quoteIdentifier(target.database);
  const statements = [`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`];
  for (const role of target.roles) {
    statements.push(`GRANT CONNECT ON DATABASE ${database} TO ${quoteIdentifier(role)}`);
  }
  return statements;
}
