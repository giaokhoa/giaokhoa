/**
 * HTTP gói chương trình: trung tâm gửi bản chụp, biên tập viên duyệt
 * hoặc từ chối, trung tâm cài đúng phiên bản đã công bố vào kho riêng.
 * Chỉ danh sách phát hành được công khai cho mọi trung tâm.
 */
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

  /** Trung tâm gửi ảnh chụp vào hàng chờ, chưa được công bố. */
  @Post()
  createPackage(
    @Body({ schema: createSystemOutcomePackageSchema }) dto: CreateSystemOutcomePackageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.createOutcomePackage(actor.id, dto);
  }

  /** Danh sách đã công bố, không lộ gói chờ/từ chối. */
  @Get()
  listPackages() {
    return this.bank.listOutcomePackages();
  }

  /** Lịch sử gói đã gửi của trung tâm hiện tại. */
  @Get('mine')
  listMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.bank.listMyOutcomePackages(actor.id);
  }

  /** Trung tâm tra cứu phiên bản đã cài trong kho riêng của mình. */
  @Get('installed')
  listInstalled(@CurrentUser() actor: AuthenticatedUser) {
    return this.bank.listInstalledOutcomePackages(actor.id);
  }

  /** Hàng chờ của biên tập viên hệ thống. */
  @Get('pending')
  listPending(@CurrentUser() actor: AuthenticatedUser) {
    return this.bank.listPendingOutcomePackages(actor.id);
  }

  /** Bản gửi đầy đủ để kiểm duyệt. */
  @Get('review/:version')
  getForReview(@Param('version') version: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.bank.getOutcomePackageForReview(actor.id, version);
  }

  /** Phát hành phiên bản bất biến sau khi đối chiếu toàn vẹn. */
  @Post(':version/approve')
  approve(@Param('version') version: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.bank.reviewOutcomePackage(actor.id, version, true);
  }

  /** Từ chối bản gửi kèm lý do; không được khám phá/cài đặt. */
  @Post(':version/reject')
  reject(
    @Param('version') version: string,
    @Body({ schema: rejectSystemOutcomePackageSchema }) dto: RejectSystemOutcomePackageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bank.reviewOutcomePackage(actor.id, version, false, dto.reason);
  }

  /** Chỉ đọc bản đã công bố. */
  @Get(':version')
  getPackage(@Param('version') version: string) {
    return this.bank.getOutcomePackage(version);
  }

  /** Cài nguyên tử sau khi đã duyệt và kiểm tra checksum. */
  @Post(':version/install')
  installPackage(@Param('version') version: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.bank.installOutcomePackage(actor.id, version);
  }
}
