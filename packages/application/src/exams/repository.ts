import type {
  Exam,
  ExamCreate,
  ExamPatch,
  ExamRevision,
  ExamRevisionCreate,
  ExamRevisionSummary,
} from '@giaokhoa/shared/exams';

/** Mọi thao tác đọc và sửa đề phải lọc theo người tạo; bản chụp của phiên bản đã tạo là bất biến. */
export interface ExamsRepository {
  create(actorId: string, input: ExamCreate): Promise<Exam>;
  listOwned(actorId: string): Promise<Exam[]>;
  findOwned(id: string, actorId: string): Promise<Exam | undefined>;
  updateOwned(id: string, actorId: string, input: ExamPatch): Promise<Exam | undefined>;
  /** Chốt thứ tự và nội dung từng phiên bản câu hỏi trong cùng giao dịch sau khi xác minh chủ sở hữu. */
  createRevision(
    id: string,
    actorId: string,
    input: ExamRevisionCreate,
  ): Promise<ExamRevision | undefined>;
  listRevisions(id: string, actorId: string): Promise<ExamRevisionSummary[] | undefined>;
  findRevision(id: string, revision: number, actorId: string): Promise<ExamRevision | undefined>;
}
