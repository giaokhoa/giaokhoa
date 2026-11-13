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
import { SupportRoute } from "../../common/support-route.decorator";
import { SkipSpaceContext } from "../tenants/skip-space-context.decorator";
import { spaceSlugForHost } from "../tenants/space-resolution";
import { SupportService } from "./support.service";

@ApiTags("support-grants")
@Controller({ path: "support-grants", version: "1" })
export class SupportGrantsController {
  constructor(private readonly support: SupportService) {}

  @Post()
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body({ schema: createSupportGrantSchema }) dto: CreateSupportGrant,
  ) {
    return this.support.create(actor.id, dto);
  }

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return this.support.list(actor.id);
  }

  @Get("audit")
  async audit(@CurrentUser() actor: AuthenticatedUser) {
    return this.support.audit(actor.id);
  }

  @Post(":grantId/revoke")
  async revoke(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("grantId", { schema: uuidIdSchema }) id: string,
  ) {
    return this.support.revoke(actor.id, id);
  }
}

@ApiTags("support-centres")
@SupportRoute()
@SkipSpaceContext()
@Controller({ path: "support-centres", version: "1" })
export class SupportCentresController {
  constructor(private readonly support: SupportService) {}

  private assertPlatformHost(host?: string): void {
    if (spaceSlugForHost(host)) {
      throw new ForbiddenException({
        message: "Use the platform root address",
        code: "support.platform_host_required",
      });
    }
  }

  @Get(":slug/my-grants")
  async myGrants(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("slug") slug: string,
    @Headers("host") host: string | undefined,
  ) {
    this.assertPlatformHost(host);
    return this.support.myAccess(actor.id, slug);
  }

  @Get(":slug/classes")
  async classes(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("slug") slug: string,
    @Headers("host") host: string | undefined,
  ) {
    this.assertPlatformHost(host);
    return this.support.access(actor.id, slug, "classes:read");
  }

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
