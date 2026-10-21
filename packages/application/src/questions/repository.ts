import type { FileRef } from '@giaokhoa/shared/files';
import type {
  Question,
  QuestionCreate,
  QuestionStatus,
  QuestionVersionSummary,
  Stimulus,
  StimulusCreate,
  StimulusPatch,
} from '@giaokhoa/shared/questions';

/** Bổ sung chủ sở hữu nội bộ phục vụ xác thực; trường này không được trả về trong hợp đồng câu hỏi công khai. */
export type StoredQuestion = Question & { createdByUserId: string };

/** Lưu phiên bản nội dung và vị trí sử dụng tệp nguyên tử, đồng thời kiểm tra quyền sở hữu trong truy vấn ghi. */
export interface QuestionsRepository {
  createQuestion(data: QuestionCreate, refs: FileRef[], userId: string): Promise<StoredQuestion>;
  findQuestion(id: string): Promise<StoredQuestion | undefined>;
  findLatestReadyQuestion(id: string): Promise<StoredQuestion | undefined>;
  findQuestionVersion(id: string, version: number): Promise<StoredQuestion | undefined>;
  listQuestionVersions(id: string): Promise<QuestionVersionSummary[]>;
  findQuestionOwned(id: string, userId: string): Promise<StoredQuestion | undefined>;
  /** Chỉ ghi phiên bản kế tiếp khi phiên bản kỳ vọng còn hiện hành; giữ nội dung phiên bản trước bất biến. */
  createQuestionVersion(
    id: string,
    expectedVersion: number,
    data: QuestionCreate,
    refs: FileRef[],
    userId: string,
  ): Promise<StoredQuestion | undefined>;
  /** Đổi trạng thái không sinh phiên bản nội dung; vẫn phải kiểm tra phiên bản kỳ vọng khi khóa bản ghi. */
  changeQuestionStatus(
    id: string,
    expectedVersion: number,
    status: QuestionStatus,
    userId: string,
  ): Promise<StoredQuestion | undefined>;
  deleteQuestion(id: string, userId: string): Promise<{ id: string } | undefined>;

  createStimulus(data: StimulusCreate, refs: FileRef[], userId: string): Promise<Stimulus>;
  findStimulusOwned(id: string, userId: string): Promise<Stimulus | undefined>;
  /** Giá trị rỗng của refs nghĩa là không thay thế tham chiếu tệp; mảng rỗng nghĩa là nội dung không còn ảnh. */
  updateStimulus(
    id: string,
    data: StimulusPatch,
    refs: FileRef[] | null,
    userId: string,
  ): Promise<Stimulus | undefined>;
  deleteStimulus(id: string, userId: string): Promise<{ id: string } | undefined>;
}
