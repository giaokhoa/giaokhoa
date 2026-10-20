import { QuestionsService } from '@giaokhoa/application/questions/service';
import type { Stimulus, StimulusCreate, StimulusPatch } from '@giaokhoa/shared/questions';
import { stimuliContract } from '@giaokhoa/shared/http/stimuli';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller('stimuli')
export class StimuliController {
  constructor(private readonly questions: QuestionsService) {}

  /** Giáo viên tạo ngữ liệu dùng chung để nhiều câu hỏi của mình tham chiếu. */
  @Post()
  async create(
    @Body({ schema: stimuliContract.create.body }) body: StimulusCreate,
    @Session() session: UserSession,
  ): Promise<Stimulus> {
    return stimuliContract.create.responses[201].parse(
      await this.questions.createStimulus(body, session.user.id),
    );
  }

  /** Chủ ngữ liệu đọc toàn bộ văn bản/hình ảnh để soạn đề; không dành cho học sinh. */
  @Get(':id')
  async get(
    @Param('id', { schema: stimuliContract.get.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<Stimulus> {
    return stimuliContract.get.responses[200].parse(
      await this.questions.getStimulus(id, session.user.id),
    );
  }

  /** Chỉ cho chủ ngữ liệu chỉnh sửa khi chưa có câu hỏi nào tham chiếu. */
  @Patch(':id')
  async update(
    @Param('id', { schema: stimuliContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: stimuliContract.update.body }) body: StimulusPatch,
    @Session() session: UserSession,
  ): Promise<Stimulus> {
    return stimuliContract.update.responses[200].parse(
      await this.questions.updateStimulus(id, body, session.user.id),
    );
  }

  /** Chỉ xóa ngữ liệu riêng chưa được bất kỳ câu hỏi nào sử dụng. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('id', { schema: stimuliContract.delete.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ) {
    return this.questions.deleteStimulus(id, session.user.id);
  }
}
