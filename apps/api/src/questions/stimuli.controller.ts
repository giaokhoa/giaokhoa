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

@Controller('stimuli')
export class StimuliController {
  constructor(private readonly questions: QuestionsService) {}

  @Post()
  async create(
    @Body({ schema: stimuliContract.create.body }) body: StimulusCreate,
  ): Promise<Stimulus> {
    return stimuliContract.create.responses[201].parse(await this.questions.createStimulus(body));
  }

  @Get(':id')
  async get(
    @Param('id', { schema: stimuliContract.get.pathParams.shape.id }) id: string,
  ): Promise<Stimulus> {
    return stimuliContract.get.responses[200].parse(await this.questions.getStimulus(id));
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: stimuliContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: stimuliContract.update.body }) body: StimulusPatch,
  ): Promise<Stimulus> {
    return stimuliContract.update.responses[200].parse(
      await this.questions.updateStimulus(id, body),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', { schema: stimuliContract.delete.pathParams.shape.id }) id: string) {
    return this.questions.deleteStimulus(id);
  }
}
