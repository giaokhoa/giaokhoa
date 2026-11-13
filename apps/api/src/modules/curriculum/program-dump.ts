import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql, type CentreDb } from '@giaokhoa/db';
import type {
  CurriculumNodeRow, CurriculumRow, LearningOutcomeRow, ProgramRecordRow, SubjectRow,
} from '@giaokhoa/db/repositories/curriculum';


export const PROGRAM_DUMP_VERSION = '2026-10-29.3';

export const PROGRAM_DUMP_FILE_NAME = 'program-dump.sql';

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertStatement(table: string, columns: string[], values: unknown[]): string {
  return `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${values.map(sqlLiteral).join(', ')});`;
}

function orderNodesTopologically<T extends { id: string; parentId: string | null; position: number }>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depthOf = (row: T): number => {
    let depth = 0;
    let cursor: T | undefined = row;
    const guard = new Set<string>();
    while (cursor?.parentId && byId.has(cursor.parentId) && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      depth += 1;
      cursor = byId.get(cursor.parentId);
    }
    return depth;
  };
  return [...rows].sort((a, b) => depthOf(a) - depthOf(b) || a.position - b.position);
}

function orderOutcomesTopologically<T extends { id: string; derivedFromId: string | null; position: number }>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depthOf = (row: T): number => {
    let depth = 0;
    let cursor: T | undefined = row;
    const guard = new Set<string>();
    while (cursor?.derivedFromId && byId.has(cursor.derivedFromId) && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      depth += 1;
      cursor = byId.get(cursor.derivedFromId);
    }
    return depth;
  };
  return [...rows].sort((a, b) => depthOf(a) - depthOf(b) || a.position - b.position);
}

export async function buildProgramDumpSql(db: CentreDb, opts?: { datasetKey?: string }): Promise<string> {
  let subjectRows: SubjectRow[] = await db.selectFrom('subjects').select([
    'id', 'context_id as contextId', 'name', 'slug', 'position',
    'created_at as createdAt', 'updated_at as updatedAt',
  ]).execute();
  let curriculaRows: CurriculumRow[] = await db.selectFrom('curricula').select([
    'id', 'subject_id as subjectId', 'grade', 'created_at as createdAt', 'updated_at as updatedAt',
  ]).execute();
  let nodeRows: CurriculumNodeRow[] = await db.selectFrom('curriculum_nodes').select([
    'id', 'curriculum_id as curriculumId', 'parent_id as parentId', 'title', 'kind', 'position',
    'duration_periods as durationPeriods', 'duration_percent as durationPercent',
    'created_at as createdAt', 'updated_at as updatedAt',
  ]).execute();
  let outcomeRows: LearningOutcomeRow[] = await db.selectFrom('learning_outcomes').select([
    'id', 'tenant_id as tenantId', 'node_id as nodeId', 'content', 'position',
    'source_kind as sourceKind', 'source_ref as sourceRef', 'derived_from_id as derivedFromId',
    'retired_at as retiredAt', 'created_at as createdAt', 'updated_at as updatedAt',
  ]).execute();
  let recordRows: ProgramRecordRow[] = await db.selectFrom('curriculum_program_records').select([
    'id', 'dataset_key as datasetKey', 'record_id as recordId', 'subject_id as subjectId',
    'curriculum_id as curriculumId', 'node_id as nodeId', 'content_hash as contentHash', 'source',
    'created_at as createdAt', 'updated_at as updatedAt',
  ]).execute();
  if (opts?.datasetKey) {
    recordRows = recordRows.filter((r) => r.datasetKey === opts.datasetKey);
    const subjectIds = new Set(recordRows.map((r) => r.subjectId));
    const curriculumIds = new Set(recordRows.map((r) => r.curriculumId));
    const nodeIds = new Set(nodeRows.filter((n) => curriculumIds.has(n.curriculumId)).map((n) => n.id));
    subjectRows = subjectRows.filter((r) => subjectIds.has(r.id));
    curriculaRows = curriculaRows.filter((r) => curriculumIds.has(r.id));
    nodeRows = nodeRows.filter((n) => nodeIds.has(n.id));
    outcomeRows = outcomeRows.filter((o) => nodeIds.has(o.nodeId));
  }
  nodeRows = orderNodesTopologically(nodeRows);
  outcomeRows = orderOutcomesTopologically(outcomeRows);

  const lines: string[] = [
    '-- =====================================================================',
    '-- DUMP ĐÔNG CỨNG DỮ LIỆU CHƯƠNG TRÌNH GDPT 2018 — KHÔNG SỬA TAY.',
    `-- Version dump: ${PROGRAM_DUMP_VERSION}`,
    `-- Sinh lúc: ${new Date().toISOString()}`,
    '-- Nguồn: DB chuẩn đã nạp/patch bằng ProgramImportService từ các dataset',
    '-- đã kiểm chứng nguyên văn với văn bản của Bộ (TT 32/2018/TT-BGDĐT).',
    `-- Số dòng: subjects=${subjectRows.length}, curricula=${curriculaRows.length}, ` +
      `curriculum_nodes=${nodeRows.length}, learning_outcomes=${outcomeRows.length}, ` +
      `curriculum_program_records=${recordRows.length}.`,
    '-- Mọi môi trường restore nguyên văn file này khi seed (ProgramDumpService),',
    '-- KHÔNG chạy importer. ID là hằng số literal nên khớp 100% giữa các môi trường.',
    '-- Cập nhật dữ liệu chuẩn: patch DB chuẩn bằng importer → chạy export-program-dump',
    '-- → commit bản mới kèm tăng PROGRAM_DUMP_VERSION.',
    '-- =====================================================================',
    '',
  ];
  for (const r of subjectRows) {
    lines.push(insertStatement('subjects',
      ['id', 'context_id', 'name', 'slug', 'position', 'created_at', 'updated_at'],
      [r.id, r.contextId, r.name, r.slug, r.position, r.createdAt, r.updatedAt]));
  }
  for (const r of curriculaRows) {
    lines.push(insertStatement('curricula',
      ['id', 'subject_id', 'grade', 'created_at', 'updated_at'],
      [r.id, r.subjectId, r.grade, r.createdAt, r.updatedAt]));
  }
  for (const r of nodeRows) {
    lines.push(insertStatement('curriculum_nodes',
      ['id', 'curriculum_id', 'parent_id', 'title', 'kind', 'position', 'duration_periods', 'duration_percent', 'created_at', 'updated_at'],
      [r.id, r.curriculumId, r.parentId, r.title, r.kind, r.position, r.durationPeriods, r.durationPercent, r.createdAt, r.updatedAt]));
  }
  for (const r of outcomeRows) {
    lines.push(insertStatement('learning_outcomes',
      ['id', 'tenant_id', 'node_id', 'content', 'position', 'source_kind', 'source_ref', 'derived_from_id', 'retired_at', 'created_at', 'updated_at'],
      [r.id, r.tenantId, r.nodeId, r.content, r.position, r.sourceKind, r.sourceRef, r.derivedFromId, r.retiredAt, r.createdAt, r.updatedAt]));
  }
  for (const r of recordRows) {
    lines.push(insertStatement('curriculum_program_records',
      ['id', 'dataset_key', 'record_id', 'subject_id', 'curriculum_id', 'node_id', 'content_hash', 'source', 'created_at', 'updated_at'],
      [r.id, r.datasetKey, r.recordId, r.subjectId, r.curriculumId, r.nodeId, r.contentHash, r.source, r.createdAt, r.updatedAt]));
  }
  lines.push('');
  return lines.join('\n');
}

export function loadProgramDumpSql(): string {
  return readFileSync(join(__dirname, 'program-data-dump', PROGRAM_DUMP_FILE_NAME), 'utf8');
}

export async function restoreProgramDumpSql(
  db: CentreDb,
  dumpSql: string,
  opts?: { anchorContextId?: string },
): Promise<void> {
  const anchorContextId = opts?.anchorContextId;
  await db.transaction().execute(async (tx) => {
    const subjectIdsBefore = anchorContextId
      ? new Set((await tx.selectFrom('subjects').select(['id']).execute()).map((r) => r.id))
      : null;
    await sql.raw(dumpSql).execute(tx);
    if (anchorContextId && subjectIdsBefore) {
      const restoredIds = (await tx.selectFrom('subjects').select(['id']).execute())
        .map((r) => r.id)
        .filter((id) => !subjectIdsBefore.has(id));
      if (restoredIds.length > 0) {
        await tx
          .updateTable('subjects')
          .set({ context_id: anchorContextId, updated_at: new Date() })
          .where((eb) =>
            eb.and([eb('id', 'in', restoredIds), eb('context_id', '!=', anchorContextId)]),
          )
          .execute();
      }
    }
  });
}
