import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { listEventLogsQueryServerSchema, type ListEventLogsQueryDto } from './dto/event-log.dto';
import { EventLogService } from './event-log.service';

@ApiTags('event-logs')
@Controller({ path: 'event-logs', version: '1' })
export class EventLogController {
  constructor(private readonly eventLog: EventLogService) {}

  @Get()
  async list(@Query({ schema: listEventLogsQueryServerSchema }) query: ListEventLogsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.eventLog.listLogs(actor.id, query);
  }
}
