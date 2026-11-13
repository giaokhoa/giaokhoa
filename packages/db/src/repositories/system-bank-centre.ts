/**
 * Repository phía TRUNG TÂM của kho ngân hàng hệ thống trên Kysely.
 *
 * Vai trò: các bảng vệ tinh nằm trong kho nghiệp vụ của trung tâm — bản ghi nhập bản chụp (`system_question_imports`), vết nhận sự kiện (`system_bank_event_receipts`), bản cài gói YCCĐ
 * (`outcome_package_installs`) — cộng các tra cứu và upsert cần
 * cho đường nhập bản chụp và đường cài gói (slug trung tâm, môn học, chương trình, YCCĐ theo id giữ nguyên).
 *
 * Handle là handle Kysely ĐỊNH TUYẾN THEO KHÔNG GIAN của kho trung tâm (`SpaceDatabaseService.routedKysely` phía ứng dụng):
 * trong ngữ cảnh request của trung tâm, handle trỏ đúng kho của trung tâm đó (kho chung hoặc kho riêng sau di trú), nên service nhập/cài không tự chọn kho. Handle này tách hẳn handle kho ngân hàng riêng của `system-bank.ts` — hai kho không có transaction chung, repository này không bao giờ chạm database kho ngân hàng.
 *
 * Khuôn hình dạng dữ liệu ở biên repository (như pilot): bên trong dùng tên bảng/cột snake_case của interface schema sinh bằng codegen; bên ngoài trả/nhận hình dạng dòng camelCase như phía tiêu thụ đang dùng (danh sách cột tường minh có bí danh cho cả select lẫn returning, kiểu dòng công khai khai ngay trong file này — không import từ file schema bộ máy cũ vốn bị xoá ở hạng mục gỡ bộ máy cũ); giá trị ghi vào cột jsonb đi qua helper serialize tường minh + `::jsonb`; mọi giá trị where là tham số bắt buộc. Các phương thức ghi bản chụp nhận handle giao dịch tuỳ chọn do bên gọi truyền tường minh (khuôn `tx ?? handle gốc`) — một transaction chỉ chứa một ORM, cấm giao dịch lai.
 */
import { sql, type RawBuilder } from 'kysely';
import type { CentreDb, CentreTx } from '../client';
import type { LearningOutcomeDoc } from '../jsonb-types';

/** Handle giao dịch của kho trung tâm — kiểu `Transaction<CentreDB>` của package. */
export type SbCentreTx = CentreTx;
/** Handle đọc/ghi mà repository nhận: transaction đang mở hoặc handle định tuyến gốc. */
export type SbCentreDb = CentreDb | CentreTx;

/** Một dòng truy vết nhập bản chụp từ Ngân hàng hệ thống vào kho trung tâm. */
export interface SystemQuestionImportRow {
  /** Câu hỏi ở kho trung tâm (bản chụp) — cũng là khoá chính của dòng truy vết. */
  questionId: string;
  sourceQuestionId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  /** sha256 của gói phiên bản lúc nhập. */
  packageChecksum: string;
  /** Số hiệu version của bản chụp tại thời điểm nhập (version nguyên trạng). */
  importedVersionNumber: number;
  importedAt: Date;
  importedBy: string | null;
  /** pristine = nguyên trạng chưa sửa; derived = đã có version do trung tâm tạo thêm. */
  kind: string;
}

/** Một dòng ghi nhận trung tâm đã nhận một sự kiện của kho ngân hàng. */
export interface SystemBankEventReceiptRow {
  id: string;
  /** Id sự kiện ở kho ngân hàng. */
  eventId: string;
  /** Slug của trung tâm ghi nhận. */
  centreSlug: string;
  receivedAt: Date;
}

/** Một dòng bản cài gói YCCĐ cục bộ của trung tâm. */
export interface OutcomePackageInstallRow {
  id: string;
  /** Định danh phiên bản gói đã cài (khớp `system_outcome_packages.version` ở kho ngân hàng). */
  packageVersion: string;
  packageChecksum: string;
  /** Phiên bản gói trước lần cài này, null ở lần cài đầu tiên. */
  previousVersion: string | null;
  /** all | slug môn học. */
  scope: string;
  installedAt: Date;
  installedBy: string | null;
}

/** Một dòng môn học của trung tâm (hình dạng đầy đủ của bảng `subjects`). */
export interface SystemBankSubjectRow {
  id: string;
  contextId: string;
  name: string;
  slug: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Một dòng chương trình của trung tâm (hình dạng đầy đủ của bảng `curricula`). */
export interface SystemBankCurriculumRow {
  id: string;
  subjectId: string;
  grade: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bọc một giá trị jsonb thành biểu thức tham số JSON tường minh
 * (serialize + ép kiểu `::jsonb`) — khuôn duy nhất cho đường ghi
 * jsonb của repository này: driver `pg` hiểu MẢNG ở cấp cao nhất
 * là mảng PostgreSQL chứ không phải tài liệu JSON (phát hiện của
 * pilot kho control plane).
 *
 * @param value - Giá trị nghiệp vụ sẽ nằm trong cột jsonb.
 * @returns Biểu thức Kysely mang chuỗi JSON đã serialize, giữ
 *   nguyên kiểu cột `T` ở tầng TypeScript.
 */
function jsonbColumn<T>(value: unknown): RawBuilder<T> {
  return sql<T>`${JSON.stringify(value)}::jsonb`;
}

/** Danh sách cột tường minh có bí danh camelCase cho bảng truy vết nhập bản chụp. */
const SYSTEM_QUESTION_IMPORT_COLUMNS = [
  'question_id as questionId',
  'source_question_id as sourceQuestionId',
  'source_version_id as sourceVersionId',
  'source_version_number as sourceVersionNumber',
  'package_checksum as packageChecksum',
  'imported_version_number as importedVersionNumber',
  'imported_at as importedAt',
  'imported_by as importedBy',
  'kind',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng vết nhận sự kiện. */
const SYSTEM_BANK_EVENT_RECEIPT_COLUMNS = [
  'id',
  'event_id as eventId',
  'centre_slug as centreSlug',
  'received_at as receivedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng bản cài gói YCCĐ. */
const OUTCOME_PACKAGE_INSTALL_COLUMNS = [
  'id',
  'package_version as packageVersion',
  'package_checksum as packageChecksum',
  'previous_version as previousVersion',
  'scope',
  'installed_at as installedAt',
  'installed_by as installedBy',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng môn học. */
const SUBJECT_COLUMNS = [
  'id',
  'context_id as contextId',
  'name',
  'slug',
  'position',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/** Danh sách cột tường minh có bí danh camelCase cho bảng chương trình. */
const CURRICULUM_COLUMNS = [
  'id',
  'subject_id as subjectId',
  'grade',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

/**
 * Repository phía trung tâm của kho ngân hàng hệ thống trên
 * Kysely: giữ handle định tuyến theo không gian của kho trung
 * tâm do tầng ứng dụng cấp lúc lắp ráp; mọi truy vấn chạy trên
 * handle đó hoặc trên handle giao dịch bên gọi truyền vào.
 */
export class SystemBankCentreRepository {
  constructor(private readonly db: CentreDb) {}

  /** Slug của tenant theo id (null khi không có) — dùng suy slug trung tâm cho dòng importer khi request không mang slug kho riêng. */
  async resolveTenantSlug(tenantId: string): Promise<string | null> {
    const rows = await this.db
      .selectFrom('tenants')
      .select(['slug'])
      .where('id', '=', tenantId)
      .limit(1)
      .execute();
    return rows[0]?.slug ?? null;
  }

  /** YCCĐ có tồn tại trong bản cài cục bộ của trung tâm không (theo id đã giữ nguyên qua bản cài gói). */
  async outcomeExists(outcomeId: string): Promise<boolean> {
    const rows = await this.db
      .selectFrom('learning_outcomes')
      .select(['id'])
      .where('id', '=', outcomeId)
      .limit(1)
      .execute();
    return rows.length > 0;
  }

  /** Ghi dòng nhập bản chụp (một dòng cho mỗi câu trung tâm — PK chính là id câu trung tâm). */
  async insertImportRow(
    input: {
      questionId: string;
      sourceQuestionId: string;
      sourceVersionId: string;
      sourceVersionNumber: number;
      packageChecksum: string;
      importedVersionNumber: number;
      importedBy: string | null;
      kind: 'pristine' | 'derived';
    },
    tx?: SbCentreDb,
  ): Promise<SystemQuestionImportRow> {
    const handle = tx ?? this.db;
    const [row] = await handle
      .insertInto('system_question_imports')
      .values({
        question_id: input.questionId,
        source_question_id: input.sourceQuestionId,
        source_version_id: input.sourceVersionId,
        source_version_number: input.sourceVersionNumber,
        package_checksum: input.packageChecksum,
        imported_version_number: input.importedVersionNumber,
        imported_by: input.importedBy,
        kind: input.kind,
      })
      .returning(SYSTEM_QUESTION_IMPORT_COLUMNS)
      .execute();
    if (!row) throw new Error('system bank: failed to insert question import row');
    return row;
  }

  /** Đọc dòng nhập bản chụp của một câu trung tâm (null khi câu không phải bản nhập). */
  async getImportRow(questionId: string, tx?: SbCentreDb): Promise<SystemQuestionImportRow | null> {
    const handle = tx ?? this.db;
    const row = await handle
      .selectFrom('system_question_imports')
      .select(SYSTEM_QUESTION_IMPORT_COLUMNS)
      .where('question_id', '=', questionId)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * Chuyển một bản nhập nguyên trạng thành bản phái sinh (khi câu
   * trung tâm bị sửa): chỉ đổi cờ `kind`, không chạm các trường
   * truy vết khác — phiên bản nguyên trạng vẫn đọc lại được theo
   * `importedVersionNumber`.
   */
  async flipImportToDerived(questionId: string, tx?: SbCentreDb): Promise<void> {
    const handle = tx ?? this.db;
    await handle
      .updateTable('system_question_imports')
      .set({ kind: 'derived' })
      .where('question_id', '=', questionId)
      .where('kind', '=', 'pristine')
      .execute();
  }

  /**
   * Ghi vết đã nhận một sự kiện kho ngân hàng (idempotent theo
   * cặp sự kiện + slug trung tâm): insert-bỏ-qua-khi-trùng, nếu
   * cặp đã có thì đọc lại dòng hiện hữu.
   */
  async insertEventReceipt(input: {
    eventId: string;
    centreSlug: string;
  }): Promise<SystemBankEventReceiptRow> {
    const [row] = await this.db
      .insertInto('system_bank_event_receipts')
      .values({ event_id: input.eventId, centre_slug: input.centreSlug })
      .onConflict((oc) => oc.columns(['event_id', 'centre_slug']).doNothing())
      .returning(SYSTEM_BANK_EVENT_RECEIPT_COLUMNS)
      .execute();
    if (row) return row;
    const existing = await this.db
      .selectFrom('system_bank_event_receipts')
      .select(SYSTEM_BANK_EVENT_RECEIPT_COLUMNS)
      .where('event_id', '=', input.eventId)
      .where('centre_slug', '=', input.centreSlug)
      .limit(1)
      .executeTakeFirst();
    if (!existing) throw new Error('system bank: failed to record event receipt');
    return existing;
  }

  /** Liệt kê định danh các sự kiện một trung tâm đã ghi nhận (theo slug của chính trung tâm đó). */
  async listEventReceiptEventIds(centreSlug: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('system_bank_event_receipts')
      .select(['event_id as eventId'])
      .where('centre_slug', '=', centreSlug)
      .execute();
    return rows.map((row) => row.eventId);
  }

  /** Đọc bản cài gói YCCĐ mới nhất của trung tâm (null khi chưa cài gói nào) — dùng suy phiên bản trước khi ghi vết cài mới. */
  async getOutcomePackageInstall(scope?: string, tx?: SbCentreDb): Promise<OutcomePackageInstallRow | null> {
    let query = (tx ?? this.db)
      .selectFrom('outcome_package_installs')
      .select(OUTCOME_PACKAGE_INSTALL_COLUMNS);
    if (scope) query = query.where('scope', '=', scope);
    const row = await query.orderBy('installed_at', 'desc').limit(1).executeTakeFirst();
    return row ?? null;
  }

  /** Lịch sử bản cài của đúng kho trung tâm được định tuyến trong request. */
  async listOutcomePackageInstalls(): Promise<OutcomePackageInstallRow[]> {
    return this.db.selectFrom('outcome_package_installs')
      .select(OUTCOME_PACKAGE_INSTALL_COLUMNS)
      .orderBy('installed_at', 'desc').execute();
  }

  /** Tìm bản cài theo phiên bản: retry không cập nhật thời gian hay nội dung. */
  async getOutcomePackageInstallByVersion(version: string, tx?: SbCentreDb): Promise<OutcomePackageInstallRow | null> {
    return (await (tx ?? this.db).selectFrom('outcome_package_installs')
      .select(OUTCOME_PACKAGE_INSTALL_COLUMNS).where('package_version', '=', version)
      .executeTakeFirst()) ?? null;
  }

  /** Thêm môn chưa tồn tại trong kho đích; tên lấy từ ảnh chụp được duyệt. */
  async insertSubject(input: { contextId: string; name: string; slug: string; position: number }, tx: SbCentreDb): Promise<SystemBankSubjectRow> {
    const [row] = await tx.insertInto('subjects')
      .values({ context_id: input.contextId, name: input.name, slug: input.slug, position: input.position })
      .returning(SUBJECT_COLUMNS).execute();
    if (!row) throw new Error('system bank: failed to install subject');
    return row;
  }

  /** Môn học của trung tâm theo slug duy nhất (null khi chưa có). */
  async findSubjectBySlug(slug: string, tx?: SbCentreDb): Promise<SystemBankSubjectRow | null> {
    const row = await (tx ?? this.db)
      .selectFrom('subjects')
      .select(SUBJECT_COLUMNS)
      .where('slug', '=', slug)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  /** Chương trình của trung tâm theo cặp (môn, khối) — dùng phát hiện xung đột id trước khi cài. */
  async findCurriculumBySubjectGrade(subjectId: string, grade: number, tx?: SbCentreDb): Promise<SystemBankCurriculumRow | null> {
    const row = await (tx ?? this.db)
      .selectFrom('curricula')
      .select(CURRICULUM_COLUMNS)
      .where('subject_id', '=', subjectId)
      .where('grade', '=', grade)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  /** Upsert một chương trình theo id giữ nguyên (bản cài gói). */
  async upsertCurriculum(input: { id: string; subjectId: string; grade: number }, tx?: SbCentreDb): Promise<void> {
    await (tx ?? this.db)
      .insertInto('curricula')
      .values({ id: input.id, subject_id: input.subjectId, grade: input.grade })
      .onConflict((oc) =>
        oc.column('id').doNothing(),
      )
      .execute();
  }

  /** Upsert một node cây chương trình theo id giữ nguyên (gọi theo thứ tự cha trước). */
  async upsertCurriculumNode(input: {
    id: string;
    curriculumId: string;
    parentId: string | null;
    title: string;
    kind: string;
    position: number;
    durationPeriods: number | null;
    durationPercent: number | null;
  }, tx?: SbCentreDb): Promise<void> {
    await (tx ?? this.db)
      .insertInto('curriculum_nodes')
      .values({
        id: input.id,
        curriculum_id: input.curriculumId,
        parent_id: input.parentId,
        title: input.title,
        kind: input.kind,
        position: input.position,
        duration_periods: input.durationPeriods,
        duration_percent: input.durationPercent,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  /**
   * Chỉ chèn YCCĐ mới; id đã có sẽ được so toàn vẹn trong transaction
   * phía service, không cập nhật nội dung cũ vì câu/đề có thể đang dùng.
   */
  async upsertLearningOutcome(input: {
    id: string;
    nodeId: string;
    position: number;
    content: unknown;
    sourceKind: string;
    sourceRef: string | null;
  }, tx?: SbCentreDb): Promise<void> {
    await (tx ?? this.db)
      .insertInto('learning_outcomes')
      .values({
        id: input.id,
        node_id: input.nodeId,
        position: input.position,
        content: jsonbColumn<LearningOutcomeDoc>(input.content),
        source_kind: input.sourceKind,
        source_ref: input.sourceRef,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  /** Ghi nhận chỉ một lần sau khi cài đủ cây trong cùng transaction; retry không sửa vết. */
  async recordOutcomePackageInstall(input: {
    packageVersion: string;
    packageChecksum: string;
    previousVersion: string | null;
    scope: string;
    installedBy: string | null;
  }, tx?: SbCentreDb): Promise<OutcomePackageInstallRow> {
    const [row] = await (tx ?? this.db)
      .insertInto('outcome_package_installs')
      .values({
        package_version: input.packageVersion,
        package_checksum: input.packageChecksum,
        previous_version: input.previousVersion,
        scope: input.scope,
        installed_by: input.installedBy,
      })
      .onConflict((oc) => oc.column('package_version').doNothing())
      .returning(OUTCOME_PACKAGE_INSTALL_COLUMNS)
      .execute();
    if (row) return row;
    const existing = await this.getOutcomePackageInstallByVersion(input.packageVersion, tx);
    if (!existing) throw new Error('system bank: failed to record outcome package install');
    return existing;
  }
}
