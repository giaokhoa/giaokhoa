import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { SystemBankService } from './system-bank.service';
import {
  createSystemOutcomePackageSchema,
  rejectSystemOutcomePackageSchema,
  type CreateSystemOutcomePackageDto,
  type RejectSystemOutcomePackageDto,
} from './dto/system-bank.dto';

@Controller({ path: 'system-bank/outcome-packages', version: '1' })
export class SystemBankPackagesController {
  constructor(private readonly bank: SystemBankService) {}

  @Post()
  createPackage(
    @Body({ schema: createSystemOutcomePackageSchema }) dto: CreateSystemOutcomePackageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.createOutcomePackage(actor.id, dto);
  }

  @Get()
  listPackages() {
    return this.bank.listOutcomePackages();
  }

  @Get('mine')
  listMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.bank.listMyOutcomePackages(actor.id);
  }

  @Get('installed')
  listInstalled(@CurrentUser() actor: AuthenticatedUser) {
    return this.bank.listInstalledOutcomePackages(actor.id);
  }

  @Get('pending')
  listPending(@CurrentUser() actor: AuthenticatedUser) {
    return this.bank.listPendingOutcomePackages(actor.id);
  }

  @Get('review/:version')
  getForReview(@Param('version') version: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.bank.getOutcomePackageForReview(actor.id, version);
  }

  @Post(':version/approve')
  approve(@Param('version') version: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.bank.reviewOutcomePackage(actor.id, version, true);
  }

  @Post(':version/reject')
  reject(
    @Param('version') version: string,
    @Body({ schema: rejectSystemOutcomePackageSchema }) dto: RejectSystemOutcomePackageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.reviewOutcomePackage(actor.id, version, false, dto.reason);
  }

  @Get(':version')
  getPackage(@Param('version') version: string) {
    return this.bank.getOutcomePackage(version);
  }

  @Post(':version/install')
  installPackage(@Param('version') version: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.bank.installOutcomePackage(actor.id, version);
  }
}
