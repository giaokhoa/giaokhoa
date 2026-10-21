import type {
  Curriculum,
  CurriculumCreate,
  CurriculumNode,
  CurriculumNodeCreate,
  CurriculumNodePatch,
  CurriculumPatch,
  LearningOutcome,
  LearningOutcomeCreate,
  LearningOutcomePatch,
  Subject,
  SubjectCreate,
  SubjectPatch,
} from '@giaokhoa/shared/curriculum';

/** Trả trạng thái tường minh cho thao tác đổi cây để dịch vụ ánh xạ đúng lỗi nghiệp vụ. */
export type UpdateNodeTreeResult =
  | { status: 'updated'; node: CurriculumNode }
  | { status: 'not_found' | 'invalid_parent' | 'cycle' };

/** Duy trì quan hệ môn, chương trình, nút và yêu cầu cần đạt; chuyển lỗi dữ liệu thành lỗi nghiệp vụ. */
export interface CurriculumRepository {
  listSubjects(): Promise<Subject[]>;
  createSubject(data: SubjectCreate): Promise<Subject>;
  findSubject(id: string): Promise<Subject | undefined>;
  updateSubject(id: string, data: SubjectPatch): Promise<Subject | undefined>;
  deleteSubject(id: string): Promise<{ id: string } | undefined>;

  listAllCurricula(): Promise<Curriculum[]>;
  listCurricula(subjectId: string): Promise<Curriculum[]>;
  createCurriculum(data: CurriculumCreate): Promise<Curriculum>;
  findCurriculum(id: string): Promise<Curriculum | undefined>;
  findCurriculumBySubjectAndGrade(
    subjectId: string,
    grade: number,
  ): Promise<Curriculum | undefined>;
  updateCurriculum(id: string, data: CurriculumPatch): Promise<Curriculum | undefined>;
  deleteCurriculum(id: string): Promise<{ id: string } | undefined>;

  listNodes(curriculumId: string): Promise<CurriculumNode[]>;
  createNode(data: CurriculumNodeCreate): Promise<CurriculumNode>;
  findNode(id: string): Promise<CurriculumNode | undefined>;
  updateNode(id: string, data: CurriculumNodePatch): Promise<CurriculumNode | undefined>;
  /** Khóa và kiểm tra cấu trúc cây cùng giao dịch, từ chối cha khác chương trình hoặc tạo chu trình. */
  updateNodeTree(
    id: string,
    data: CurriculumNodePatch & { parentId: string | null },
  ): Promise<UpdateNodeTreeResult>;
  deleteNode(id: string): Promise<{ id: string } | undefined>;

  listOutcomes(nodeId: string): Promise<LearningOutcome[]>;
  createOutcome(data: LearningOutcomeCreate): Promise<LearningOutcome>;
  findOutcome(id: string): Promise<LearningOutcome | undefined>;
  updateOutcome(id: string, data: LearningOutcomePatch): Promise<LearningOutcome | undefined>;
  deleteOutcome(id: string): Promise<{ id: string } | undefined>;
}
