import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { HealthStatus } from '@giaokhoa/contracts';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { Public } from '../../common/public.decorator';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
/**
 * API kiểm tra sức khoẻ (không cần xác thực).
 */
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOkResponse({ description: 'Service health (database + redis checks)' })
  @ApiServiceUnavailableResponse({ description: 'Database hoặc Redis không sẵn sàng' })
  /**
   * GET /health — trạng thái API, DB và Redis.
   */
  async getHealth(@Res({ passthrough: true }) response: Response): Promise<HealthStatus> {
    const status = await this.health.check();
    // Để Docker healthcheck và gateway phát hiện suy giảm phụ thuộc qua HTTP.
    response.status(status.status === 'ok' ? 200 : 503);
    return status;
  }
}
