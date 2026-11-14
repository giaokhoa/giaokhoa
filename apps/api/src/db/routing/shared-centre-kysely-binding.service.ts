import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createCentreKysely } from '@giaokhoa/db';
import { SpaceDatabaseService } from './space-database.service';
import { TenantAwarePool } from '../tenant-pool';

export const SHARED_CENTRE_KYSELY = 'SHARED_CENTRE_KYSELY';

@Injectable()
export class SharedCentreKyselyBinding implements OnModuleInit {
  constructor(
    @Inject(SHARED_CENTRE_KYSELY) private readonly pool: TenantAwarePool,
    private readonly spaceDatabase: SpaceDatabaseService,
  ) {}

  onModuleInit(): void {
    this.spaceDatabase.bindSharedKysely(createCentreKysely(this.pool), this.pool);
  }
}
