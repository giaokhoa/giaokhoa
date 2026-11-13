/**
 * Module quyền hỗ trợ của issue #19: tầng quản trị trung tâm và tầng
 * vận hành platform dùng chung service nhưng tách controller/audience.
 * Repository chỉ lấy Kysely từ khung định tuyến, không mở pool riêng.
 */
import { Module } from "@nestjs/common";
import { SupportGrantsRepository } from "@giaokhoa/db/repositories/support-grants";
import { SpaceRoutingModule } from "../../db/routing/space-routing.module";
import { SpaceDatabaseService } from "../../db/routing/space-database.service";
import { AccessModule } from "../access/access.module";
import { TenantsModule } from "../tenants/tenants.module";
import { UsersModule } from "../users/users.module";
import {
  SupportCentresController,
  SupportGrantsController,
} from "./support.controller";
import { SupportService } from "./support.service";

/** Đăng ký hai controller và dependency của service; không xuất quyền. */
@Module({
  imports: [SpaceRoutingModule, AccessModule, TenantsModule, UsersModule],
  controllers: [SupportGrantsController, SupportCentresController],
  providers: [
    {
      provide: SupportGrantsRepository,
      useFactory: (spaceDb: SpaceDatabaseService) =>
        new SupportGrantsRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    SupportService,
  ],
})
export class SupportModule {}
