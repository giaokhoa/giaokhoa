import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { SystemBankService } from './system-bank.service';
import {
  discoverSystemBankQuestionsSchema,
  importSystemBankQuestionSchema,
  type DiscoverSystemBankQuestionsDto,
  type ImportSystemBankQuestionDto,
} from './dto/system-bank.dto';

@Controller({ path: 'system-bank', version: '1' })
export class SystemBankDiscoveryController {
  constructor(private readonly bank: SystemBankService) {}

  @Get('discovery')
  async discover(@Query({ schema: discoverSystemBankQuestionsSchema }) query: DiscoverSystemBankQuestionsDto) {
    return this.bank.discover(query);
  }

  @Post('import')
  async importQuestion(
    @Body({ schema: importSystemBankQuestionSchema }) dto: ImportSystemBankQuestionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.importSystemQuestion(actor.id, dto);
  }

  @Get('imports')
  async listUsedQuestionVersions(@CurrentUser() actor: AuthenticatedUser) {
    return this.bank.listUsedQuestionVersions(actor.id);
  }

  @Get('imports/:id')
  async getUsedQuestionVersion(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.getUsedQuestionVersion(actor.id, id);
  }

  @Get('events/pending')
  async listPendingEvents(@CurrentUser() actor: AuthenticatedUser) {
    return this.bank.listPendingEvents(actor.id);
  }

  @Post('events/:id/acknowledge')
  async acknowledgeEvent(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.acknowledgeEvent(actor.id, id);
  }
}
