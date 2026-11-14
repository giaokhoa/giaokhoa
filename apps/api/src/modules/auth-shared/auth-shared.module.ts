import { Module } from '@nestjs/common';
import { AuthRepository } from '@giaokhoa/db/repositories/auth';
import { UsersRepository } from '@giaokhoa/db/repositories/users';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { CacheInfraModule } from '../../infra/cache/cache-infra.module';
import { LoginLockoutService } from '../auth/login-lockout.service';
import { SessionService } from '../auth/session.service';
import { TotpService } from '../auth/totp.service';
import { PasswordService } from '../users/password.service';

@Module({
  imports: [SpaceRoutingModule, CacheInfraModule],
  providers: [
    {
      provide: UsersRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new UsersRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    {
      provide: AuthRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new AuthRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    PasswordService,
    SessionService,
    TotpService,
    LoginLockoutService,
  ],
  exports: [UsersRepository, AuthRepository, PasswordService, SessionService, TotpService, LoginLockoutService],
})
export class AuthSharedModule {}
