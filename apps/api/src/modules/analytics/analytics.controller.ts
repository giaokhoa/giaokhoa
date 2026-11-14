import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { runAnalyticsModelSchema, type RunModelDto } from './dto/analytics.dto';

@ApiTags('analytics')
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Get('models')
  async models() { return this.analytics.listModels(); }
  @Get('indicators')
  async indicators() { return this.analytics.listIndicators(); }
  @Post('models/:name/run')
  async run(@Param('name', { schema: z.string().trim().min(1) }) name: string, @Body({ schema: runAnalyticsModelSchema }) dto: RunModelDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analytics.runModel(actor.id, name, dto.courseId);
  }
  @Get('insights/me')
  async myInsights(@CurrentUser() actor: AuthenticatedUser) { return this.analytics.listInsightsFor(actor.id); }
  @Get('insights')
  async allInsights(@CurrentUser() actor: AuthenticatedUser) { return this.analytics.listAllInsights(actor.id); }
}
