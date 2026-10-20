import { ExamsService } from '@giaokhoa/application/exams/service';
import type {
  Exam,
  ExamCreate,
  ExamPatch,
  ExamRevision,
  ExamRevisionCreate,
  ExamRevisionSummary,
} from '@giaokhoa/shared/exams';
import { examsContract } from '@giaokhoa/shared/http/exams';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller('exams')
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  /** Giáo viên tạo đề gốc để lưu các phiên bản câu hỏi được chốt về sau. */
  @Post()
  async create(
    @Body({ schema: examsContract.create.body }) body: ExamCreate,
    @Session() session: UserSession,
  ): Promise<Exam> {
    return examsContract.create.responses[201].parse(
      await this.exams.createExam(session.user.id, body),
    );
  }

  /** Liệt kê những đề do chính giáo viên hiện tại tạo. */
  @Get()
  async list(@Session() session: UserSession): Promise<Exam[]> {
    return examsContract.list.responses[200].parse(await this.exams.listExams(session.user.id));
  }

  /** Lấy thông tin một đề do người dùng sở hữu, không trả câu hỏi của phiên bản. */
  @Get(':id')
  async get(
    @Param('id', { schema: examsContract.get.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<Exam> {
    return examsContract.get.responses[200].parse(await this.exams.getExam(session.user.id, id));
  }

  /** Người sở hữu đổi thông tin đề gốc mà không sửa những revision đã chốt. */
  @Patch(':id')
  async update(
    @Param('id', { schema: examsContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: examsContract.update.body }) body: ExamPatch,
    @Session() session: UserSession,
  ): Promise<Exam> {
    return examsContract.update.responses[200].parse(
      await this.exams.updateExam(session.user.id, id, body),
    );
  }

  /** Chốt một revision bất biến từ những câu hỏi ready thuộc ngân hàng của giáo viên. */
  @Post(':id/revisions')
  async createRevision(
    @Param('id', { schema: examsContract.createRevision.pathParams.shape.id }) id: string,
    @Body({ schema: examsContract.createRevision.body }) body: ExamRevisionCreate,
    @Session() session: UserSession,
  ): Promise<ExamRevision> {
    return examsContract.createRevision.responses[201].parse(
      await this.exams.createRevision(session.user.id, id, body),
    );
  }

  /** Liệt kê số revision và thông tin tóm tắt của đề mà người dùng sở hữu. */
  @Get(':id/revisions')
  async listRevisions(
    @Param('id', { schema: examsContract.listRevisions.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<ExamRevisionSummary[]> {
    return examsContract.listRevisions.responses[200].parse(
      await this.exams.listRevisions(session.user.id, id),
    );
  }

  /** Chủ đề xem snapshot đầy đủ của revision cụ thể, gồm nội dung câu hỏi để soạn và kiểm tra. */
  @Get(':id/revisions/:revision')
  async getRevision(
    @Param('id', { schema: examsContract.getRevision.pathParams.shape.id }) id: string,
    @Param('revision', { schema: examsContract.getRevision.pathParams.shape.revision })
    revision: number,
    @Session() session: UserSession,
  ): Promise<ExamRevision> {
    return examsContract.getRevision.responses[200].parse(
      await this.exams.getRevision(session.user.id, id, revision),
    );
  }
}
