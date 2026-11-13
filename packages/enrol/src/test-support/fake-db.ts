import type {
  EnrolDatabase,
  PlatformScopeRunner,
  SharedOutboxEventInput,
  SharedOutboxPort,
  SharedOutboxTx,
} from '../types';

/**
 * Tay cầm Kysely giả trong bộ nhớ cho suite unit của package.
 *
 * Các lõi enrol nhận thẳng handle Kysely nên bản giả phải hiểu đúng
 * các lời gọi builder mà code thật dùng (mẫu fake handle theo
 * `sepay-matching.service.spec.ts` của payments, nhưng ở tầng query
 * builder thay vì tầng repository): `selectFrom`/`insertInto`/
 * `updateTable`/`deleteFrom`/`transaction`, `where` dạng callback
 * nhận `eb` (`eb.and`/`eb.or`, các toán tử `=`/`<>`/`in`/`not in`/
 * `is`/`like`), `innerJoin`/`leftJoin` bằng cặp cột, `limit`,
 * `onConflict doNothing` và `returning`. Bản giả đánh giá đúng các
 * biểu thức đó trên các bảng trong bộ nhớ (dòng lưu theo khoá
 * snake_case như cột PostgreSQL, hàng nối được tra theo tên đủ
 * `bảng.cột`), nên test ghim được hành vi thật của lõi chứ không
 * chỉ ghim bản giả.
 *
 * Giới hạn đã biết (ghi rõ để không ai đọc quá khả năng của bản giả):
 * - Chỉ hỗ trợ đúng các hình gọi mà code enrol hiện tại dùng; gọi
 *   hình khác (vd `select` không cột, `distinct`, `orderBy`, hàm
 *   tổng hợp, `sql` thô) sẽ ném lỗi thay vì lặng lẽ trả sai.
 * - Không mô phỏng kiểu dữ liệu PostgreSQL (vd uuid, timestamptz):
 *   giá trị lưu nguyên như test nạp vào; id tự sinh là uuid hợp lệ
 *   để các kiểm `uuidIdSchema` trong code thật không vấp.
 * - Xung đột duy nhất chỉ được phát hiện trên các khoá đã khai ở
 *   `DEFAULT_UNIQUE_KEYS` (đúng các ràng buộc duy nhất mà code
 *   thật dựa vào); cột khoá mang NULL thì không xung đột, đúng
 *   ngữ nghĩa PostgreSQL.
 * - Transaction giả không cách ly: handle transaction chia sẻ
 *   cùng kho bảng với handle ngoài, chỉ khác tham chiếu đối tượng
 *   (đủ để khẳng định outbox được ghi trong đúng transaction).
 */

/** Một dòng trong bảng giả: khoá snake_case như cột PostgreSQL. */
export type FakeRow = Record<string, unknown>;

/** Một dòng đã nối nhiều bảng: khoá là tên đủ `bảng.cột`. */
type JoinedRow = Record<string, unknown>;

/** Vị từ trên một dòng đã nối (kết quả của một lời gọi `eb`). */
type FakePredicate = (row: JoinedRow) => boolean;

/** Một mục trong nhật ký truy vấn của bản giả. */
export interface FakeQueryLogEntry {
  /** Loại truy vấn. */
  kind: 'select' | 'insert' | 'update' | 'delete';
  /** Bảng chính của truy vấn. */
  table: string;
  /** Giới hạn dòng của truy vấn (null khi không giới hạn). */
  limit: number | null;
  /** Các cột mà mệnh đề where của truy vấn chạm tới (dạng `bảng.cột`, theo thứ tự chạm). */
  whereColumns: string[];
}

/** Tuỳ chọn của bản giả. */
export interface FakeDbOptions {
  /** Khoá duy nhất theo bảng (mặc định xem `DEFAULT_UNIQUE_KEYS`). */
  uniqueKeys?: Record<string, string[][]>;
  /**
   * Móc chạy TRƯỚC mỗi lần chèn (nhận handle giả, bảng và dữ kiện
   * chèn): test mô phỏng phía ghi đồng thời bằng cách chèn dòng
   * thắng ngay tại đây, để lần chèn thật sau đó ăn `23505` (hoặc
   * được `doNothing` nuốt) như ngoài đời.
   */
  beforeInsert?: (db: FakeEnrolDb, table: string, values: FakeRow) => void;
}

/**
 * Các ràng buộc duy nhất mà code thật dựa vào để xử lý đua chèn
 * (đúng migration baseline của `@giaokhoa/db`): `context` trên
 * (context_level, instance_id), `role_assignments` trên
 * (role_id, user_id, context_id, component, item_id),
 * `tenant_memberships` trên (tenant_id, user_id),
 * `user_enrolments` trên (enrol_id, user_id).
 */
const DEFAULT_UNIQUE_KEYS: Record<string, string[][]> = {
  context: [['context_level', 'instance_id']],
  role_assignments: [['role_id', 'user_id', 'context_id', 'component', 'item_id']],
  tenant_memberships: [['tenant_id', 'user_id']],
  user_enrolments: [['enrol_id', 'user_id']],
};

/** Lỗi vi phạm duy nhất giả, mang mã PostgreSQL 23505 như lỗi thật. */
function uniqueViolationError(): Error & { code: string } {
  const err = new Error('duplicate key value violates unique constraint') as Error & { code: string };
  err.code = '23505';
  return err;
}

/** Tên cột sau dấu chấm của một tên đủ `bảng.cột` (giữ nguyên khi đã trần). */
function columnOf(column: string): string {
  const dot = column.lastIndexOf('.');
  return dot === -1 ? column : column.slice(dot + 1);
}

/**
 * Giá trị của một cột trong dòng đã nối: khớp đúng tên đủ trước;
 * tên trần thì khớp khi chỉ có đúng một cột mang hậu tố đó (vd
 * `id` trong truy vấn một bảng); không khớp thì coi như NULL.
 */
function columnValue(row: JoinedRow, column: string): unknown {
  if (Object.hasOwn(row, column)) return row[column];
  const suffix = `.${column}`;
  const matches = Object.keys(row).filter((key) => key.endsWith(suffix));
  if (matches.length === 1) return row[matches[0] as string];
  return undefined;
}

/** So khớp chuỗi với mẫu LIKE của SQL (`%` = mọi chuỗi, `_` = một ký tự). */
function likeMatches(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`);
  return regex.test(value);
}

/** Đánh giá một phép so sánh đơn trên giá trị ô. */
function compare(op: string, cell: unknown, value: unknown): boolean {
  switch (op) {
    case '=':
      return cell === value;
    case '<>':
    case '!=':
      return cell !== value;
    case 'in':
      return Array.isArray(value) && value.some((candidate) => candidate === cell);
    case 'not in':
      return !(Array.isArray(value) && value.some((candidate) => candidate === cell));
    case 'is':
      return value === null ? cell === undefined || cell === null : cell === value;
    case 'is not':
      return value === null ? cell !== undefined && cell !== null : cell !== value;
    case 'like':
      return typeof cell === 'string' && typeof value === 'string' && likeMatches(cell, value);
    default:
      throw new Error(`Toán tử giả chưa hỗ trợ: ${op}`);
  }
}

/** Bộ dựng biểu thức `eb` của Kysely (dạng rút gọn cho bản giả). */
interface FakeExpressionBuilder {
  (column: string, op: string, value: unknown): FakePredicate;
  and(predicates: readonly FakePredicate[]): FakePredicate;
  or(predicates: readonly FakePredicate[]): FakePredicate;
}

/** Dựng một `eb` ghi lại mọi cột mà nó chạm tới. */
function createExpressionBuilder(onColumn: (column: string) => void): FakeExpressionBuilder {
  const eb = ((column: string, op: string, value: unknown): FakePredicate => {
    onColumn(column);
    return (row) => compare(op, columnValue(row, column), value);
  }) as FakeExpressionBuilder;
  eb.and = (predicates) => (row) => predicates.every((predicate) => predicate(row));
  eb.or = (predicates) => (row) => predicates.some((predicate) => predicate(row));
  return eb;
}

/** Dấu hiệu một phép tính trên cột trong `set` (vd `eb('version', '+', 1)`). */
interface UpdateOpMarker {
  __fakeUpdateOp: true;
  column: string;
  op: '+' | '-';
  value: number;
}

function isUpdateOpMarker(value: unknown): value is UpdateOpMarker {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { __fakeUpdateOp?: unknown }).__fakeUpdateOp === true
  );
}

/** Bộ dựng biểu thức cho giá trị `set` dạng hàm (chỉ hỗ trợ `+`/`-` trên cột số). */
function createUpdateExpressionBuilder(): (column: string, op: string, value: number) => UpdateOpMarker {
  return (column, op, value) => {
    if (op !== '+' && op !== '-') throw new Error(`Phép tính giả chưa hỗ trợ trong set: ${op}`);
    return { __fakeUpdateOp: true, column, op, value };
  };
}

/** Chuyển một dòng của bảng thành dạng `bảng.cột` để nối/truy vấn. */
function qualify(table: string, row: FakeRow): JoinedRow {
  const out: JoinedRow = {};
  for (const [key, value] of Object.entries(row)) out[`${table}.${key}`] = value;
  return out;
}

/** Chiếu một dòng đã nối theo danh sách cột select (`bảng.cột as bí danh` hoặc trần). */
function projectRow(row: JoinedRow, columns: readonly string[]): FakeRow {
  const out: FakeRow = {};
  for (const spec of columns) {
    const [source, alias] = spec.split(' as ').map((part) => part.trim());
    const key = alias ?? columnOf(source as string);
    out[key] = columnValue(row, source as string);
  }
  return out;
}

interface JoinSpec {
  table: string;
  left: string;
  right: string;
  kind: 'inner' | 'left';
}

/** Builder select giả: chỉ hiện thực đúng các mắt xích code thật dùng. */
class FakeSelectBuilder {
  private columns: readonly string[] | null = null;
  private joins: JoinSpec[] = [];
  private predicate: FakePredicate | null = null;
  private limitValue: number | null = null;
  private readonly whereColumns: string[] = [];

  constructor(
    private readonly db: FakeEnrolDb,
    private readonly table: string,
  ) {}

  select(columns: string | readonly string[]): this {
    this.columns = typeof columns === 'string' ? [columns] : columns;
    return this;
  }

  innerJoin(table: string, left: string, right: string): this {
    this.joins.push({ table, left, right, kind: 'inner' });
    return this;
  }

  leftJoin(table: string, left: string, right: string): this {
    this.joins.push({ table, left, right, kind: 'left' });
    return this;
  }

  where(...args: unknown[]): this {
    if (typeof args[0] === 'function') {
      const eb = createExpressionBuilder((column) => this.whereColumns.push(column));
      const predicate = (args[0] as (eb: FakeExpressionBuilder) => FakePredicate)(eb);
      this.predicate = this.predicate === null
        ? predicate
        : (row) => (this.predicate as FakePredicate)(row) && predicate(row);
      return this;
    }
    const [column, op, value] = args as [string, string, unknown];
    this.whereColumns.push(column);
    const predicate: FakePredicate = (row) => compare(op, columnValue(row, column), value);
    this.predicate = this.predicate === null
      ? predicate
      : (row) => (this.predicate as FakePredicate)(row) && predicate(row);
    return this;
  }

  limit(limit: number): this {
    this.limitValue = limit;
    return this;
  }

  private joinedRows(): JoinedRow[] {
    let current: JoinedRow[] = this.db.rows(this.table).map((row) => qualify(this.table, row));
    for (const join of this.joins) {
      const rightRows = this.db.rows(join.table);
      // Cặp cột nối có thể viết theo cả hai chiều (`bảng-nối.cột = bảng-gốc.cột` hoặc ngược lại): xác định phía nào thuộc bảng nối rồi mới so khớp.
      const leftTable = join.left.split('.')[0];
      const joinedColumn = leftTable === join.table ? columnOf(join.left) : columnOf(join.right);
      const baseColumn = leftTable === join.table ? join.right : join.left;
      const next: JoinedRow[] = [];
      for (const baseRow of current) {
        const baseValue = columnValue(baseRow, baseColumn);
        const matched = rightRows.filter((row) => row[joinedColumn] === baseValue);
        if (matched.length > 0) {
          for (const row of matched) next.push({ ...baseRow, ...qualify(join.table, row) });
        } else if (join.kind === 'left') {
          const padded: JoinedRow = { ...baseRow };
          const keys = new Set<string>();
          for (const row of rightRows) for (const key of Object.keys(row)) keys.add(key);
          for (const key of keys) padded[`${join.table}.${key}`] = null;
          next.push(padded);
        }
      }
      current = next;
    }
    return this.predicate === null ? current : current.filter(this.predicate);
  }

  private run(): FakeRow[] {
    this.db.recordLog({ kind: 'select', table: this.table, limit: this.limitValue, whereColumns: [...this.whereColumns] });
    const rows = this.joinedRows();
    const limited = this.limitValue === null ? rows : rows.slice(0, this.limitValue);
    if (this.columns === null) return limited.map((row) => ({ ...row }));
    return limited.map((row) => projectRow(row, this.columns as readonly string[]));
  }

  async execute(): Promise<FakeRow[]> {
    return this.run();
  }

  async executeTakeFirst(): Promise<FakeRow | undefined> {
    return this.run()[0];
  }

  async executeTakeFirstOrThrow(): Promise<FakeRow> {
    const row = this.run()[0];
    if (row === undefined) throw new Error('Không có dòng nào khớp truy vấn giả');
    return row;
  }
}

/** Builder insert giả. */
class FakeInsertBuilder {
  private doNothing = false;
  private returningColumns: readonly string[] | null = null;

  constructor(
    private readonly db: FakeEnrolDb,
    private readonly table: string,
    private readonly values: FakeRow,
  ) {}

  onConflict(callback: (oc: { doNothing(): unknown }) => unknown): this {
    callback({ doNothing: () => undefined });
    this.doNothing = true;
    return this;
  }

  returning(columns: string | readonly string[]): this {
    this.returningColumns = typeof columns === 'string' ? [columns] : columns;
    return this;
  }

  private run(): FakeRow[] {
    this.db.recordLog({ kind: 'insert', table: this.table, limit: null, whereColumns: [] });
    this.db.runBeforeInsert(this.table, this.values);
    if (this.db.findConflict(this.table, this.values) !== null) {
      if (this.doNothing) return [];
      throw uniqueViolationError();
    }
    const row: FakeRow = { ...this.values };
    if (row.id === undefined) row.id = this.db.nextId();
    this.db.rows(this.table).push(row);
    if (this.returningColumns === null) return [];
    return [projectRow(qualify(this.table, row), this.returningColumns)];
  }

  async execute(): Promise<FakeRow[]> {
    return this.run();
  }

  async executeTakeFirst(): Promise<FakeRow | undefined> {
    return this.run()[0];
  }

  async executeTakeFirstOrThrow(): Promise<FakeRow> {
    const row = this.run()[0];
    if (row === undefined) throw new Error('Không có dòng nào khớp truy vấn giả');
    return row;
  }
}

/** Builder update giả. */
class FakeUpdateBuilder {
  private setValues: FakeRow = {};
  private predicate: FakePredicate | null = null;
  private readonly whereColumns: string[] = [];

  constructor(
    private readonly db: FakeEnrolDb,
    private readonly table: string,
  ) {}

  set(values: FakeRow): this {
    this.setValues = values;
    return this;
  }

  where(...args: unknown[]): this {
    if (typeof args[0] === 'function') {
      const eb = createExpressionBuilder((column) => this.whereColumns.push(column));
      const predicate = (args[0] as (eb: FakeExpressionBuilder) => FakePredicate)(eb);
      this.predicate = this.predicate === null
        ? predicate
        : (row) => (this.predicate as FakePredicate)(row) && predicate(row);
      return this;
    }
    const [column, op, value] = args as [string, string, unknown];
    this.whereColumns.push(column);
    const predicate: FakePredicate = (row) => compare(op, columnValue(row, column), value);
    this.predicate = this.predicate === null
      ? predicate
      : (row) => (this.predicate as FakePredicate)(row) && predicate(row);
    return this;
  }

  async execute(): Promise<unknown> {
    this.db.recordLog({ kind: 'update', table: this.table, limit: null, whereColumns: [...this.whereColumns] });
    const updateEb = createUpdateExpressionBuilder();
    for (const row of this.db.rows(this.table)) {
      const view = qualify(this.table, row);
      if (this.predicate !== null && !this.predicate(view)) continue;
      for (const [key, value] of Object.entries(this.setValues)) {
        if (typeof value === 'function') {
          const marker = (value as (eb: unknown) => unknown)(updateEb);
          if (isUpdateOpMarker(marker)) {
            const current = row[marker.column];
            row[key] = typeof current === 'number'
              ? marker.op === '+' ? current + marker.value : current - marker.value
              : marker.value;
          } else {
            row[key] = marker;
          }
        } else {
          row[key] = value;
        }
      }
    }
    return undefined;
  }
}

/** Builder delete giả. */
class FakeDeleteBuilder {
  private predicate: FakePredicate | null = null;
  private readonly whereColumns: string[] = [];

  constructor(
    private readonly db: FakeEnrolDb,
    private readonly table: string,
  ) {}

  where(...args: unknown[]): this {
    if (typeof args[0] === 'function') {
      const eb = createExpressionBuilder((column) => this.whereColumns.push(column));
      const predicate = (args[0] as (eb: FakeExpressionBuilder) => FakePredicate)(eb);
      this.predicate = this.predicate === null
        ? predicate
        : (row) => (this.predicate as FakePredicate)(row) && predicate(row);
      return this;
    }
    const [column, op, value] = args as [string, string, unknown];
    this.whereColumns.push(column);
    const predicate: FakePredicate = (row) => compare(op, columnValue(row, column), value);
    this.predicate = this.predicate === null
      ? predicate
      : (row) => (this.predicate as FakePredicate)(row) && predicate(row);
    return this;
  }

  async execute(): Promise<unknown> {
    this.db.recordLog({ kind: 'delete', table: this.table, limit: null, whereColumns: [...this.whereColumns] });
    const kept = this.db.rows(this.table).filter((row) => {
      if (this.predicate === null) return false;
      return !this.predicate(qualify(this.table, row));
    });
    this.db.replaceRows(this.table, kept);
    return undefined;
  }
}

/**
 * Cơ sở dữ liệu giả: giữ các bảng trong bộ nhớ và phát handle
 * Kysely cho các lõi. Mỗi test dựng một bản mới để trạng thái
 * không rò sang test khác.
 */
export class FakeEnrolDb {
  /** Nhật ký truy vấn theo thứ tự chạy (để khẳng định số lượt truy vấn và hình dạng where/limit). */
  readonly log: FakeQueryLogEntry[] = [];
  /** Handle Kysely giả đưa cho lõi (đừng dùng trực tiếp để đọc bảng — dùng `rows`). */
  readonly handle: EnrolDatabase;

  private readonly tables = new Map<string, FakeRow[]>();
  private idCounter = 1;
  private readonly uniqueKeys: Record<string, string[][]>;

  constructor(private readonly options: FakeDbOptions = {}) {
    this.uniqueKeys = options.uniqueKeys ?? DEFAULT_UNIQUE_KEYS;
    this.handle = this.buildHandle();
  }

  /** Nạp thêm dòng vào một bảng (khoá snake_case như cột PostgreSQL). */
  seed(table: string, rows: FakeRow[]): void {
    this.rows(table).push(...rows.map((row) => ({ ...row })));
  }

  /** Các dòng hiện có của một bảng (mảng sống — test đọc trạng thái sau thao tác qua đây). */
  rows(table: string): FakeRow[] {
    const existing = this.tables.get(table);
    if (existing) return existing;
    const created: FakeRow[] = [];
    this.tables.set(table, created);
    return created;
  }

  /** Thay toàn bộ dòng của một bảng (dùng cho delete). */
  replaceRows(table: string, rows: FakeRow[]): void {
    this.tables.set(table, rows);
  }

  /** Các mục nhật ký select trên một bảng, theo thứ tự chạy. */
  selects(table: string): FakeQueryLogEntry[] {
    return this.log.filter((entry) => entry.kind === 'select' && entry.table === table);
  }

  /** Id uuid giả tiếp theo (định dạng uuid hợp lệ để qua kiểm `uuidIdSchema`). */
  nextId(): string {
    const n = this.idCounter++;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  }

  /** Ghi một mục nhật ký (gọi nội bộ từ các builder). */
  recordLog(entry: FakeQueryLogEntry): void {
    this.log.push(entry);
  }

  /** Chạy móc `beforeInsert` của test (nếu có). */
  runBeforeInsert(table: string, values: FakeRow): void {
    this.options.beforeInsert?.(this, table, values);
  }

  /**
   * Dòng hiện hữu vi phạm khoá duy nhất của bảng với dữ kiện chèn
   * (null khi không vi phạm): mọi cột khoá phải khác null và bằng
   * nhau — cột khoá null thì không xung đột, đúng PostgreSQL.
   */
  findConflict(table: string, values: FakeRow): FakeRow | null {
    const keySets = this.uniqueKeys[table] ?? [];
    for (const keySet of keySets) {
      if (keySet.some((column) => values[column] === undefined || values[column] === null)) continue;
      const clash = this.rows(table).find((row) => keySet.every((column) => row[column] === values[column]));
      if (clash) return clash;
    }
    return null;
  }

  private buildHandle(): EnrolDatabase {
    const handle = {
      selectFrom: (table: string) => new FakeSelectBuilder(this, table),
      insertInto: (table: string) => ({
        values: (values: FakeRow) => new FakeInsertBuilder(this, table, values),
      }),
      updateTable: (table: string) => new FakeUpdateBuilder(this, table),
      deleteFrom: (table: string) => new FakeDeleteBuilder(this, table),
      transaction: () => ({
        execute: async <T>(fn: (trx: EnrolDatabase) => Promise<T>): Promise<T> => fn(this.buildHandle()),
      }),
    };
    return handle as unknown as EnrolDatabase;
  }
}

/** Một sự kiện outbox đã ghi lại (kèm handle transaction nhận được, để khẳng định cùng-transaction). */
export interface RecordedOutboxEvent {
  /** Handle transaction truyền vào `enqueue` (null với `enqueueStandalone`). */
  tx: unknown;
  /** Nội dung sự kiện. */
  input: SharedOutboxEventInput;
  /** Có phải ghi trong transaction ngắn riêng không. */
  standalone: boolean;
}

/** Cổng outbox giả: chỉ ghi lại sự kiện, không ghi database. */
export class FakeOutbox implements SharedOutboxPort {
  readonly events: RecordedOutboxEvent[] = [];

  async enqueue(tx: SharedOutboxTx, input: SharedOutboxEventInput): Promise<void> {
    this.events.push({ tx, input, standalone: false });
  }

  async enqueueStandalone(input: SharedOutboxEventInput): Promise<void> {
    this.events.push({ tx: null, input, standalone: true });
  }
}

/**
 * Cổng chạy trong ngữ cảnh platform giả: bản giả không có RLS nên
 * chỉ gọi thẳng hàm.
 */
export const runInPlatformScope: PlatformScopeRunner = async (fn) => fn();
