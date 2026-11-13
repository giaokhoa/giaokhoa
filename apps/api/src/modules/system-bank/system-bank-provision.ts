
export type SystemBankTarget = {
  database: string;
  role: string;
  rolePassword: string;
};

export function parseSystemBankTarget(systemBankUrl: string): SystemBankTarget {
  const parsed = new URL(systemBankUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const role = decodeURIComponent(parsed.username);
  if (!database) throw new Error('SYSTEM_BANK_DATABASE_URL must name a database in its path');
  if (!role) throw new Error('SYSTEM_BANK_DATABASE_URL must carry the connection role as username');
  return { database, role, rolePassword: decodeURIComponent(parsed.password) };
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildEnsureRoleStatements(target: SystemBankTarget, roleExists: boolean): string[] {
  const role = quoteIdentifier(target.role);
  const rolePasswordLiteral = quoteLiteral(target.rolePassword);
  if (!roleExists) {
    return [`CREATE ROLE ${role} LOGIN PASSWORD ${rolePasswordLiteral}`];
  }
  return [`ALTER ROLE ${role} WITH LOGIN PASSWORD ${rolePasswordLiteral}`];
}

export function buildEnsureDatabaseStatements(target: SystemBankTarget, databaseExists: boolean): string[] {
  if (databaseExists) return [];
  return [`CREATE DATABASE ${quoteIdentifier(target.database)} OWNER ${quoteIdentifier(target.role)}`];
}

export function buildRestrictConnectStatements(target: SystemBankTarget): string[] {
  const database = quoteIdentifier(target.database);
  const role = quoteIdentifier(target.role);
  return [
    `REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${database} TO ${role}`,
  ];
}
