import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Sse, UseInterceptors, type MessageEvent } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { MessagingService } from './messaging.service';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { bulkRemoveMessagesSchema, createConversationSchema, createGroupConversationSchema, hardDeleteMessageSchema, listConversationsQueryServerSchema, listCourseRosterQueryServerSchema, listMessagesQueryServerSchema, listNotificationGroupsQueryServerSchema, listNotificationItemsQueryServerSchema, markNotificationsReadSchema, notifyUserSchema, readNotificationGroupSchema, reportConversationSchema, searchMessagesQueryServerSchema, sendMessageSchema, setNotificationCourseOverrideSchema, setNotificationPreferenceSchema, updateConversationSchema, updateConversationStateSchema, updateReportStatusSchema, type BulkRemoveMessagesDto, type CreateConversationDto, type CreateGroupConversationDto, type HardDeleteMessageDto, type ListConversationsQueryDto, type ListCourseRosterQueryDto, type ListMessagesQueryDto, type ListNotificationGroupsQueryDto, type ListNotificationItemsQueryDto, type MarkNotificationsReadDto, type NotifyDto, type ReadNotificationGroupDto, type ReportConversationDto, type SearchMessagesQueryDto, type SendMessageDto, type SetCourseOverrideDto, type SetPreferenceDto, type UpdateConversationDto, type UpdateConversationStateDto, type UpdateReportStatusDto } from './dto/messaging.dto';

@ApiTags('messaging')
@Controller({ path: 'messages', version: '1' })
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post('conversations')
  async createConversation(@Body({ schema: createConversationSchema }) dto: CreateConversationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.createConversation(actor.id, dto);
  }
  @Post('conversations/group')
  async createGroupConversation(@Body({ schema: createGroupConversationSchema }) dto: CreateGroupConversationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.createGroupConversation(actor.id, dto);
  }
  @Get('conversations')
  async listConversations(@Query({ schema: listConversationsQueryServerSchema }) query: ListConversationsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.listConversations(actor.id, { archivedOnly: query.archived });
  }
  @Get('users/:id/profile')
  async getPersonProfile(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.getPersonProfile(actor.id, id);
  }
  @Patch('conversations/:id/state')
  async updateConversationState(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateConversationStateSchema }) dto: UpdateConversationStateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.updateConversationState(actor.id, id, dto);
  }
  @Get('conversations/:id')
  async getConversation(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.getConversation(actor.id, id);
  }
  @Get('conversations/:id/messages')
  async listMessages(@Param('id', { schema: uuidIdSchema }) id: string, @Query({ schema: listMessagesQueryServerSchema }) query: ListMessagesQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.listConversationMessages(actor.id, id, query);
  }
  @Get('conversations/:id/search')
  async searchMessages(@Param('id', { schema: uuidIdSchema }) id: string, @Query({ schema: searchMessagesQueryServerSchema }) query: SearchMessagesQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.searchConversationMessages(actor.id, id, query);
  }
  @Post('conversations/:id/messages')
  async send(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: sendMessageSchema }) dto: SendMessageDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.sendMessage(actor.id, id, dto);
  }
  @Post('conversations/:id/read')
  async markRead(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.markConversationRead(actor.id, id);
  }
  @Patch('conversations/:id')
  async updateConversation(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateConversationSchema }) dto: UpdateConversationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.updateConversation(actor.id, id, dto);
  }
  @Delete('conversations/:id/members/:userId')
  async removeConversationMember(
    @Param('id', { schema: uuidIdSchema }) id: string,
    @Param('userId', { schema: uuidIdSchema }) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.removeConversationMember(actor.id, id, userId);
  }
  @Post('conversations/:id/report')
  async reportConversation(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: reportConversationSchema }) dto: ReportConversationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.reportConversation(actor.id, id, dto.reason);
  }
  @Get('reports')
  async listReports(@CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.listReports(actor.id);
  }
  @Get('reports/:reportId/conversation')
  async getReportConversation(@Param('reportId', { schema: uuidIdSchema }) reportId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.getReportConversation(actor.id, reportId);
  }
  @Patch('reports/:reportId')
  async updateReportStatus(@Param('reportId', { schema: uuidIdSchema }) reportId: string, @Body({ schema: updateReportStatusSchema }) dto: UpdateReportStatusDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.updateReportStatus(actor.id, reportId, dto.status);
  }
  @Post('bulk-remove')
  async bulkRemoveMessages(@Body({ schema: bulkRemoveMessagesSchema }) dto: BulkRemoveMessagesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.bulkRemoveMessages(actor.id, dto);
  }
  @Patch(':id')
  async updateMessage() { return this.messaging.updateMessage(); }
  @Delete(':id')
  async deleteMessage(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.deleteMessage(actor.id, id);
  }
  @Post(':id/recall')
  async recallMessage(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.recallMessage(actor.id, id);
  }
  @Post(':id/hard-delete')
  async hardDeleteMessage(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: hardDeleteMessageSchema }) dto: HardDeleteMessageDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.hardDeleteMessage(actor.id, id, dto);
  }

  @Get('unread-count')
  async unread(@CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.unreadCounts(actor.id);
  }
  @Get('preferences')
  async preferences(@CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.getPreferences(actor.id);
  }
  @Put('preferences')
  async setPreference(@Body({ schema: setNotificationPreferenceSchema }) dto: SetPreferenceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.setPreference(actor.id, dto);
  }
  @Get('preferences/courses')
  async courseOverrides(@CurrentUser() actor: AuthenticatedUser) {
    return { courses: await this.messaging.listCourseNotificationOverrides(actor.id) };
  }
  @Put('preferences/courses')
  async setCourseOverride(@Body({ schema: setNotificationCourseOverrideSchema }) dto: SetCourseOverrideDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.setCourseNotificationOverride(actor.id, dto);
  }
  @Get('group-tree')
  async groupTree(@CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.getGroupTree(actor.id);
  }
  @Get('classes/:classId/members')
  async classRoster(
    @Param('classId', { schema: uuidIdSchema }) classId: string,
    @Query({ schema: listCourseRosterQueryServerSchema }) query: ListCourseRosterQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.listClassRoster(actor.id, classId, query);
  }
  @Get('classes/:classId/conversation')
  async classConversation(
    @Param('classId', { schema: uuidIdSchema }) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.ensureClassConversation(actor.id, classId);
  }
  @Get('courses')
  async myCourses(@CurrentUser() actor: AuthenticatedUser) {
    return { courses: await this.messaging.listMyMessagingCourses(actor.id) };
  }
  @Get('courses/:courseId/members')
  async courseRoster(
    @Param('courseId', { schema: uuidIdSchema }) courseId: string,
    @Query({ schema: listCourseRosterQueryServerSchema }) query: ListCourseRosterQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.listCourseRoster(actor.id, courseId, query);
  }
  @Get('courses/:courseId/conversation')
  async courseConversation(
    @Param('courseId', { schema: uuidIdSchema }) courseId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.ensureCourseConversation(actor.id, courseId);
  }
  @Get('contacts')
  async contacts(@CurrentUser() actor: AuthenticatedUser) {
    const contacts = await this.messaging.listContacts(actor.id);
    return { contacts, profiles: await this.messaging.profilesFor(contacts) };
  }
  @Get('contacts/requests')
  async contactRequests(@CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.listContactRequests(actor.id);
  }
  @Post('contacts/requests/:userId/accept')
  async acceptContactRequest(@Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.acceptContactRequest(actor.id, userId);
  }
  @Post('contacts/requests/:userId/decline')
  async declineContactRequest(@Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.declineContactRequest(actor.id, userId);
  }
  @Post('contacts/:userId')
  async requestContact(@Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.requestContact(actor.id, userId);
  }
  @Delete('contacts/:userId')
  async removeContact(@Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.removeContact(actor.id, userId);
  }
  @Get('contacts/blocked')
  async blocked(@CurrentUser() actor: AuthenticatedUser) {
    const blocked = await this.messaging.listBlocked(actor.id);
    return { blocked, profiles: await this.messaging.profilesFor(blocked) };
  }
  @Post('contacts/:userId/block')
  async block(@Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.blockContact(actor.id, userId);
  }
  @Delete('contacts/:userId/block')
  async unblock(@Param('userId', { schema: uuidIdSchema }) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.unblockContact(actor.id, userId);
  }

  @Post('messages/bulk-remove')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async bulkRemoveMessagesAlias(@Body({ schema: bulkRemoveMessagesSchema }) dto: BulkRemoveMessagesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.bulkRemoveMessages(actor.id, dto);
  }
  @Patch('messages/:id')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async updateMessageAlias() { return this.messaging.updateMessage(); }
  @Delete('messages/:id')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async deleteMessageAlias(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.deleteMessage(actor.id, id);
  }
  @Post('messages/:id/recall')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async recallMessageAlias(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.recallMessage(actor.id, id);
  }
  @Post('messages/:id/hard-delete')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async hardDeleteMessageAlias(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: hardDeleteMessageSchema }) dto: HardDeleteMessageDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.hardDeleteMessage(actor.id, id, dto);
  }
}

@ApiTags('notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  async list(@Query({ schema: listNotificationGroupsQueryServerSchema }) query: ListNotificationGroupsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.listNotificationGroups(actor.id, query);
  }
  @Get('items')
  async items(@Query({ schema: listNotificationItemsQueryServerSchema }) query: ListNotificationItemsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.listNotificationItems(actor.id, query);
  }
  @Get('unread-count')
  async unread(@CurrentUser() actor: AuthenticatedUser) {
    return { unread: await this.messaging.unreadNotificationCount(actor.id) };
  }
  @Sse('unread-count/stream')
  unreadCountStream(@CurrentUser() actor: AuthenticatedUser): Observable<MessageEvent> {
    return this.messaging.unreadCountStream(actor.id);
  }
  @Get('dispatch-log')
  async dispatchLog(@CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.listDispatchLog(actor.id);
  }
  @Post('send')
  async send(@Body({ schema: notifyUserSchema }) dto: NotifyDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.sendSystemNotification(actor.id, dto);
  }
  @Post('mark-read')
  async markNotificationsRead(@Body({ schema: markNotificationsReadSchema }) dto: MarkNotificationsReadDto, @CurrentUser() actor: AuthenticatedUser) {
    void dto;
    return this.messaging.markAllNotificationsRead(actor.id);
  }
  @Post('read-all')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async readAllAlias(@CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.markAllNotificationsRead(actor.id);
  }
  @Post('read-group')
  async readGroup(@Body({ schema: readNotificationGroupSchema }) dto: ReadNotificationGroupDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.markNotificationGroupRead(actor.id, dto);
  }
  @Post('clear-read')
  async clearRead(@CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.clearReadNotifications(actor.id);
  }
  @Post(':id/read')
  async read(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.markNotificationRead(actor.id, id);
  }
  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.messaging.deleteNotification(actor.id, id);
  }
}
