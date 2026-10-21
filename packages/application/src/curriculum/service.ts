import type {
  CurriculumCreate,
  CurriculumNodeCreate,
  CurriculumNodePatch,
  CurriculumPatch,
  LearningOutcomeCreate,
  LearningOutcomePatch,
  SubjectCreate,
  SubjectPatch,
} from '@giaokhoa/shared/curriculum';
import { ClientError } from '../common/client-error.js';
import type { CurriculumRepository } from './repository.js';

/** Điều phối cây chương trình học; các quy tắc toàn vẹn cây được thực thi tại kho dữ liệu khi ghi. */
export class CurriculumService {
  constructor(private readonly repository: CurriculumRepository) {}

  listSubjects() {
    return this.repository.listSubjects();
  }

  createSubject(input: SubjectCreate) {
    return this.repository.createSubject(input);
  }

  async getSubject(id: string) {
    const subject = await this.repository.findSubject(id);
    if (!subject) throw new ClientError('not_found', 'subject_not_found', 'Môn học không tồn tại');
    return subject;
  }

  async updateSubject(id: string, patch: SubjectPatch) {
    await this.getSubject(id);
    const subject = await this.repository.updateSubject(id, patch);
    if (!subject) throw new ClientError('not_found', 'subject_not_found', 'Môn học không tồn tại');
    return subject;
  }

  async deleteSubject(id: string) {
    if (!(await this.repository.deleteSubject(id)))
      throw new ClientError('not_found', 'subject_not_found', 'Môn học không tồn tại');
  }

  listAllCurricula() {
    return this.repository.listAllCurricula();
  }

  async listCurricula(subjectId: string) {
    await this.getSubject(subjectId);
    return this.repository.listCurricula(subjectId);
  }

  async createCurriculum(input: CurriculumCreate) {
    await this.getSubject(input.subjectId);
    return this.repository.createCurriculum(input);
  }

  async getCurriculum(id: string) {
    const curriculum = await this.repository.findCurriculum(id);
    if (!curriculum)
      throw new ClientError('not_found', 'curriculum_not_found', 'Chương trình không tồn tại');
    return curriculum;
  }

  async getCurriculumBySubjectAndGrade(subjectId: string, grade: number) {
    await this.getSubject(subjectId);
    const curriculum = await this.repository.findCurriculumBySubjectAndGrade(subjectId, grade);
    if (!curriculum)
      throw new ClientError('not_found', 'curriculum_not_found', 'Chương trình không tồn tại');
    return curriculum;
  }

  async updateCurriculum(id: string, patch: CurriculumPatch) {
    await this.getCurriculum(id);
    if (patch.subjectId) await this.getSubject(patch.subjectId);
    const curriculum = await this.repository.updateCurriculum(id, patch);
    if (!curriculum)
      throw new ClientError('not_found', 'curriculum_not_found', 'Chương trình không tồn tại');
    return curriculum;
  }

  async deleteCurriculum(id: string) {
    if (!(await this.repository.deleteCurriculum(id)))
      throw new ClientError('not_found', 'curriculum_not_found', 'Chương trình không tồn tại');
  }

  async listNodes(curriculumId: string) {
    await this.getCurriculum(curriculumId);
    return this.repository.listNodes(curriculumId);
  }

  /** Xác minh nút cha cùng chương trình trước khi ghi; ràng buộc khóa ngoại vẫn được kiểm tại kho dữ liệu. */
  async createNode(input: CurriculumNodeCreate) {
    await this.getCurriculum(input.curriculumId);
    if (input.parentId) await this.assertValidParent(input.parentId, input.curriculumId);
    return this.repository.createNode(input);
  }

  async getNode(id: string) {
    const node = await this.repository.findNode(id);
    if (!node)
      throw new ClientError(
        'not_found',
        'curriculum_node_not_found',
        'Nội dung chương trình không tồn tại',
      );
    return node;
  }

  /** Tách sửa thông tin thường khỏi đổi nút cha: đổi cấu trúc cây phải kiểm chu trình trong giao dịch. */
  async updateNode(id: string, patch: CurriculumNodePatch) {
    if (patch.parentId === undefined) {
      await this.getNode(id);
      const node = await this.repository.updateNode(id, patch);
      if (!node)
        throw new ClientError(
          'not_found',
          'curriculum_node_not_found',
          'Nội dung chương trình không tồn tại',
        );
      return node;
    }

    const result = await this.repository.updateNodeTree(id, { ...patch, parentId: patch.parentId });
    if (result.status === 'updated') return result.node;
    if (result.status === 'not_found')
      throw new ClientError(
        'not_found',
        'curriculum_node_not_found',
        'Nội dung chương trình không tồn tại',
      );
    if (result.status === 'invalid_parent') {
      throw new ClientError(
        'invalid',
        'curriculum_parent_invalid',
        'Parent node phải tồn tại và thuộc cùng chương trình',
      );
    }
    throw new ClientError('invalid', 'curriculum_cycle', 'Không thể tạo vòng lặp trong cây');
  }

  async deleteNode(id: string) {
    if (!(await this.repository.deleteNode(id)))
      throw new ClientError(
        'not_found',
        'curriculum_node_not_found',
        'Nội dung chương trình không tồn tại',
      );
  }

  async listOutcomes(nodeId: string) {
    await this.getNode(nodeId);
    return this.repository.listOutcomes(nodeId);
  }

  async createOutcome(input: LearningOutcomeCreate) {
    await this.getNode(input.nodeId);
    return this.repository.createOutcome(input);
  }

  async getOutcome(id: string) {
    const outcome = await this.repository.findOutcome(id);
    if (!outcome)
      throw new ClientError(
        'not_found',
        'learning_outcome_not_found',
        'Yêu cầu cần đạt không tồn tại',
      );
    return outcome;
  }

  async updateOutcome(id: string, patch: LearningOutcomePatch) {
    await this.getOutcome(id);
    const outcome = await this.repository.updateOutcome(id, patch);
    if (!outcome)
      throw new ClientError(
        'not_found',
        'learning_outcome_not_found',
        'Yêu cầu cần đạt không tồn tại',
      );
    return outcome;
  }

  async deleteOutcome(id: string) {
    if (!(await this.repository.deleteOutcome(id)))
      throw new ClientError(
        'not_found',
        'learning_outcome_not_found',
        'Yêu cầu cần đạt không tồn tại',
      );
  }

  private async assertValidParent(parentId: string, curriculumId: string) {
    const parent = await this.repository.findNode(parentId);
    if (!parent)
      throw new ClientError('invalid', 'curriculum_parent_invalid', 'Parent node không tồn tại');
    if (parent.curriculumId !== curriculumId) {
      throw new ClientError(
        'invalid',
        'curriculum_parent_invalid',
        'Parent node phải thuộc cùng chương trình',
      );
    }
  }
}
