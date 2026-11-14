import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { Public } from '../../common/public.decorator';
import { CalendarService, EVENT_TYPES } from './calendar.service';
import { calendarRemindSchema, createCalendarEventSchema, createCalendarExceptionSchema, createCalendarSubscriptionSchema, type CreateEventDto, type CreateExceptionDto, type CreateSubscriptionDto, type RemindDto } from './dto/calendar.dto';

const calendarDateQuerySchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]).optional();

const calendarEventTypeQuerySchema = z.enum(EVENT_TYPES).optional();

@ApiTags('calendar')
@Controller({ path: 'calendar', version: '1' })
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  private sendIcs(res: Response, ics: string): void {
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
    res.send(ics);
  }

  @Post('events')
  async create(@Body({ schema: createCalendarEventSchema }) dto: CreateEventDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.createEvent(actor.id, dto);
  }
  @Get('events')
  async list(@Query('from', { schema: calendarDateQuerySchema }) from: string | undefined, @Query('to', { schema: calendarDateQuerySchema }) to: string | undefined,
    @Query('eventType', { schema: calendarEventTypeQuerySchema }) eventType: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.listEventsForUser(actor.id, { from, to, eventType });
  }
  @Get('exports')
  async exportMine(@Query('from', { schema: calendarDateQuerySchema }) from: string | undefined, @Query('to', { schema: calendarDateQuerySchema }) to: string | undefined,
    @Query('eventType', { schema: calendarEventTypeQuerySchema }) eventType: string | undefined, @Query('format', { schema: z.string().trim().min(1).optional() }) format: string | undefined,
    @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    if (format !== undefined && format !== 'ics') {
      throw new BadRequestException({ message: `Unsupported calendar export format: ${format}`, code: 'calendar.export_format_unsupported' });
    }
    this.sendIcs(res, await this.calendar.exportIcsForUser(actor.id, { from, to, eventType }));
  }
  @Get('export.ics')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async exportMineAlias(@Query('from', { schema: calendarDateQuerySchema }) from: string | undefined, @Query('to', { schema: calendarDateQuerySchema }) to: string | undefined,
    @Query('eventType', { schema: calendarEventTypeQuerySchema }) eventType: string | undefined, @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    return this.exportMine(from, to, eventType, 'ics', actor, res);
  }
  @Post('export-token')
  async createExportToken(@CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.createOrRotateExportToken(actor.id);
  }
  @Get('export-token')
  async exportTokenStatus(@CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.getExportTokenStatus(actor.id);
  }
  @Delete('export-token')
  async revokeExportToken(@CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.revokeExportToken(actor.id);
  }
  @Public()
  @Get('export/:filename')
  async exportByToken(@Param('filename', { schema: z.string().trim().min(1) }) fileName: string, @Query('from', { schema: calendarDateQuerySchema }) from: string | undefined,
    @Query('to', { schema: calendarDateQuerySchema }) to: string | undefined, @Query('eventType', { schema: calendarEventTypeQuerySchema }) eventType: string | undefined, @Res() res: Response) {
    const token = fileName.endsWith('.ics') ? fileName.slice(0, -'.ics'.length) : fileName;
    this.sendIcs(res, await this.calendar.exportIcsByToken(token, { from, to, eventType }));
  }
  @Get('events/:id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    const event = await this.calendar.getEvent(id);
    return { ...event, visibleToMe: await this.calendar.isVisibleTo(event, actor.id) };
  }
  @Post('events/:id/exception')
  async exception(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: createCalendarExceptionSchema }) dto: CreateExceptionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.createException(actor.id, id, dto);
  }
  @Post('events/:id/remind')
  async remind(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: calendarRemindSchema }) dto: RemindDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.scheduleReminder(actor.id, id, dto.minutesBefore);
  }
  @Delete('events/:id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.deleteEvent(actor.id, id);
  }
  @Post('subscriptions')
  async createSubscription(@Body({ schema: createCalendarSubscriptionSchema }) dto: CreateSubscriptionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.createSubscription(actor.id, dto);
  }
  @Get('subscriptions')
  async listSubscriptions(@CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.listSubscriptions(actor.id);
  }
  @Post('subscriptions/:id/import')
  async importNow(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.requestImport(actor.id, id);
  }
}
