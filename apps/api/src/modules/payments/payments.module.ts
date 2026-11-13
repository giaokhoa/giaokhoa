import { Module } from '@nestjs/common';
import {
  PaymentsRepository,
  PlanEntitlementsService,
} from '@giaokhoa/payments';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { ClassesModule } from '../classes/classes.module';
import { EnrolModule } from '../enrol/enrol.module';
import { SiteConfigModule } from '../site-config/site-config.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PaymentsController } from './payments.controller';
import { ManualPaymentGateway, PAYMENT_GATEWAY, PaymentsService } from './payments.service';

@Module({
  imports: [AccessModule, EnrolModule, EventsModule, TenantsModule, ClassesModule, SiteConfigModule, SpaceRoutingModule],
  controllers: [PaymentsController],
  providers: [
    {
      provide: PaymentsRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new PaymentsRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    PaymentsService, ManualPaymentGateway, PlanEntitlementsService,
    { provide: PAYMENT_GATEWAY, useClass: ManualPaymentGateway },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
