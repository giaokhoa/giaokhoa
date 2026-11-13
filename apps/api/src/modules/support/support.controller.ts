/**
 * Hai bề mặt HTTP hỗ trợ KHÔNG dùng chung audience:
 * - Trung tâm: phiên nghiệp vụ tại Host của mình, owner có tenant:manage.
 * - Nhân sự nền tảng: phiên platform tại Host gốc, thao tác chỉ-đọc
 *   cố định và grant kiểm trực tiếp ở kho của slug mỗi request.
 * Không cung cấp endpoint login-as hoặc truyền token nghiệp vụ.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createSupportGrantSchema,
  uuidIdSchema,
  type CreateSupportGrant,
} from "@giaokhoa/contracts";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/current-user.decorator";
import { PlatformRoute } from "../../common/platform-route.decorator";
import { SkipSpaceContext } from "../tenants/skip-space-context.decorator";
import { spaceSlugForHost } from "../tenants/space-resolution";
import { SupportService } from "./support.service";

/** Chủ trung tâm quản lý grant của chính tenant hiệu lực. */
@ApiTags("support-grants")
@Controller({ path: "support-grants", version: "1" })
export class SupportGrantsController {
  constructor(private readonly support: SupportService) {}

  /** Cấp grant mới trong 30 ngày, không nhận tenantId từ request. */
  @Post()
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body({ schema: createSupportGrantSchema }) dto: CreateSupportGrant,
  ) {
    return this.support.create(actor.id, dto);
  }

  /** Trạng thái grant của trung tâm; chỉ cấp cho người quản trị. */
  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return this.support.list(actor.id);
  }

  /** Audit cấp/thu hồi/quyết định sử dụng, không mang payload nghiệp vụ. */
  @Get("audit")
  async audit(@CurrentUser() actor: AuthenticatedUser) {
    return this.support.audit(actor.id);
  }

  /** Thu hồi grant trong tenant, từ chối grant đã thu hồi. */
  @Post(":grantId/revoke")
  async revoke(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("grantId", { schema: uuidIdSchema }) id: string,
  ) {
    return this.support.revoke(actor.id, id);
  }
}

/**
 * Bề mặt vận hành chỉ cho token platform, tại Host gốc; bỏ qua ghim
 * Host của kho nghiệp vụ để service tự phân giải đúng slug đã kiểm.
 * AudienceGuard từ chối mọi cookie/JWT nghiệp vụ trước handler.
 */
@ApiTags("support-centres")
@PlatformRoute()
@SkipSpaceContext()
@Controller({ path: "support-centres", version: "1" })
export class SupportCentresController {
  constructor(private readonly support: SupportService) {}

  /**
   * Không cho dùng phiên platform từ Host của một trung tâm khác:
   * đường hỗ trợ chỉ được gọi qua địa chỉ gốc của nền tảng.
   */
  private assertPlatformHost(host?: string): void {
    if (spaceSlugForHost(host)) {
      throw new ForbiddenException({
        message: "Use the platform root address",
        code: "support.platform_host_required",
      });
    }
  }

  /** Metadata grant của chính người nhận, không chứa dữ liệu riêng. */
  @Get(":slug/my-grants")
  async myGrants(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("slug") slug: string,
    @Headers("host") host: string | undefined,
  ) {
    this.assertPlatformHost(host);
    return this.support.myAccess(actor.id, slug);
  }

  /** Đọc danh sách lớp rút gọn, chỉ khi có grant classes:read. */
  @Get(":slug/classes")
  async classes(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("slug") slug: string,
    @Headers("host") host: string | undefined,
  ) {
    this.assertPlatformHost(host);
    return this.support.access(actor.id, slug, "classes:read");
  }

  /** Đọc danh sách khoá học rút gọn, chỉ khi có grant courses:read. */
  @Get(":slug/courses")
  async courses(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("slug") slug: string,
    @Headers("host") host: string | undefined,
  ) {
    this.assertPlatformHost(host);
    return this.support.access(actor.id, slug, "courses:read");
  }
}
