import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AvailabilityService } from './availability.service';

@Module({
  imports: [UsersModule],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
