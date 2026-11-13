import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProgramDatasetStatus, ProgramImportChange, ProgramImportResult } from '@giaokhoa/contracts';
import type { CentreTx } from '@giaokhoa/db';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContextsService } from '../access/contexts.service';
import { CurriculumRepository, type CurriculumNodeRow } from '@giaokhoa/db/repositories/curriculum';
import { CURRICULUM_MANAGE, CURRICULUM_VIEW } from './curriculum.service';
import {
  loadProgramDataset, programAncestorNodeId, programCurriculumId, programDatasetByKey, programLessonNodeId,
  programOutcomeDocText, programRecordAncestors, programRecordEffectiveGrade, programRecordHash,
  programRecordOutcomeDocs, programRecordSourceRef, programRecordTitle, programSubjectId, PROGRAM_DATASETS,
  type ProgramOutcomeDoc,
  type ProgramDatasetDef, type ProgramDatasetFile, type ProgramRecord,
} from './program-datasets';

const IMPORT_CHANGES_CAP = 500;

type OutcomeWrite =
  | { kind: 'insert'; doc: ProgramOutcomeDoc; text: string; position: number }
  | { kind: 'update'; id: string; patch: { position?: number; content?: ProgramOutcomeDoc; retiredAt?: Date | null } }
  | { kind: 'retire'; id: string };

interface TreeIndex {
  childByKey: Map<string, CurriculumNodeRow>;
  nextPosByParent: Map<string, number>;
}

function childKey(parentId: string | null, kind: string, title: string): string {
  return `${parentId ?? ''}|${kind}|${title}`;
}

@Injectable()
export class ProgramImportService {
  private readonly running = new Set<string>();

  constructor(
    private readonly repo: CurriculumRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
  ) {}

  async listDatasetStatus(actorId: string): Promise<ProgramDatasetStatus[]> {
    const sys = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, CURRICULUM_VIEW, sys.id);
    const out: ProgramDatasetStatus[] = [];
    for (const def of PROGRAM_DATASETS) {
      const file = loadProgramDataset(def);
      const rows = await this.repo.listProgramRecords(def.key);
      const subject = await this.repo.getSubjectBySlug(def.slug);
      const last = rows.reduce<Date | null>((acc, r) => (acc === null || r.updatedAt > acc ? r.updatedAt : acc), null);
      out.push({
        datasetKey: def.key,
        subjectName: def.subjectName,
        slug: def.slug,
        grades: [...new Set(file.records.map((r) => r.grade))].filter((g): g is number => g !== null).sort((a, b) => a - b),
        totalRecords: file.records.length,
        importedRecords: rows.length,
        subjectId: subject?.id ?? null,
        lastImportedAt: last ? last.toISOString() : null,
      });
    }
    return out;
  }

  async importDataset(actorId: string, datasetKey: string): Promise<ProgramImportResult> {
    const def = this.defOr404(datasetKey);
    const sys = await this.contexts.ensureSystemContext();
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, sys.id);
    return this.runGuarded(def, sys.id, loadProgramDataset(def));
  }

  async importDatasetInternal(datasetKey: string): Promise<ProgramImportResult> {
    const def = this.defOr404(datasetKey);
    const sys = await this.contexts.ensureSystemContext();
    return this.runGuarded(def, sys.id, loadProgramDataset(def));
  }

  async importDatasetFileInternal(datasetKey: string, file: ProgramDatasetFile): Promise<ProgramImportResult> {
    const def = this.defOr404(datasetKey);
    const sys = await this.contexts.ensureSystemContext();
    return this.runGuarded(def, sys.id, file);
  }

  async importAllDatasetsInternal(): Promise<ProgramImportResult[]> {
    const out: ProgramImportResult[] = [];
    for (const def of PROGRAM_DATASETS) out.push(await this.importDatasetInternal(def.key));
    return out;
  }

  private defOr404(datasetKey: string): ProgramDatasetDef {
    const def = programDatasetByKey(datasetKey);
    if (!def) {
      throw new NotFoundException({ message: `Program dataset ${datasetKey} is not in the manifest`, code: 'curriculum.program_dataset_not_found' });
    }
    return def;
  }

  private async runGuarded(def: ProgramDatasetDef, systemContextId: string, file: ProgramDatasetFile): Promise<ProgramImportResult> {
    if (this.running.has(def.key)) {
      throw new ConflictException({ message: `Import of dataset ${def.key} is already running`, code: 'curriculum.program_import_in_progress' });
    }
    this.running.add(def.key);
    try {
      return await this.runImport(def, systemContextId, file);
    } finally {
      this.running.delete(def.key);
    }
  }

  private async runImport(def: ProgramDatasetDef, systemContextId: string, file: ProgramDatasetFile): Promise<ProgramImportResult> {
    if (file.records.length === 0) {
      throw new BadRequestException({ message: `Program dataset ${def.key} has no records`, code: 'curriculum.program_dataset_empty' });
    }
    let subject = await this.repo.getSubjectBySlug(def.slug);
    if (!subject) {
      subject = await this.repo.insertSubject({
        id: programSubjectId(def.slug),
        contextId: systemContextId,
        name: def.subjectName,
        slug: def.slug,
        position: PROGRAM_DATASETS.indexOf(def) + 1,
      });
    }
    const curricula = new Map<number, string>();
    for (const row of await this.repo.listCurricula(subject.id)) curricula.set(row.grade, row.id);
    for (const grade of new Set(file.records.map((r) => programRecordEffectiveGrade(file.records, r)))) {
      if (!curricula.has(grade)) {
        const created = await this.repo.insertCurriculum({ id: programCurriculumId(def.slug, grade), subjectId: subject.id, grade });
        curricula.set(grade, created.id);
      }
    }
    const indexes = new Map<string, TreeIndex>();
    const indexFor = async (curriculumId: string): Promise<TreeIndex> => {
      const existing = indexes.get(curriculumId);
      if (existing) return existing;
      const nodes = await this.repo.listNodes(curriculumId);
      const index: TreeIndex = { childByKey: new Map(), nextPosByParent: new Map() };
      for (const node of nodes) {
        index.childByKey.set(childKey(node.parentId, node.kind, node.title), node);
        const key = node.parentId ?? '';
        index.nextPosByParent.set(key, Math.max(index.nextPosByParent.get(key) ?? 1, node.position + 1));
      }
      indexes.set(curriculumId, index);
      return index;
    };

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let outcomesWritten = 0;
    const changes: ProgramImportChange[] = [];
    for (const record of file.records) {
      const grade = programRecordEffectiveGrade(file.records, record);
      const curriculumId = curricula.get(grade)!;
      const index = await indexFor(curriculumId);
      const parent = await this.ensureAncestors(index, curriculumId, def.slug, grade, record);
      const parentId = parent?.id ?? null;
      const title = programRecordTitle(record);
      const hash = programRecordHash(record);
      const entries = programRecordOutcomeDocs(record);
      const reg = await this.repo.getProgramRecord(def.key, record.id);
      if (reg && reg.contentHash === hash) {
        const managed = await this.repo.listDatasetManagedOutcomes(reg.nodeId);
        const entryTexts = new Set(entries.map((e) => e.text));
        const revivable = managed.some((o) => o.retiredAt !== null && entryTexts.has(programOutcomeDocText(o.content)));
        if (!revivable) {
          skipped += 1;
          continue;
        }
      }
      const sourceRef = programRecordSourceRef(record);
      if (!reg) {
        const position = this.takePosition(index, parentId);
        const lessonId = programLessonNodeId(def.key, record.id);
        await this.repo.transaction(async (tx) => {
          const lesson = await this.repo.insertNode({
            id: lessonId, curriculumId, parentId, title, kind: 'lesson', position,
          }, tx);
          for (const entry of entries) {
            await this.repo.insertOutcome({
              nodeId: lesson.id, content: entry.doc, position: entry.position,
              sourceKind: 'program', sourceRef, derivedFromId: null,
            }, tx);
          }
          await this.repo.insertProgramRecord({
            datasetKey: def.key, recordId: record.id, subjectId: subject.id,
            curriculumId, nodeId: lesson.id, contentHash: hash, source: record.source,
          }, tx);
          index.childByKey.set(childKey(parentId, 'lesson', title), lesson);
        });
        created += 1;
        outcomesWritten += entries.length;
        for (const entry of entries) {
          changes.push({ recordId: record.id, position: entry.position, kind: 'added', newText: entry.text });
        }
        continue;
      }
      const current = await this.repo.getNode(reg.nodeId);
      const diff = await this.diffOutcomes({ recordId: record.id, nodeId: reg.nodeId, entries });
      changes.push(...diff.changes);
      await this.repo.transaction(async (tx) => {
        const patch: {
          title: string; parentId?: string | null; position?: number; curriculumId?: string;
        } = { title };
        if (reg.curriculumId !== curriculumId) patch.curriculumId = curriculumId;
        if (!current || current.parentId !== parentId || reg.curriculumId !== curriculumId) {
          patch.parentId = parentId;
          patch.position = this.takePosition(index, parentId);
        }
        await this.repo.updateNode(reg.nodeId, patch, tx);
        await this.applyOutcomeWrites(tx, reg.nodeId, sourceRef, diff.writes);
        await this.repo.updateProgramRecord(reg.id, {
          subjectId: subject.id, curriculumId, nodeId: reg.nodeId, contentHash: hash, source: record.source,
        }, tx);
        if (current) index.childByKey.set(childKey(parentId, 'lesson', title), { ...current, ...patch });
      });
      updated += 1;
      outcomesWritten += diff.writes.length;
    }
    const fileIds = new Set(file.records.map((r) => r.id));
    let orphanedNodes = 0;
    for (const row of await this.repo.listProgramRecords(def.key)) {
      if (fileIds.has(row.recordId)) continue;
      orphanedNodes += 1;
      const managed = await this.repo.listDatasetManagedOutcomes(row.nodeId);
      const currentManaged = managed.filter((o) => o.retiredAt === null);
      if (currentManaged.length === 0) continue;
      const links = await this.repo.countOutcomeLinks(currentManaged.map((o) => o.id));
      await this.repo.transaction(async (tx) => {
        for (const outcome of currentManaged) {
          await this.repo.updateOutcome(outcome.id, { retiredAt: new Date() }, tx);
        }
      });
      for (const outcome of currentManaged) {
        const link = links.get(outcome.id);
        changes.push({
          recordId: row.recordId, position: outcome.position, kind: 'removed', oldText: programOutcomeDocText(outcome.content),
          identicalTextAmbiguous: currentManaged.filter((o) => programOutcomeDocText(o.content) === programOutcomeDocText(outcome.content)).length >= 2 || undefined,
          linkedQuestions: link?.questions ?? 0, linkedBookMappings: link?.bookMappings ?? 0,
        });
        outcomesWritten += 1;
      }
    }
    const sortedChanges = [...changes].sort(
      (a, b) => a.recordId.localeCompare(b.recordId) || a.position - b.position,
    );
    const changeCounts = { textChanged: 0, added: 0, removed: 0, moved: 0, revived: 0, shiftSuspected: 0 };
    for (const change of changes) {
      if (change.kind === 'text-changed') changeCounts.textChanged += 1;
      else if (change.kind === 'added') changeCounts.added += 1;
      else if (change.kind === 'removed') changeCounts.removed += 1;
      else if (change.kind === 'moved') changeCounts.moved += 1;
      else changeCounts.revived += 1;
      if (change.shiftSuspected) changeCounts.shiftSuspected += 1;
    }
    return {
      datasetKey: def.key,
      subjectId: subject.id,
      totalRecords: file.records.length,
      created, updated, skipped, outcomesWritten,
      orphanedNodes,
      retiredOutcomes: await this.repo.countRetiredOutcomesForDataset(def.key),
      changeCounts,
      changes: sortedChanges.slice(0, IMPORT_CHANGES_CAP),
      changesOmitted: Math.max(0, sortedChanges.length - IMPORT_CHANGES_CAP),
    };
  }

  private async applyOutcomeWrites(tx: CentreTx, nodeId: string, sourceRef: string, writes: OutcomeWrite[]): Promise<void> {
    const TEMP_POSITION_BASE = 1_000_000;
    let tempSeq = 0;
    for (const write of writes) {
      if (write.kind === 'update' && write.patch.position !== undefined) {
        tempSeq += 1;
        await this.repo.updateOutcome(write.id, { position: TEMP_POSITION_BASE + tempSeq }, tx);
      }
    }
    for (const write of writes) {
      if (write.kind === 'retire') {
        await this.repo.updateOutcome(write.id, { retiredAt: new Date() }, tx);
      }
    }
    for (const write of writes) {
      if (write.kind === 'update') {
        await this.repo.updateOutcome(write.id, write.patch, tx);
      }
    }
    for (const write of writes) {
      if (write.kind === 'insert') {
        await this.repo.insertOutcome({
          nodeId, content: write.doc, position: write.position,
          sourceKind: 'program', sourceRef, derivedFromId: null,
        }, tx);
      }
    }
  }

  private async diffOutcomes(input: {
    recordId: string; nodeId: string;
    entries: { doc: ProgramOutcomeDoc; text: string; position: number }[];
  }): Promise<{ writes: OutcomeWrite[]; changes: ProgramImportChange[] }> {
    const { recordId, entries } = input;
    const managed = await this.repo.listDatasetManagedOutcomes(input.nodeId);
    const current = managed.filter((o) => o.retiredAt === null);
    const retiredPool = managed.filter((o) => o.retiredAt !== null);
    const writes: OutcomeWrite[] = [];
    const changes: ProgramImportChange[] = [];
    const takenEntries = new Set<number>();
    const takenRows = new Set<string>();
    const linkTargets: { outcomeId: string; change: ProgramImportChange }[] = [];

    entries.forEach((entry, idx) => {
      const row = current.find(
        (o) => !takenRows.has(o.id) && o.position === entry.position && programOutcomeDocText(o.content) === entry.text,
      );
      if (row) {
        takenEntries.add(idx);
        takenRows.add(row.id);
      }
    });

    const groupByText = <T extends { text: string }>(items: T[]): Map<string, T[]> => {
      const map = new Map<string, T[]>();
      for (const item of items) map.set(item.text, [...(map.get(item.text) ?? []), item]);
      return map;
    };
    const remainingEntries = entries
      .map((entry, idx) => ({ ...entry, idx }))
      .filter((e) => !takenEntries.has(e.idx));
    const remainingCurrent = current.filter((o) => !takenRows.has(o.id));
    const entryGroups = groupByText(remainingEntries);
    const rowGroups = new Map<string, typeof remainingCurrent>();
    for (const row of remainingCurrent) {
      const text = programOutcomeDocText(row.content);
      rowGroups.set(text, [...(rowGroups.get(text) ?? []), row]);
    }
    for (const [text, group] of entryGroups) {
      const rows = rowGroups.get(text);
      if (!rows) continue;
      const sortedEntries = [...group].sort((a, b) => a.position - b.position);
      const sortedRows = [...rows].sort((a, b) => a.position - b.position);
      const pairs = Math.min(sortedEntries.length, sortedRows.length);
      for (let i = 0; i < pairs; i += 1) {
        const entry = sortedEntries[i]!;
        const row = sortedRows[i]!;
        takenEntries.add(entry.idx);
        takenRows.add(row.id);
        writes.push({ kind: 'update', id: row.id, patch: { position: entry.position } });
        changes.push({ recordId, position: entry.position, kind: 'moved', newText: entry.text });
      }
    }

    entries.forEach((entry, idx) => {
      if (takenEntries.has(idx)) return;
      const row = current.find((o) => !takenRows.has(o.id) && o.position === entry.position);
      if (!row) return;
      takenEntries.add(idx);
      takenRows.add(row.id);
      writes.push({ kind: 'update', id: row.id, patch: { content: entry.doc } });
      const rowText = programOutcomeDocText(row.content);
      const shiftSuspected =
        current.some((o) => o.id !== row.id && programOutcomeDocText(o.content) === entry.text) ||
        entries.some((e) => e.text === rowText && e.position !== entry.position);
      const change: ProgramImportChange = {
        recordId, position: entry.position, kind: 'text-changed',
        oldText: rowText, newText: entry.text,
        shiftSuspected: shiftSuspected || undefined,
      };
      changes.push(change);
      linkTargets.push({ outcomeId: row.id, change });
    });

    const revivedRowIds = new Set<string>();
    for (const [idx, entry] of entries.entries()) {
      if (takenEntries.has(idx)) continue;
      takenEntries.add(idx);
      const revived = retiredPool.find((o) => !revivedRowIds.has(o.id) && programOutcomeDocText(o.content) === entry.text);
      if (revived) {
        revivedRowIds.add(revived.id);
        writes.push({ kind: 'update', id: revived.id, patch: { position: entry.position, retiredAt: null } });
        changes.push({ recordId, position: entry.position, kind: 'revived', newText: entry.text });
        continue;
      }
      writes.push({ kind: 'insert', doc: entry.doc, text: entry.text, position: entry.position });
      changes.push({ recordId, position: entry.position, kind: 'added', newText: entry.text });
    }

    for (const row of current) {
      if (takenRows.has(row.id)) continue;
      writes.push({ kind: 'retire', id: row.id });
      const rowText = programOutcomeDocText(row.content);
      const change: ProgramImportChange = {
        recordId, position: row.position, kind: 'removed', oldText: rowText,
        identicalTextAmbiguous: current.filter((o) => programOutcomeDocText(o.content) === rowText).length >= 2 || undefined,
      };
      changes.push(change);
      linkTargets.push({ outcomeId: row.id, change });
    }

    if (linkTargets.length > 0) {
      const links = await this.repo.countOutcomeLinks(linkTargets.map((t) => t.outcomeId));
      for (const target of linkTargets) {
        const link = links.get(target.outcomeId);
        target.change.linkedQuestions = link?.questions ?? 0;
        target.change.linkedBookMappings = link?.bookMappings ?? 0;
      }
    }
    return { writes, changes };
  }

  private async ensureAncestors(
    index: TreeIndex,
    curriculumId: string,
    slug: string,
    grade: number,
    record: ProgramRecord,
  ): Promise<CurriculumNodeRow | null> {
    let parent: CurriculumNodeRow | null = null;
    const path: [string, string][] = [];
    for (const step of programRecordAncestors(record)) {
      path.push([step.kind, step.title]);
      const key = childKey(parent?.id ?? null, step.kind, step.title);
      const existing = index.childByKey.get(key);
      if (existing) {
        parent = existing;
        continue;
      }
      const position = this.takePosition(index, parent?.id ?? null);
      const node = await this.repo.insertNode({
        id: programAncestorNodeId(slug, grade, path),
        curriculumId, parentId: parent?.id ?? null, title: step.title, kind: step.kind, position,
      });
      index.childByKey.set(key, node);
      parent = node;
    }
    return parent;
  }

  private takePosition(index: TreeIndex, parentId: string | null): number {
    const key = parentId ?? '';
    const position = index.nextPosByParent.get(key) ?? 1;
    index.nextPosByParent.set(key, position + 1);
    return position;
  }
}
