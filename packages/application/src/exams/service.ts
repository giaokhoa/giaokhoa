import { examRevisionCreateSchema } from '@giaokhoa/shared/exams';
import type {
  Exam,
  ExamCreate,
  ExamPatch,
  ExamRevision,
  ExamRevisionCreate,
  ExamRevisionSummary,
} from '@giaokhoa/shared/exams';
import type { AuthorizationService } from '../authorization/service.js';
import { ClientError } from '../common/client-error.js';
import type { ExamsRepository } from './repository.js';

/** Quản lý đề riêng của tác giả và các bản chụp phiên bản đề không phụ thuộc chỉnh sửa về sau. */
export class ExamsService {
  constructor(
    private readonly repository: ExamsRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  private assertCapability(actorId: string, capability: 'exam:create_own' | 'exam:manage_own') {
    return this.authorization.assertAuthorized({
      actorId,
      capability,
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
  }

  async createExam(actorId: string, input: ExamCreate): Promise<Exam> {
    await this.assertCapability(actorId, 'exam:create_own');
    return this.repository.create(actorId, input);
  }

  async listExams(actorId: string): Promise<Exam[]> {
    await this.assertCapability(actorId, 'exam:manage_own');
    return this.repository.listOwned(actorId);
  }

  async getExam(actorId: string, id: string): Promise<Exam> {
    await this.assertCapability(actorId, 'exam:manage_own');
    const exam = await this.repository.findOwned(id, actorId);
    if (!exam) throw new ClientError('not_found', 'exam_not_found', 'Đề thi không tồn tại');
    return exam;
  }

  async updateExam(actorId: string, id: string, input: ExamPatch): Promise<Exam> {
    await this.assertCapability(actorId, 'exam:manage_own');
    const exam = await this.repository.updateOwned(id, actorId, input);
    if (!exam) throw new ClientError('not_found', 'exam_not_found', 'Đề thi không tồn tại');
    return exam;
  }

  /**
   * Chỉ tạo phiên bản đề từ câu hỏi hợp lệ; kho dữ liệu kiểm tra quyền sở hữu
   * và lưu bản chụp nội dung. Bài đã giao dùng bản chụp cũ dù câu hỏi gốc thay đổi.
   */
  async createRevision(
    actorId: string,
    id: string,
    input: ExamRevisionCreate,
  ): Promise<ExamRevision> {
    await this.assertCapability(actorId, 'exam:manage_own');
    const parsed = examRevisionCreateSchema.safeParse(input);
    if (!parsed.success)
      throw new ClientError(
        'invalid',
        'exam_revision_invalid',
        'Danh sách câu hỏi không hợp lệ',
        parsed.error.issues,
      );
    const created = await this.repository.createRevision(id, actorId, parsed.data);
    if (!created) throw new ClientError('not_found', 'exam_not_found', 'Đề thi không tồn tại');
    return created;
  }

  async listRevisions(actorId: string, id: string): Promise<ExamRevisionSummary[]> {
    await this.assertCapability(actorId, 'exam:manage_own');
    const revisions = await this.repository.listRevisions(id, actorId);
    if (!revisions) throw new ClientError('not_found', 'exam_not_found', 'Đề thi không tồn tại');
    return revisions;
  }

  async getRevision(actorId: string, id: string, revision: number): Promise<ExamRevision> {
    await this.assertCapability(actorId, 'exam:manage_own');
    const found = await this.repository.findRevision(id, revision, actorId);
    if (!found)
      throw new ClientError(
        'not_found',
        'exam_revision_not_found',
        'Phiên bản đề thi không tồn tại',
      );
    return found;
  }
}
