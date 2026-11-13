import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthRepository } from '@giaokhoa/db/repositories/auth';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { CacheInfraModule } from '../../infra/cache/cache-infra.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { PublicRegistrationController } from './public-registration.controller';
import { PublicRegistrationService } from './public-registration.service';
import { BetterAuthModule } from './better-auth/better-auth.module';
import { AuthService } from './auth.service';
import { LoginLockoutService } from './login-lockout.service';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';
import { JwtAuthStrategy, LocalAuthStrategy } from './strategies';

@Module({
  imports: [
    forwardRef(() => UsersModule), AccessModule, TenantsModule, CacheInfraModule, EventsModule, PassportModule, forwardRef(() => BetterAuthModule), SpaceRoutingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule], inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [AuthController, OAuthController, PublicRegistrationController],
  providers: [
    {
      provide: AuthRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new AuthRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    AuthService, PublicRegistrationService, SessionService, TotpService, OAuthService, LoginLockoutService, LocalAuthStrategy, JwtAuthStrategy,
  ],
  exports: [AuthService, SessionService, LoginLockoutService, AuthRepository, TotpService],
})
export class AuthModule {}
