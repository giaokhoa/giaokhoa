import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import {
  dashboardOverviewQuerySchema,
  upsertCourseCardPrefSchema,
  type DashboardOverviewQueryDto,
  type UpsertCourseCardPrefDto,
} from './dto/dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  async overview(
    @Query({ schema: dashboardOverviewQuerySchema }) query: DashboardOverviewQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.dashboard.getOverview(actor.id, query.days);
  }

  @Get('course-cards')
  async courseCards(@CurrentUser() actor: AuthenticatedUser) {
    return { prefs: await this.dashboard.listCourseCards(actor.id) };
  }

  @Put('course-cards/:courseId')
  async upsertCourseCard(
    @Param('courseId', { schema: uuidIdSchema }) courseId: string,
    @Body({ schema: upsertCourseCardPrefSchema }) dto: UpsertCourseCardPrefDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.dashboard.upsertCourseCard(actor.id, courseId, dto);
  }
}
