import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { z } from 'zod';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { SystemBankService } from './system-bank.service';
import {
  createSystemBankQuestionSchema,
  createSystemBankVersionSchema,
  withdrawSystemBankQuestionSchema,
  type CreateSystemBankQuestionDto,
  type CreateSystemBankVersionDto,
  type WithdrawSystemBankQuestionDto,
} from './dto/system-bank.dto';

@Controller({ path: 'system-bank/questions', version: '1' })
export class SystemBankController {
  constructor(private readonly bank: SystemBankService) {}

  @Post()
  async publish(
    @Body({ schema: createSystemBankQuestionSchema }) dto: CreateSystemBankQuestionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.publishQuestion(actor.id, dto);
  }

  @Post(':id/versions')
  async publishVersion(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: createSystemBankVersionSchema }) dto: CreateSystemBankVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.publishVersion(actor.id, id, dto);
  }

  @Post(':id/withdraw')
  async withdraw(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Body({ schema: withdrawSystemBankQuestionSchema }) dto: WithdrawSystemBankQuestionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.withdrawQuestion(actor.id, id, dto);
  }

  @Get(':id')
  async getQuestion(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.getQuestion(actor.id, id);
  }

  @Get(':id/versions')
  async listVersions(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.listVersions(actor.id, id);
  }

  @Get(':id/versions/:version')
  async getVersion(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Param('version', { schema: z.coerce.number().int().positive() }) version: number,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.getVersion(actor.id, id, version);
  }
}
