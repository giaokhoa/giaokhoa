import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { ContextsService } from '../access/contexts.service';
import { CoursesService } from '../courses/courses.service';
import {
  CurriculumRepository, type CurriculumNodeRow, type CurriculumRow, type LearningOutcomeRow, type SubjectRow,
} from '@giaokhoa/db/repositories/curriculum';
import { programOutcomeDocText, programOutcomeTextToDoc, type ProgramOutcomeDoc } from './program-datasets';

export type CurriculumOutcomeView = Omit<LearningOutcomeRow, 'content'> & {
  content: string;
  contentDoc: ProgramOutcomeDoc;
};

export function toCurriculumOutcomeView(row: LearningOutcomeRow): CurriculumOutcomeView {
  const contentDoc = (row.content ?? { type: 'doc' }) as ProgramOutcomeDoc;
  return {
    ...row,
    content: programOutcomeDocText(contentDoc),
    contentDoc,
  };
}

export const CURRICULUM_VIEW = 'curriculum:view';
export const CURRICULUM_MANAGE = 'curriculum:manage';
const COURSE_UPDATE = 'course:update';

export interface CurriculumNodeView extends CurriculumNodeRow {
  outcomes: CurriculumOutcomeView[];
  children: CurriculumNodeView[];
}

export interface CurriculumTreeView {
  curriculum: CurriculumRow;
  subject: SubjectRow;
  nodes: CurriculumNodeView[];
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  while (e !== null && typeof e === 'object') {
    if ((e as { code?: unknown }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class CurriculumService implements OnModuleInit {
  constructor(
    private readonly repo: CurriculumRepository,
    private readonly contexts: ContextsService,
    private readonly evaluator: PermissionEvaluator,
    private readonly courses: CoursesService,
  ) {}

  onModuleInit(): void {
    this.courses.registerCurriculumFrameProvider({
      getFrameUnits: (actorId, curriculumId) => this.getFrameUnits(actorId, curriculumId),
    });
  }

  private async contextOrSystem(contextId?: string) {
    if (!contextId) return this.contexts.ensureSystemContext();
    const ctx = await this.contexts.getContext(contextId).catch(() => undefined);
    return ctx ?? (await this.contexts.ensureSystemContext());
  }


  async createSubject(actorId: string, input: { contextId: string; name: string; slug: string; position?: number }): Promise<SubjectRow> {
    const ctx = await this.contextOrSystem(input.contextId);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, ctx.id);
    try {
      return await this.repo.insertSubject({
        contextId: ctx.id, name: input.name, slug: input.slug, position: input.position ?? 1,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ message: `Subject slug ${input.slug} is already taken`, code: 'curriculum.subject_slug_taken' });
      }
      throw err;
    }
  }
  async listSubjects(actorId: string, contextId?: string, forCourseId?: string): Promise<SubjectRow[]> {
    const ctx = await this.contextOrSystem(contextId);
    await this.assertCanRead(actorId, ctx.id, forCourseId);
    return this.repo.listSubjects(ctx.id);
  }
  async getSubject(actorId: string, id: string): Promise<SubjectRow> {
    const row = await this.subjectOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_VIEW, row.contextId);
    return row;
  }
  async updateSubject(actorId: string, id: string, input: { name?: string; slug?: string; position?: number }): Promise<SubjectRow> {
    const row = await this.subjectOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, row.contextId);
    try {
      await this.repo.updateSubject(id, input);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ message: `Subject slug ${input.slug} is already taken`, code: 'curriculum.subject_slug_taken' });
      }
      throw err;
    }
    return this.subjectOr404(id);
  }
  async deleteSubject(actorId: string, id: string): Promise<void> {
    const row = await this.subjectOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, row.contextId);
    const curricula = await this.repo.listCurricula(id);
    const { nodeIds, outcomeIds } = await this.subtreeIds(curricula.map((c) => c.id));
    await this.assertNotReferenced(nodeIds, outcomeIds, `subject ${row.slug}`);
    await this.repo.deleteSubject(id);
  }


  async createCurriculum(actorId: string, input: { subjectId: string; grade: number }): Promise<CurriculumRow> {
    const subject = await this.subjectOr404(input.subjectId);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, subject.contextId);
    try {
      return await this.repo.insertCurriculum({ subjectId: subject.id, grade: input.grade });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ message: `Subject already has a curriculum for grade ${input.grade}`, code: 'curriculum.grade_exists' });
      }
      throw err;
    }
  }
  async listCurricula(actorId: string, subjectId: string, forCourseId?: string): Promise<CurriculumRow[]> {
    const subject = await this.subjectOr404(subjectId);
    await this.assertCanRead(actorId, subject.contextId, forCourseId);
    return this.repo.listCurricula(subject.id);
  }
  async getCurriculum(actorId: string, id: string): Promise<CurriculumRow> {
    const { curriculum, subject } = await this.curriculumChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_VIEW, subject.contextId);
    return curriculum;
  }
  async updateCurriculum(actorId: string, id: string, input: { grade?: number }): Promise<CurriculumRow> {
    const { subject } = await this.curriculumChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, subject.contextId);
    try {
      await this.repo.updateCurriculum(id, input);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ message: `Subject already has a curriculum for grade ${input.grade}`, code: 'curriculum.grade_exists' });
      }
      throw err;
    }
    return (await this.curriculumChainOr404(id)).curriculum;
  }
  async deleteCurriculum(actorId: string, id: string): Promise<void> {
    const { subject } = await this.curriculumChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, subject.contextId);
    const { nodeIds, outcomeIds } = await this.subtreeIds([id]);
    await this.assertNotReferenced(nodeIds, outcomeIds, `curriculum ${id}`);
    await this.repo.deleteCurriculum(id);
  }


  async createNode(actorId: string, input: {
    curriculumId: string; parentId?: string | null; title: string; kind?: string; position?: number;
    durationPeriods?: number | null; durationPercent?: number | null;
  }): Promise<CurriculumNodeRow> {
    const { subject } = await this.curriculumChainOr404(input.curriculumId);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, subject.contextId);
    if (input.parentId) await this.assertParentInCurriculum(input.parentId, input.curriculumId);
    return this.repo.insertNode({
      curriculumId: input.curriculumId,
      parentId: input.parentId ?? null,
      title: input.title,
      kind: input.kind ?? 'topic',
      position: input.position ?? 1,
      durationPeriods: input.durationPeriods ?? null,
      durationPercent: input.durationPercent ?? null,
    });
  }
  async getNode(actorId: string, id: string): Promise<CurriculumNodeRow> {
    const { node, subject } = await this.nodeChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_VIEW, subject.contextId);
    return node;
  }
  async updateNode(actorId: string, id: string, input: {
    parentId?: string | null; title?: string; kind?: string; position?: number;
    durationPeriods?: number | null; durationPercent?: number | null;
  }): Promise<CurriculumNodeRow> {
    const { node, subject } = await this.nodeChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, subject.contextId);
    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === id) {
        throw new BadRequestException({ message: 'A node cannot be its own parent', code: 'curriculum.node_parent_self' });
      }
      await this.assertParentInCurriculum(input.parentId, node.curriculumId);
      await this.assertNoParentCycle(id, input.parentId, node.curriculumId);
    }
    await this.repo.updateNode(id, input);
    return (await this.nodeChainOr404(id)).node;
  }
  async deleteNode(actorId: string, id: string): Promise<void> {
    const { node, subject } = await this.nodeChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, subject.contextId);
    const all = await this.repo.listNodes(node.curriculumId);
    const childrenByParent = new Map<string, string[]>();
    for (const n of all) {
      if (n.parentId) childrenByParent.set(n.parentId, [...(childrenByParent.get(n.parentId) ?? []), n.id]);
    }
    const nodeIds = [id];
    for (let i = 0; i < nodeIds.length; i += 1) nodeIds.push(...(childrenByParent.get(nodeIds[i]!) ?? []));
    const outcomes = await this.repo.listOutcomesForNodes(nodeIds, { includeRetired: true });
    await this.assertNotReferenced(nodeIds, outcomes.map((o) => o.id), `node ${id}`);
    await this.repo.deleteNode(id);
  }

  private async assertCanRead(actorId: string, subjectContextId: string, forCourseId?: string): Promise<void> {
    if (await this.evaluator.hasCapability(actorId, CURRICULUM_VIEW, subjectContextId)) return;
    if (forCourseId) {
      const courseCtxId = await this.courses.courseContextId(forCourseId).catch(() => undefined);
      if (courseCtxId && (await this.evaluator.hasCapability(actorId, COURSE_UPDATE, courseCtxId))) return;
    }
    await this.evaluator.requireCapability(actorId, CURRICULUM_VIEW, subjectContextId);
  }

  async getTree(actorId: string, curriculumId: string, forCourseId?: string): Promise<CurriculumTreeView> {
    const { curriculum, subject } = await this.curriculumChainOr404(curriculumId);
    await this.assertCanRead(actorId, subject.contextId, forCourseId);
    return this.buildTree(curriculum, subject);
  }

  private async buildTree(curriculum: CurriculumRow, subject: SubjectRow): Promise<CurriculumTreeView> {
    const curriculumId = curriculum.id;
    const nodes = await this.repo.listNodes(curriculumId);
    const outcomes = await this.repo.listOutcomesForNodes(nodes.map((n) => n.id));
    const byId = new Map<string, CurriculumNodeView>();
    for (const node of nodes) byId.set(node.id, { ...node, outcomes: [], children: [] });
    for (const outcome of outcomes) byId.get(outcome.nodeId)?.outcomes.push(toCurriculumOutcomeView(outcome));
    const roots: CurriculumNodeView[] = [];
    for (const node of nodes) {
      const view = byId.get(node.id)!;
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(view); else roots.push(view);
    }
    return { curriculum, subject, nodes: roots };
  }

  async getFrameUnits(_actorId: string, curriculumId: string): Promise<{
    nodeId: string; title: string; kind: string;
    outcomes: { outcomeId: string; content: string }[];
  }[]> {
    const { curriculum, subject } = await this.curriculumChainOr404(curriculumId);
    const tree = await this.buildTree(curriculum, subject);
    const units: { nodeId: string; title: string; kind: string; outcomes: { outcomeId: string; content: string }[] }[] = [];
    const collectOutcomes = (node: CurriculumNodeView, acc: { outcomeId: string; content: string }[]): void => {
      for (const o of node.outcomes) acc.push({ outcomeId: o.id, content: o.content });
      for (const child of node.children) collectOutcomes(child, acc);
    };
    const walk = (node: CurriculumNodeView): void => {
      if (node.kind !== 'lesson') {
        const outcomes: { outcomeId: string; content: string }[] = [];
        collectOutcomes(node, outcomes);
        units.push({ nodeId: node.id, title: node.title, kind: node.kind, outcomes });
      }
      for (const child of node.children) walk(child);
    };
    for (const root of tree.nodes) walk(root);
    return units;
  }


  async getSubjectReference(id: string): Promise<SubjectRow> {
    return this.subjectOr404(id);
  }

  async getCurriculumReference(id: string): Promise<CurriculumRow> {
    return (await this.curriculumChainOr404(id)).curriculum;
  }

  async getTreeReference(curriculumId: string): Promise<CurriculumTreeView> {
    const { curriculum, subject } = await this.curriculumChainOr404(curriculumId);
    return this.buildTree(curriculum, subject);
  }

  async getNodeReference(id: string): Promise<CurriculumNodeRow> {
    return (await this.nodeChainOr404(id)).node;
  }


  async createOutcome(actorId: string, input: {
    nodeId: string; content: string; position?: number;
    sourceKind?: string; sourceRef?: string | null; derivedFromId?: string | null;
  }): Promise<CurriculumOutcomeView> {
    const { subject } = await this.nodeChainOr404(input.nodeId);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, subject.contextId);
    await this.assertOutcomeSource({ sourceKind: input.sourceKind ?? 'program', derivedFromId: input.derivedFromId ?? null });
    return toCurriculumOutcomeView(await this.repo.insertOutcome({
      nodeId: input.nodeId, content: programOutcomeTextToDoc(input.content), position: input.position ?? 1,
      sourceKind: input.sourceKind ?? 'program', sourceRef: input.sourceRef ?? null, derivedFromId: input.derivedFromId ?? null,
    }));
  }
  async listOutcomes(actorId: string, nodeId: string, opts?: { includeRetired?: boolean }): Promise<CurriculumOutcomeView[]> {
    const { subject } = await this.nodeChainOr404(nodeId);
    await this.evaluator.requireCapability(actorId, CURRICULUM_VIEW, subject.contextId);
    return (await this.repo.listOutcomes(nodeId, opts)).map(toCurriculumOutcomeView);
  }
  async listOutcomesReference(nodeId: string, opts?: { includeRetired?: boolean }): Promise<CurriculumOutcomeView[]> {
    await this.nodeChainOr404(nodeId);
    return (await this.repo.listOutcomes(nodeId, opts)).map(toCurriculumOutcomeView);
  }
  async programRecordIdForNode(nodeId: string): Promise<string | null> {
    const row = await this.repo.getProgramRecordByNodeId(nodeId);
    return row?.recordId ?? null;
  }
  async getOutcome(actorId: string, id: string): Promise<CurriculumOutcomeView> {
    const { outcome, subject } = await this.outcomeChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_VIEW, subject.contextId);
    return toCurriculumOutcomeView(outcome);
  }
  async getOutcomeReference(id: string): Promise<CurriculumOutcomeView> {
    return toCurriculumOutcomeView((await this.outcomeChainOr404(id)).outcome);
  }
  async searchOutcomes(
    actorId: string,
    input: { query: string; subjectId?: string; gradeLevel?: number; limit?: number },
  ): Promise<{
    id: string;
    content: string;
    sourceKind: string;
    sourceRef: string | null;
    nodeId: string;
    nodeTitle: string;
    subjectId: string;
    subjectName: string;
    grade: number;
  }[]> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const rows = await this.repo.searchOutcomes({
      query: input.query,
      subjectId: input.subjectId,
      grade: input.gradeLevel,
      limit: 200,
    });
    const readableBySubject = new Map<string, boolean>();
    const results: {
      id: string; content: string; sourceKind: string; sourceRef: string | null;
      nodeId: string; nodeTitle: string; subjectId: string; subjectName: string; grade: number;
    }[] = [];
    for (const row of rows) {
      let readable = readableBySubject.get(row.subjectId);
      if (readable === undefined) {
        readable = await this.evaluator.hasCapability(actorId, CURRICULUM_VIEW, row.subjectContextId);
        readableBySubject.set(row.subjectId, readable);
      }
      if (!readable) continue;
      results.push({
        id: row.outcome.id,
        content: programOutcomeDocText(row.outcome.content as ProgramOutcomeDoc),
        sourceKind: row.outcome.sourceKind,
        sourceRef: row.outcome.sourceRef,
        nodeId: row.outcome.nodeId,
        nodeTitle: row.nodeTitle,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        grade: row.grade,
      });
      if (results.length >= limit) break;
    }
    return results;
  }
  async updateOutcome(actorId: string, id: string, input: {
    content?: string; position?: number;
    sourceKind?: string; sourceRef?: string | null; derivedFromId?: string | null;
  }): Promise<CurriculumOutcomeView> {
    const { outcome, subject } = await this.outcomeChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, subject.contextId);
    await this.assertOutcomeSource({
      sourceKind: input.sourceKind ?? outcome.sourceKind,
      derivedFromId: input.derivedFromId !== undefined ? input.derivedFromId : outcome.derivedFromId,
    }, id);
    await this.repo.updateOutcome(id, {
      ...input,
      content: input.content !== undefined ? programOutcomeTextToDoc(input.content) : undefined,
    });
    return toCurriculumOutcomeView((await this.outcomeChainOr404(id)).outcome);
  }
  async getOutcomeQuestionCounts(actorId: string, id: string): Promise<{ outcomeId: string; counts: { cognitiveLevel: string; qtype: string; count: number }[] }> {
    const { subject } = await this.outcomeChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_VIEW, subject.contextId);
    return { outcomeId: id, counts: await this.repo.countReadyQuestionsForOutcome(id) };
  }
  async deleteOutcome(actorId: string, id: string): Promise<void> {
    const { subject } = await this.outcomeChainOr404(id);
    await this.evaluator.requireCapability(actorId, CURRICULUM_MANAGE, subject.contextId);
    await this.assertNotReferenced([], [id], `learning outcome ${id}`);
    await this.repo.deleteOutcome(id);
  }

  private async subtreeIds(curriculumIds: string[]): Promise<{ nodeIds: string[]; outcomeIds: string[] }> {
    const nodeIds: string[] = [];
    for (const curriculumId of curriculumIds) {
      const nodes = await this.repo.listNodes(curriculumId);
      nodeIds.push(...nodes.map((n) => n.id));
    }
    const outcomes = await this.repo.listOutcomesForNodes(nodeIds);
    return { nodeIds, outcomeIds: outcomes.map((o) => o.id) };
  }

  private async assertNotReferenced(nodeIds: string[], outcomeIds: string[], what: string): Promise<void> {
    const refs = await this.repo.countGuardedReferences(nodeIds, outcomeIds);
    const parts: string[] = [];
    if (refs.bookMappings > 0) parts.push(`${refs.bookMappings} book mapping(s)`);
    if (refs.examMatrixCells > 0) parts.push(`${refs.examMatrixCells} exam matrix cell(s)`);
    if (refs.questionOutcomes > 0) parts.push(`${refs.questionOutcomes} question–outcome link(s)`);
    if (parts.length === 0) return;
    throw new ConflictException({
      message: `Cannot delete ${what}: still referenced by ${parts.join(', ')}. Remove those references first.`,
      code: 'curriculum.delete_referenced',
    });
  }


  private async subjectOr404(id: string): Promise<SubjectRow> {
    const row = await this.repo.getSubject(id);
    if (!row) throw new NotFoundException({ message: `Subject ${id} not found`, code: 'curriculum.subject_not_found' });
    return row;
  }
  private async curriculumChainOr404(id: string): Promise<{ curriculum: CurriculumRow; subject: SubjectRow }> {
    const curriculum = await this.repo.getCurriculum(id);
    if (!curriculum) throw new NotFoundException({ message: `Curriculum ${id} not found`, code: 'curriculum.curriculum_not_found' });
    const subject = await this.subjectOr404(curriculum.subjectId);
    return { curriculum, subject };
  }
  private async nodeChainOr404(id: string): Promise<{ node: CurriculumNodeRow; curriculum: CurriculumRow; subject: SubjectRow }> {
    const node = await this.repo.getNode(id);
    if (!node) throw new NotFoundException({ message: `Curriculum node ${id} not found`, code: 'curriculum.node_not_found' });
    const { curriculum, subject } = await this.curriculumChainOr404(node.curriculumId);
    return { node, curriculum, subject };
  }
  private async outcomeChainOr404(id: string): Promise<{ outcome: LearningOutcomeRow; node: CurriculumNodeRow; subject: SubjectRow }> {
    const outcome = await this.repo.getOutcome(id);
    if (!outcome) throw new NotFoundException({ message: `Learning outcome ${id} not found`, code: 'curriculum.outcome_not_found' });
    const { node, subject } = await this.nodeChainOr404(outcome.nodeId);
    return { outcome, node, subject };
  }
  private async assertParentInCurriculum(parentId: string, curriculumId: string): Promise<void> {
    const parent = await this.repo.getNode(parentId);
    if (!parent) throw new NotFoundException({ message: `Curriculum node ${parentId} not found`, code: 'curriculum.node_not_found' });
    if (parent.curriculumId !== curriculumId) {
      throw new BadRequestException({ message: 'Parent node belongs to a different curriculum', code: 'curriculum.node_parent_mismatch' });
    }
  }

  private async assertNoParentCycle(nodeId: string, newParentId: string, curriculumId: string): Promise<void> {
    const nodes = await this.repo.listNodes(curriculumId);
    const parentById = new Map(nodes.map((n) => [n.id, n.parentId]));
    const visited = new Set<string>();
    let cursor: string | null = newParentId;
    while (cursor !== null) {
      if (cursor === nodeId) {
        throw new BadRequestException({
          message: 'The new parent is a descendant of this node; the change would create a cycle in the curriculum tree',
          code: 'curriculum.node_parent_cycle',
        });
      }
      if (visited.has(cursor)) break;
      visited.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  }

  private async assertOutcomeSource(state: { sourceKind: string; derivedFromId: string | null }, selfId?: string): Promise<void> {
    if (state.sourceKind === 'derived' && state.derivedFromId === null) {
      throw new BadRequestException({
        message: 'derivedFromId is required when sourceKind is derived',
        code: 'curriculum.outcome_derived_from_required',
      });
    }
    if (state.derivedFromId === null) return;
    if (selfId !== undefined && state.derivedFromId === selfId) {
      throw new BadRequestException({ message: 'A learning outcome cannot be derived from itself', code: 'curriculum.outcome_derived_from_self' });
    }
    if (state.sourceKind !== 'derived') {
      throw new BadRequestException({
        message: 'derivedFromId is only used when sourceKind is derived',
        code: 'curriculum.outcome_derived_from_mismatch',
      });
    }
    const origin = await this.repo.getOutcome(state.derivedFromId);
    if (!origin) throw new NotFoundException({ message: `Learning outcome ${state.derivedFromId} not found`, code: 'curriculum.outcome_not_found' });
  }
}
