import { sql, type ExpressionBuilder, type Insertable, type Updateable } from 'kysely';
import type { UserListSortBy, UserListStatus } from '@giaokhoa/contracts';
import type { CentreDb, CentreDB, CentreTx } from '../client';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  suspended: boolean;
  deleted: boolean;
  forcePasswordChange: boolean;
  isGuest: boolean;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewUser {
  id?: string;
  username: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
  passwordHash?: string | null;
  firstName?: string;
  lastName?: string;
  suspended?: boolean;
  deleted?: boolean;
  forcePasswordChange?: boolean;
  isGuest?: boolean;
  lastLogin?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type UserPatch = Partial<NewUser>;

export interface UserListFilter {
  status?: UserListStatus;
  sortBy?: UserListSortBy;
  sortDirection?: 'asc' | 'desc';
}

const USER_COLUMNS = [
  'id',
  'username',
  'email',
  'email_verified as emailVerified',
  'image',
  'password_hash as passwordHash',
  'first_name as firstName',
  'last_name as lastName',
  'suspended',
  'deleted',
  'force_password_change as forcePasswordChange',
  'is_guest as isGuest',
  'last_login as lastLogin',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

function userInsertValues(values: NewUser): Insertable<CentreDB['users']> {
  const row: Insertable<CentreDB['users']> = {
    username: values.username,
    email: values.email,
  };
  if (values.id !== undefined) row.id = values.id;
  if (values.emailVerified !== undefined) row.email_verified = values.emailVerified;
  if (values.image !== undefined) row.image = values.image;
  if (values.passwordHash !== undefined) row.password_hash = values.passwordHash;
  if (values.firstName !== undefined) row.first_name = values.firstName;
  if (values.lastName !== undefined) row.last_name = values.lastName;
  if (values.suspended !== undefined) row.suspended = values.suspended;
  if (values.deleted !== undefined) row.deleted = values.deleted;
  if (values.forcePasswordChange !== undefined) row.force_password_change = values.forcePasswordChange;
  if (values.isGuest !== undefined) row.is_guest = values.isGuest;
  if (values.lastLogin !== undefined) row.last_login = values.lastLogin;
  if (values.createdAt !== undefined) row.created_at = values.createdAt;
  if (values.updatedAt !== undefined) row.updated_at = values.updatedAt;
  return row;
}

function userUpdateSet(patch: UserPatch): Updateable<CentreDB['users']> {
  const set: Updateable<CentreDB['users']> = {};
  if (patch.username !== undefined) set.username = patch.username;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.emailVerified !== undefined) set.email_verified = patch.emailVerified;
  if (patch.image !== undefined) set.image = patch.image;
  if (patch.passwordHash !== undefined) set.password_hash = patch.passwordHash;
  if (patch.firstName !== undefined) set.first_name = patch.firstName;
  if (patch.lastName !== undefined) set.last_name = patch.lastName;
  if (patch.suspended !== undefined) set.suspended = patch.suspended;
  if (patch.deleted !== undefined) set.deleted = patch.deleted;
  if (patch.forcePasswordChange !== undefined) set.force_password_change = patch.forcePasswordChange;
  if (patch.isGuest !== undefined) set.is_guest = patch.isGuest;
  if (patch.lastLogin !== undefined) set.last_login = patch.lastLogin;
  if (patch.createdAt !== undefined) set.created_at = patch.createdAt;
  return set;
}

export class UsersRepository {
  constructor(private readonly handle: CentreDb) {}

  get dbHandle(): CentreDb { return this.handle; }

  async transaction<T>(fn: (tx: CentreTx) => Promise<T>): Promise<T> {
    return this.handle.transaction().execute(fn);
  }

  async insertUser(v: NewUser, tx?: CentreTx): Promise<UserRow> {
    const rows = await (tx ?? this.handle)
      .insertInto('users')
      .values(userInsertValues(v))
      .returning(USER_COLUMNS)
      .execute();
    return rows[0]!;
  }

  async updateUser(id: string, v: UserPatch, tx?: CentreTx): Promise<void> {
    await (tx ?? this.handle)
      .updateTable('users')
      .set({ ...userUpdateSet(v), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async getById(id: string): Promise<UserRow | undefined> {
    return this.handle
      .selectFrom('users')
      .select(USER_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getByIds(ids: string[]): Promise<UserRow[]> {
    if (!ids.length) return [];
    return this.handle
      .selectFrom('users')
      .select(USER_COLUMNS)
      .where('id', 'in', ids)
      .execute();
  }

  async getByUsername(username: string): Promise<UserRow | undefined> {
    return this.handle
      .selectFrom('users')
      .select(USER_COLUMNS)
      .where('username', '=', username)
      .executeTakeFirst();
  }

  async getByEmail(email: string): Promise<UserRow | undefined> {
    return this.handle
      .selectFrom('users')
      .select(USER_COLUMNS)
      .where('email', '=', email)
      .executeTakeFirst();
  }

  async search(search: string | undefined, page: number, pageSize: number, filter: UserListFilter = {}): Promise<{ rows: UserRow[]; total: number }> {
    const direction = filter.sortDirection === 'desc' ? 'desc' : 'asc';
    const applyConditions = (eb: ExpressionBuilder<CentreDB, 'users'>) => {
      const conds = [eb('deleted', '=', filter.status === 'deleted')];
      if (filter.status === 'active') conds.push(eb('suspended', '=', false));
      if (filter.status === 'suspended') conds.push(eb('suspended', '=', true));
      if (search) {
        const pattern = `%${search}%`;
        conds.push(eb.or([
          eb('username', 'ilike', pattern),
          eb('email', 'ilike', pattern),
          eb('first_name', 'ilike', pattern),
          eb('last_name', 'ilike', pattern),
        ]));
      }
      return eb.and(conds);
    };
    let rowsQuery = this.handle
      .selectFrom('users')
      .select(USER_COLUMNS)
      .where((eb) => applyConditions(eb));
    rowsQuery = filter.sortBy === 'name'
      ? rowsQuery.orderBy('first_name', direction).orderBy('last_name', direction).orderBy('id', 'asc')
      : filter.sortBy === 'createdAt'
        ? rowsQuery.orderBy('created_at', direction).orderBy('id', 'asc')
        : filter.sortBy === 'lastLogin'
          ? rowsQuery.orderBy('last_login', direction).orderBy('id', 'asc')
          : rowsQuery.orderBy('id', 'asc');
    const rows = await rowsQuery.limit(pageSize).offset((page - 1) * pageSize).execute();
    const count = await this.handle
      .selectFrom('users')
      .select(sql<number>`count(*)::int`.as('n'))
      .where((eb) => applyConditions(eb))
      .executeTakeFirst();
    return { rows, total: count?.n ?? 0 };
  }

  async setPreference(userId: string, name: string, value: string | null): Promise<void> {
    await this.handle
      .insertInto('user_preferences')
      .values({ user_id: userId, name, value })
      .onConflict((oc) => oc.columns(['user_id', 'name']).doUpdateSet({ value }))
      .execute();
  }

  async getPreference(userId: string, name: string): Promise<string | null | undefined> {
    const row = await this.handle
      .selectFrom('user_preferences')
      .select(['value'])
      .where('user_id', '=', userId)
      .where('name', '=', name)
      .executeTakeFirst();
    return row?.value;
  }
}
