import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { CentreDb } from '@giaokhoa/db';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { tenantAls } from '../../db/tenant-als';
import { EventLogWriter } from './event-log-writer.service';
import { OutboxService } from './outbox.service';

/**
 * Hàm phân giải handle Kysely theo ngữ cảnh cho các đường ghi KHÔNG mang transaction của phía gọi (standalone của outbox, writer event log): ngữ cảnh mang slug thì chuẩn bị phía Kysely cho đúng slug đó qua `getKyselyForSpace` (hàm chuẩn bị không tác dụng phụ khi đã chuẩn bị — trả đúng handle đã chốt), ngữ cảnh không mang slug thì dùng facade định tuyến (kho chung). Lý do phải chuẩn bị tường minh: facade Kysely fail-closed cho trung tâm kho riêng chưa được chuẩn bị trong phiên, và các đường ghi không mang transaction không đi qua bước chuẩn bị của tầng gắn ngữ cảnh.
 */
function spaceKyselyResolver(spaceDb: SpaceDatabaseService): () => Promise<CentreDb> {
  return async () => {
    const slug = tenantAls.getStore()?.spaceSlug;
    return slug ? spaceDb.getKyselyForSpace(slug) : spaceDb.routedKysely;
  };
}

/**
 * Provider dùng chung cho OutboxService và EventLogWriter: cả hai đều
 * nhận handle Kysely kho trung tâm + hàm phân giải handle theo ngữ cảnh
 * cho các đường ghi không mang transaction của phía gọi — cùng khuôn
 * useFactory, chỉ khác class.
 */
function spaceDbProvider<T>(token: new (db: CentreDb, resolve: () => Promise<CentreDb>) => T) {
  return {
    provide: token,
    useFactory: (spaceDb: SpaceDatabaseService) => new token(spaceDb.routedKysely, spaceKyselyResolver(spaceDb)),
    inject: [SpaceDatabaseService],
  };
}

/**
 * Module hạ tầng sự kiện: outbox giao dịch và writer phản chiếu event log. Sau chuyển đổi Kysely (D1, issue #653) cả hai service nhận handle Kysely kho trung tâm qua factory trên facade định tuyến theo không gian (`SpaceDatabaseService.routedKysely`) — cùng khuôn lắp repository của các module đã chuyển — kèm hàm phân giải handle theo ngữ cảnh cho các đường ghi không mang transaction của phía gọi (xem `spaceKyselyResolver`). Cạnh
 * import SpaceRoutingModule trực tiếp vì adapter kết nối control plane
 * đã được tách khỏi facade quản trị, không còn vòng module này.
 */
@Module({
  imports: [EventEmitterModule.forRoot(), SpaceRoutingModule],
  providers: [spaceDbProvider(OutboxService), spaceDbProvider(EventLogWriter)],
  exports: [OutboxService, EventLogWriter],
})
export class EventsModule {}
