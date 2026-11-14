import { Module } from '@nestjs/common';
import { SpaceRoutingModule } from '../../../db/routing/space-routing.module';
import { MailModule } from '../../mail/mail.module';
import { AuthSharedModule } from '../../auth-shared/auth-shared.module';
import { BetterAuthService } from './better-auth.service';
import { CredentialBridgeService } from './credential-bridge.service';
import { TwoFactorCompletionController } from './two-factor-completion.controller';
import { TwoFactorCompletionService } from './two-factor-completion.service';

@Module({
  imports: [AuthSharedModule, MailModule, SpaceRoutingModule],
  controllers: [TwoFactorCompletionController],
  providers: [BetterAuthService, CredentialBridgeService, TwoFactorCompletionService],
  exports: [BetterAuthService, CredentialBridgeService],
})
export class BetterAuthModule {}
