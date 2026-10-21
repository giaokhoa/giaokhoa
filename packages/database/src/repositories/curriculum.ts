import { ClientError } from '@giaokhoa/application/common/client-error';
import type {
  CurriculumRepository,
  UpdateNodeTreeResult,
} from '@giaokhoa/application/curriculum/repository';
import {
  curriculumNodeSchema,
  curriculumSchema,
  learningOutcomeSchema,
  subjectSchema,
  type CurriculumCreate,
  type CurriculumNodeCreate,
  type CurriculumNodePatch,
  type CurriculumPatch,
  type LearningOutcomeCreate,
  type LearningOutcomePatch,
  type SubjectCreate,
  type SubjectPatch,
} from '@giaokhoa/shared/curriculum';
import { and, asc, eq } from 'drizzle-orm';
import { curricula, curriculumNodes, learningOutcomes, subjects } from '../schema/curriculum.js';
import type { Database } from '../types.js';

function hasPostgresCode(error: unknown, code: string) {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ('code' in current && (current as { code?: unknown }).code === code) return true;
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/**
 * Lớp truy cập PostgreSQL cho môn học, chương trình, cây nội dung và yêu cầu cần đạt.
 * Giữ quan hệ cha-con trong cùng chương trình, đồng thời liên kết câu hỏi với môn và yêu cầu cần đạt.
 */
export class PostgresCurriculumRepository implements CurriculumRepository {
  constructor(private readonly db: Database) {}

  async listSubjects() {
    const rows = await this.db
      .select()
      .from(subjects)
      .orderBy(asc(subjects.position), asc(subjects.name));
    return rows.map((row) => subjectSchema.parse(row));
  }

  async createSubject(data: SubjectCreate) {
    try {
      const [subject] = await this.db.insert(subjects).values(data).returning();
      return subjectSchema.parse(subject);
    } catch (error) {
      if (hasPostgresCode(error, '23505'))
        throw new ClientError('conflict', 'subject_slug_conflict', 'Slug môn học đã tồn tại');
      throw error;
    }
  }

  async findSubject(id: string) {
    const [subject] = await this.db.select().from(subjects).where(eq(subjects.id, id)).limit(1);
    return subject ? subjectSchema.parse(subject) : undefined;
  }

  async updateSubject(id: string, data: SubjectPatch) {
    try {
      const [subject] = await this.db
        .update(subjects)
        .set(data)
        .where(eq(subjects.id, id))
        .returning();
      return subject ? subjectSchema.parse(subject) : undefined;
    } catch (error) {
      if (hasPostgresCode(error, '23505'))
        throw new ClientError('conflict', 'subject_slug_conflict', 'Slug môn học đã tồn tại');
      throw error;
    }
  }

  async deleteSubject(id: string) {
    const [subject] = await this.db
      .delete(subjects)
      .where(eq(subjects.id, id))
      .returning({ id: subjects.id });
    return subject;
  }

  async listAllCurricula() {
    const rows = await this.db
      .select()
      .from(curricula)
      .orderBy(asc(curricula.subjectId), asc(curricula.grade));
    return rows.map((row) => curriculumSchema.parse(row));
  }

  async listCurricula(subjectId: string) {
    const rows = await this.db
      .select()
      .from(curricula)
      .where(eq(curricula.subjectId, subjectId))
      .orderBy(asc(curricula.grade));
    return rows.map((row) => curriculumSchema.parse(row));
  }

  async createCurriculum(data: CurriculumCreate) {
    try {
      const [curriculum] = await this.db.insert(curricula).values(data).returning();
      return curriculumSchema.parse(curriculum);
    } catch (error) {
      if (hasPostgresCode(error, '23505'))
        throw new ClientError(
          'conflict',
          'curriculum_conflict',
          'Chương trình của môn và lớp này đã tồn tại',
        );
      throw error;
    }
  }

  async findCurriculum(id: string) {
    const [curriculum] = await this.db
      .select()
      .from(curricula)
      .where(eq(curricula.id, id))
      .limit(1);
    return curriculum ? curriculumSchema.parse(curriculum) : undefined;
  }

  async findCurriculumBySubjectAndGrade(subjectId: string, grade: number) {
    const [curriculum] = await this.db
      .select()
      .from(curricula)
      .where(and(eq(curricula.subjectId, subjectId), eq(curricula.grade, grade)))
      .limit(1);
    return curriculum ? curriculumSchema.parse(curriculum) : undefined;
  }

  async updateCurriculum(id: string, data: CurriculumPatch) {
    try {
      const [curriculum] = await this.db
        .update(curricula)
        .set(data)
        .where(eq(curricula.id, id))
        .returning();
      return curriculum ? curriculumSchema.parse(curriculum) : undefined;
    } catch (error) {
      if (hasPostgresCode(error, '23505'))
        throw new ClientError(
          'conflict',
          'curriculum_conflict',
          'Chương trình của môn và lớp này đã tồn tại',
        );
      throw error;
    }
  }

  async deleteCurriculum(id: string) {
    const [curriculum] = await this.db
      .delete(curricula)
      .where(eq(curricula.id, id))
      .returning({ id: curricula.id });
    return curriculum;
  }

  async listNodes(curriculumId: string) {
    const rows = await this.db
      .select()
      .from(curriculumNodes)
      .where(eq(curriculumNodes.curriculumId, curriculumId))
      .orderBy(asc(curriculumNodes.position), asc(curriculumNodes.id));
    return rows.map((row) => curriculumNodeSchema.parse(row));
  }

  async createNode(data: CurriculumNodeCreate) {
    const [node] = await this.db.insert(curriculumNodes).values(data).returning();
    return curriculumNodeSchema.parse(node);
  }

  async findNode(id: string) {
    const [node] = await this.db
      .select()
      .from(curriculumNodes)
      .where(eq(curriculumNodes.id, id))
      .limit(1);
    return node ? curriculumNodeSchema.parse(node) : undefined;
  }

  async updateNode(id: string, data: CurriculumNodePatch) {
    const [node] = await this.db
      .update(curriculumNodes)
      .set(data)
      .where(eq(curriculumNodes.id, id))
      .returning();
    return node ? curriculumNodeSchema.parse(node) : undefined;
  }

  async updateNodeTree(
    id: string,
    data: CurriculumNodePatch & { parentId: string | null },
  ): Promise<UpdateNodeTreeResult> {
    return this.db.transaction(async (tx) => {
      const [lookup] = await tx
        .select({ curriculumId: curriculumNodes.curriculumId })
        .from(curriculumNodes)
        .where(eq(curriculumNodes.id, id))
        .limit(1);
      if (!lookup) return { status: 'not_found' };

      const [curriculum] = await tx
        .select({ id: curricula.id })
        .from(curricula)
        .where(eq(curricula.id, lookup.curriculumId))
        .limit(1)
        .for('update');
      if (!curriculum) return { status: 'not_found' };

      const [current] = await tx
        .select()
        .from(curriculumNodes)
        .where(eq(curriculumNodes.id, id))
        .limit(1);
      if (!current) return { status: 'not_found' };

      if (data.parentId) {
        if (data.parentId === id) return { status: 'cycle' };

        const [parent] = await tx
          .select({ id: curriculumNodes.id, curriculumId: curriculumNodes.curriculumId })
          .from(curriculumNodes)
          .where(eq(curriculumNodes.id, data.parentId))
          .limit(1);
        if (!parent || parent.curriculumId !== current.curriculumId) {
          return { status: 'invalid_parent' };
        }

        const visited = new Set<string>();
        let ancestorId: string | null = data.parentId;
        while (ancestorId) {
          if (ancestorId === id || visited.has(ancestorId)) return { status: 'cycle' };
          visited.add(ancestorId);

          const [ancestor] = await tx
            .select({ parentId: curriculumNodes.parentId })
            .from(curriculumNodes)
            .where(eq(curriculumNodes.id, ancestorId))
            .limit(1);
          if (!ancestor) return { status: 'invalid_parent' };
          ancestorId = ancestor.parentId;
        }
      }

      const [node] = await tx
        .update(curriculumNodes)
        .set(data)
        .where(eq(curriculumNodes.id, id))
        .returning();
      return node
        ? { status: 'updated', node: curriculumNodeSchema.parse(node) }
        : { status: 'not_found' };
    });
  }

  async deleteNode(id: string) {
    const [node] = await this.db
      .delete(curriculumNodes)
      .where(eq(curriculumNodes.id, id))
      .returning({ id: curriculumNodes.id });
    return node;
  }

  async listOutcomes(nodeId: string) {
    const rows = await this.db
      .select()
      .from(learningOutcomes)
      .where(eq(learningOutcomes.nodeId, nodeId))
      .orderBy(asc(learningOutcomes.position), asc(learningOutcomes.id));
    return rows.map((row) => learningOutcomeSchema.parse(row));
  }

  async createOutcome(data: LearningOutcomeCreate) {
    const [outcome] = await this.db.insert(learningOutcomes).values(data).returning();
    return learningOutcomeSchema.parse(outcome);
  }

  async findOutcome(id: string) {
    const [outcome] = await this.db
      .select()
      .from(learningOutcomes)
      .where(eq(learningOutcomes.id, id))
      .limit(1);
    return outcome ? learningOutcomeSchema.parse(outcome) : undefined;
  }

  async updateOutcome(id: string, data: LearningOutcomePatch) {
    const [outcome] = await this.db
      .update(learningOutcomes)
      .set(data)
      .where(eq(learningOutcomes.id, id))
      .returning();
    return outcome ? learningOutcomeSchema.parse(outcome) : undefined;
  }

  async deleteOutcome(id: string) {
    const [outcome] = await this.db
      .delete(learningOutcomes)
      .where(eq(learningOutcomes.id, id))
      .returning({ id: learningOutcomes.id });
    return outcome;
  }
}
