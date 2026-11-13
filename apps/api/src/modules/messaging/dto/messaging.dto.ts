import { z } from 'zod';
import {
  bulkRemoveMessagesSchema,
  createConversationSchema,
  createGroupConversationSchema,
  hardDeleteMessageSchema,
  listConversationsQuerySchema,
  listCourseRosterQuerySchema,
  listMessagesQuerySchema,
  listNotificationGroupsQuerySchema,
  listNotificationItemsQuerySchema,
  markNotificationsReadSchema,
  notifyUserSchema,
  readNotificationGroupSchema,
  reportConversationSchema,
  searchMessagesQuerySchema,
  sendMessageSchema,
  setNotificationCourseOverrideSchema,
  setNotificationPreferenceSchema,
  updateConversationSchema,
  updateConversationStateSchema,
  updateReportStatusSchema,
  type BulkRemoveMessages,
  type CreateConversation,
  type CreateGroupConversation,
  type HardDeleteMessage,
  type ListCourseRosterQuery,
  type MarkNotificationsRead,
  type NotifyUser,
  type ReadNotificationGroup,
  type ReportConversation,
  type SendMessage,
  type SetNotificationCourseOverride,
  type SetNotificationPreference,
  type UpdateConversation,
  type UpdateConversationState,
  type UpdateReportStatus,
} from '@giaokhoa/contracts';

export { bulkRemoveMessagesSchema, createConversationSchema, createGroupConversationSchema, hardDeleteMessageSchema, markNotificationsReadSchema, notifyUserSchema, readNotificationGroupSchema, reportConversationSchema, searchMessagesQuerySchema, sendMessageSchema, setNotificationCourseOverrideSchema, setNotificationPreferenceSchema, updateConversationSchema, updateConversationStateSchema, updateReportStatusSchema };
export type CreateConversationDto = CreateConversation;
export type CreateGroupConversationDto = CreateGroupConversation;
export type SendMessageDto = SendMessage;
export type SetPreferenceDto = SetNotificationPreference;
export type SetCourseOverrideDto = SetNotificationCourseOverride;
export type NotifyDto = NotifyUser;
export type UpdateConversationDto = UpdateConversation;
export type UpdateConversationStateDto = UpdateConversationState;
export type ReportConversationDto = ReportConversation;
export type UpdateReportStatusDto = UpdateReportStatus;
export type HardDeleteMessageDto = HardDeleteMessage;
export type BulkRemoveMessagesDto = BulkRemoveMessages;

export const listMessagesQueryServerSchema = listMessagesQuerySchema.extend({
  beforeSeq: z.coerce.number().int().positive().optional(),
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListMessagesQueryDto = z.infer<typeof listMessagesQueryServerSchema>;

export const searchMessagesQueryServerSchema = searchMessagesQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SearchMessagesQueryDto = z.infer<typeof searchMessagesQueryServerSchema>;

export const listCourseRosterQueryServerSchema = listCourseRosterQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListCourseRosterQueryDto = ListCourseRosterQuery;

const queryBooleanSchema = z.string().optional().transform((v) => v === 'true');

export const listNotificationGroupsQueryServerSchema = listNotificationGroupsQuerySchema.extend({
  unreadOnly: queryBooleanSchema,
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type ListNotificationGroupsQueryDto = z.infer<typeof listNotificationGroupsQueryServerSchema>;

export const listNotificationItemsQueryServerSchema = listNotificationItemsQuerySchema.extend({
  unreadOnly: queryBooleanSchema,
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListNotificationItemsQueryDto = z.infer<typeof listNotificationItemsQueryServerSchema>;

export type ReadNotificationGroupDto = ReadNotificationGroup;
export type MarkNotificationsReadDto = MarkNotificationsRead;

export const listConversationsQueryServerSchema = listConversationsQuerySchema.extend({
  archived: queryBooleanSchema,
});
export type ListConversationsQueryDto = z.infer<typeof listConversationsQueryServerSchema>;
