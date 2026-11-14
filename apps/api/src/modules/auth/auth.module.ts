import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { CacheInfraModule } from '../../infra/cache/cache-infra.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { AuthSharedModule } from '../auth-shared/auth-shared.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { PublicRegistrationController } from './public-registration.controller';
import { PublicRegistrationService } from './public-registration.service';
import { BetterAuthModule } from './better-auth/better-auth.module';
import { AuthService } from './auth.service';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { JwtAuthStrategy, LocalAuthStrategy } from './strategies';

@Module({
  imports: [
    UsersModule, AccessModule, TenantsModule, CacheInfraModule, EventsModule, PassportModule, BetterAuthModule, SpaceRoutingModule, AuthSharedModule,
    JwtModule.registerAsync({
      imports: [ConfigModule], inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [AuthController, OAuthController, PublicRegistrationController],
  providers: [
    AuthService, PublicRegistrationService, OAuthService, LocalAuthStrategy, JwtAuthStrategy,
  ],
  exports: [AuthService, AuthSharedModule, JwtModule],
})
export class AuthModule {}
