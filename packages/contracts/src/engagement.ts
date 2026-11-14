import { z } from 'zod';
import { uuidIdSchema } from './ids.js';



export const messageQuoteSchema = z.object({
  id: uuidIdSchema,
  seq: z.number().int(),
  userIdFrom: uuidIdSchema,
  excerpt: z.string(),
  unavailable: z.boolean(),
});
export type MessageQuote = z.infer<typeof messageQuoteSchema>;

export const messageSchema = z.object({
  id: uuidIdSchema,
  conversationId: uuidIdSchema,
  userIdFrom: uuidIdSchema,
  subject: z.string(),
  fullMessage: z.string(),
  createdAt: z.string(),
  seq: z.number().int(),
  clientMessageId: z.string().nullable(),
  deletedAt: z.string().nullable(),
  deletedBy: uuidIdSchema.nullable(),
  recalledAt: z.string().nullable(),
  recalledBy: uuidIdSchema.nullable(),
  replyToMessageId: uuidIdSchema.nullable(),
  replyTo: messageQuoteSchema.nullable(),
});
export type GiaoKhoaMessage = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: uuidIdSchema,
  type: z.number().int(),
  name: z.string().nullable(),
  members: z.array(uuidIdSchema),
  component: z.string().nullable(),
  itemType: z.string().nullable(),
  itemId: uuidIdSchema.nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationTreeRoleSchema = z.enum(['teaching', 'learning', 'staff']);
export type ConversationTreeRole = z.infer<typeof conversationTreeRoleSchema>;

export const conversationTreeLeafSchema = z.object({
  name: z.string(),
  myRole: conversationTreeRoleSchema,
  conversationId: uuidIdSchema.nullable(),
  unread: z.number().int().nonnegative(),
  pinnedAt: z.string().nullable(),
});
export type ConversationTreeLeaf = z.infer<typeof conversationTreeLeafSchema>;

export const conversationTreeGroupSchema = conversationTreeLeafSchema.extend({
  groupId: uuidIdSchema,
});
export type ConversationTreeGroup = z.infer<typeof conversationTreeGroupSchema>;

export const conversationTreeFreeGroupSchema = conversationTreeLeafSchema.extend({
  conversationId: uuidIdSchema,
});
export type ConversationTreeFreeGroup = z.infer<typeof conversationTreeFreeGroupSchema>;

export const conversationTreeCourseSchema = conversationTreeLeafSchema.extend({
  courseId: uuidIdSchema,
  groups: z.array(conversationTreeGroupSchema),
});
export type ConversationTreeCourse = z.infer<typeof conversationTreeCourseSchema>;

export const conversationTreeClassSchema = conversationTreeLeafSchema.extend({
  classId: uuidIdSchema,
  courses: z.array(conversationTreeCourseSchema),
});
export type ConversationTreeClass = z.infer<typeof conversationTreeClassSchema>;

export const conversationGroupTreeSchema = z.object({
  classes: z.array(conversationTreeClassSchema),
  coursesOutsideClasses: z.array(conversationTreeCourseSchema),
  freeGroups: z.array(conversationTreeFreeGroupSchema),
  canCreateFreeGroup: z.boolean(),
});
export type ConversationGroupTree = z.infer<typeof conversationGroupTreeSchema>;

export const notificationSchema = z.object({
  id: uuidIdSchema,
  userIdTo: uuidIdSchema,
  subject: z.string(),
  fullMessage: z.string(),
  eventType: z.string(),
  timeRead: z.string().nullable(),
  createdAt: z.string(),
});
export type GiaoKhoaNotification = z.infer<typeof notificationSchema>;

export const emailFrequencySchema = z.enum(['immediate', 'daily', 'off']);
export type EmailFrequency = z.infer<typeof emailFrequencySchema>;

export const notificationPreferenceSchema = z.object({
  provider: z.string(),
  component: z.string(),
  group: z.enum(['learning', 'people', 'system']),
  label: z.object({ vi: z.string(), en: z.string() }),
  description: z.object({ vi: z.string(), en: z.string() }),
  teacherOnly: z.boolean(),
  mandatoryInApp: z.boolean(),
  popupEnabled: z.boolean(),
  emailFrequency: emailFrequencySchema.nullable(),
  emailAvailable: z.boolean(),
  siteEnabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;


export const notificationGroupNameSchema = z.enum(['learning', 'people', 'system']);
export type NotificationGroupName = z.infer<typeof notificationGroupNameSchema>;

export const notificationItemSchema = z.object({
  id: uuidIdSchema,
  userIdFrom: uuidIdSchema.nullable(),
  userIdTo: uuidIdSchema,
  subject: z.string(),
  fullMessage: z.string(),
  smallMessage: z.string(),
  component: z.string(),
  eventType: z.string(),
  contextUrl: z.string().nullable(),
  contextUrlName: z.string().nullable(),
  timeRead: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationGroupSchema = z.object({
  eventType: z.string(),
  component: z.string(),
  group: notificationGroupNameSchema,
  contextUrl: z.string().nullable(),
  day: z.string(),
  count: z.number().int(),
  unreadCount: z.number().int(),
  latest: z.object({
    id: uuidIdSchema,
    subject: z.string(),
    smallMessage: z.string(),
    contextUrlName: z.string().nullable(),
    createdAt: z.string(),
    timeRead: z.string().nullable(),
  }),
});
export type NotificationGroup = z.infer<typeof notificationGroupSchema>;

export const notificationGroupPageSchema = z.object({
  items: z.array(notificationGroupSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationGroupPage = z.infer<typeof notificationGroupPageSchema>;

export const notificationItemPageSchema = z.object({
  items: z.array(notificationItemSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationItemPage = z.infer<typeof notificationItemPageSchema>;


export const listNotificationGroupsQuerySchema = z.strictObject({
  group: notificationGroupNameSchema.optional(),
  unreadOnly: z.boolean().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type ListNotificationGroupsQuery = z.infer<typeof listNotificationGroupsQuerySchema>;




export const listNotificationItemsQuerySchema = z.strictObject({
  eventType: z.string().min(1).optional(),
  contextUrl: z.string().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  group: notificationGroupNameSchema.optional(),
  unreadOnly: z.boolean().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ListNotificationItemsQuery = z.infer<typeof listNotificationItemsQuerySchema>;

export const markNotificationsReadSchema = z.strictObject({
  scope: z.literal('all'),
});
export type MarkNotificationsRead = z.infer<typeof markNotificationsReadSchema>;


export const readNotificationGroupSchema = z.strictObject({
  eventType: z.string().min(1),
  contextUrl: z.string().nullable().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ReadNotificationGroup = z.infer<typeof readNotificationGroupSchema>;


export const CALENDAR_EVENT_TYPES = ['site', 'category', 'course', 'group', 'user'] as const;
export const calendarEventSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  eventType: z.enum(CALENDAR_EVENT_TYPES),
  timeStart: z.string(),
  timeDuration: z.number().int(),
  repeatId: uuidIdSchema,
  isException: z.boolean(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;


export const badgeSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  type: z.number().int(),
  status: z.number().int(),
});
export type Badge = z.infer<typeof badgeSchema>;

export const issuedBadgeSchema = z.object({
  id: uuidIdSchema,
  badgeId: uuidIdSchema,
  userId: uuidIdSchema,
  uniqueHash: z.string(),
  dateIssued: z.string(),
  dateExpire: z.string().nullable(),
  revoked: z.boolean(),
});
export type IssuedBadge = z.infer<typeof issuedBadgeSchema>;


export const PLAN_STATUSES = [0, 1, 2, 3, 4] as const;
export const learningPlanSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  userId: uuidIdSchema,
  templateId: uuidIdSchema.nullable(),
  status: z.number().int(),
});
export type LearningPlan = z.infer<typeof learningPlanSchema>;

export const userCompetencySchema = z.object({
  id: uuidIdSchema,
  userId: uuidIdSchema,
  competencyId: uuidIdSchema,
  grade: z.number().int().nullable(),
  proficiency: z.boolean().nullable(),
  status: z.number().int(),
});
export type UserCompetency = z.infer<typeof userCompetencySchema>;


export const tagSchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  ordering: z.number().int(),
});
export type Tag = z.infer<typeof tagSchema>;

export const commentSchema = z.object({
  id: uuidIdSchema,
  userId: uuidIdSchema,
  content: z.string(),
  contextId: uuidIdSchema,
});
export type GiaoKhoaComment = z.infer<typeof commentSchema>;

export const ratingAggregateSchema = z.object({
  count: z.number().int(),
  average: z.number(),
  sum: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
});
export type RatingAggregate = z.infer<typeof ratingAggregateSchema>;


export const noteSchema = z.object({
  id: uuidIdSchema,
  userId: uuidIdSchema,
  courseId: uuidIdSchema,
  createdBy: uuidIdSchema,
  content: z.string(),
  publishState: z.enum(['draft', 'public', 'site']),
});
export type Note = z.infer<typeof noteSchema>;


export const createConversationSchema = z.strictObject({
  type: z.number().int().optional(),
  memberIds: z.array(uuidIdSchema),
  name: z.string().optional(),
});
export type CreateConversation = z.infer<typeof createConversationSchema>;

export const createGroupConversationSchema = z.strictObject({
  groupId: uuidIdSchema,
  name: z.string().optional(),
});
export type CreateGroupConversation = z.infer<typeof createGroupConversationSchema>;

export const MESSAGING_MAX_MESSAGE_LENGTH_DEFAULT = 10000;

export const sendMessageSchema = z.strictObject({
  text: z.string().min(1),
  subject: z.string().optional(),
  clientMessageId: z.string().min(1).max(128).optional(),
  replyToMessageId: uuidIdSchema.optional(),
});
export type SendMessage = z.infer<typeof sendMessageSchema>;

export const listMessagesQuerySchema = z.strictObject({
  beforeSeq: z.number().int().positive().optional(),
  afterSeq: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const searchMessagesQuerySchema = z.strictObject({
  q: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).optional(),
});
export type SearchMessagesQuery = z.infer<typeof searchMessagesQuerySchema>;

export const messageSearchResultSchema = z.object({
  id: uuidIdSchema,
  conversationId: uuidIdSchema,
  userIdFrom: uuidIdSchema,
  seq: z.number().int(),
  excerpt: z.string(),
  createdAt: z.string(),
});
export type MessageSearchResult = z.infer<typeof messageSearchResultSchema>;

export const updateConversationSchema = z.strictObject({
  enabled: z.boolean(),
});
export type UpdateConversation = z.infer<typeof updateConversationSchema>;

export const listConversationsQuerySchema = z.strictObject({
  archived: z.boolean().optional(),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const updateConversationStateSchema = z.strictObject({
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  muted: z.boolean().optional(),
});
export type UpdateConversationState = z.infer<typeof updateConversationStateSchema>;

export const conversationMemberStateSchema = z.object({
  conversationId: uuidIdSchema,
  pinned: z.boolean(),
  pinnedAt: z.string().nullable(),
  archived: z.boolean(),
  archivedAt: z.string().nullable(),
  muted: z.boolean(),
});
export type ConversationMemberState = z.infer<typeof conversationMemberStateSchema>;

export const reportConversationSchema = z.strictObject({
  reason: z.string().max(1000).optional(),
});
export type ReportConversation = z.infer<typeof reportConversationSchema>;

export const updateReportStatusSchema = z.strictObject({
  status: z.enum(['open', 'resolved', 'dismissed']),
});
export type UpdateReportStatus = z.infer<typeof updateReportStatusSchema>;

export const hardDeleteMessageSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});
export type HardDeleteMessage = z.infer<typeof hardDeleteMessageSchema>;

export const bulkRemoveMessagesSchema = z.strictObject({
  messageIds: z.array(uuidIdSchema).min(1).max(100),
  reason: z.string().trim().min(1).max(500),
});
export type BulkRemoveMessages = z.infer<typeof bulkRemoveMessagesSchema>;

export const personSummarySchema = z.strictObject({
  userId: uuidIdSchema,
  displayName: z.string(),
  username: z.string(),
});
export type PersonSummary = z.infer<typeof personSummarySchema>;

export const personProfileSchema = z.strictObject({
  userId: uuidIdSchema,
  displayName: z.string(),
  username: z.string(),
  email: z.string(),
});
export type PersonProfile = z.infer<typeof personProfileSchema>;

export const contactRelationshipSchema = z.enum([
  'contact',
  'pending_incoming',
  'pending_outgoing',
  'blocked',
  'none',
]);
export type ContactRelationship = z.infer<typeof contactRelationshipSchema>;

export const courseRosterRoleSchema = z.enum(['teacher', 'student']);
export type CourseRosterRole = z.infer<typeof courseRosterRoleSchema>;

export const courseRosterMemberSchema = personSummarySchema.extend({
  role: courseRosterRoleSchema,
  relationship: contactRelationshipSchema,
  canDirectMessage: z.boolean(),
});
export type CourseRosterMember = z.infer<typeof courseRosterMemberSchema>;

export const messagingCourseSchema = z.strictObject({
  courseId: uuidIdSchema,
  fullName: z.string(),
  shortName: z.string(),
});
export type MessagingCourse = z.infer<typeof messagingCourseSchema>;

export const listCourseRosterQuerySchema = z.strictObject({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListCourseRosterQuery = z.infer<typeof listCourseRosterQuerySchema>;


export const MESSAGING_SOCKET_EVENTS = {
  newMessage: 'message.new',
  conversationUpdated: 'conversation.updated',
  messageRead: 'message.read',
  messageDeleted: 'message.deleted',
  conversationInvalidate: 'conversation.invalidate',
  typing: 'typing',
  presenceChanged: 'presence.changed',
  presenceSnapshot: 'presence.snapshot',
  sync: 'sync',
  joinConversation: 'conversation.join',
  leaveConversation: 'conversation.leave',
} as const;

export interface RealtimeNewMessagePayload {
  conversationId: string;
  message: GiaoKhoaMessage;
}

export interface RealtimeConversationUpdatedPayload {
  conversationId: string;
  message: GiaoKhoaMessage;
  unreadCount: number;
}

export interface RealtimeMessageReadPayload {
  conversationId: string;
  userId: string;
  lastReadSeq: number;
}

export interface RealtimeMessageDeletedPayload {
  conversationId: string;
  messageId: string;
  seq: number;
  deletedBy: string;
}

export interface RealtimeConversationInvalidatePayload {
  conversationId: string;
}

export interface RealtimeTypingPayload {
  conversationId: string;
  userId: string;
}

export interface RealtimePresencePayload {
  userId: string;
  online: boolean;
}

export interface RealtimePresenceSnapshotPayload {
  onlineUserIds: string[];
}

export type MessagingSyncRequest = Record<string, number>;

export type MessagingSyncResult = Record<string, GiaoKhoaMessage[]>;

export const setNotificationPreferenceSchema = z.strictObject({
  provider: z.string().min(1),
  popupEnabled: z.boolean().optional(),
  emailFrequency: emailFrequencySchema.optional(),
});
export type SetNotificationPreference = z.infer<typeof setNotificationPreferenceSchema>;

export const notificationCourseOverrideModeSchema = z.enum(['all', 'mute']);
export type NotificationCourseOverrideMode = z.infer<typeof notificationCourseOverrideModeSchema>;

export const notificationCourseOverrideSchema = z.object({
  courseId: uuidIdSchema,
  courseName: z.string(),
  mode: notificationCourseOverrideModeSchema,
});
export type NotificationCourseOverride = z.infer<typeof notificationCourseOverrideSchema>;

export const setNotificationCourseOverrideSchema = z.strictObject({
  courseId: uuidIdSchema,
  mode: notificationCourseOverrideModeSchema,
});
export type SetNotificationCourseOverride = z.infer<typeof setNotificationCourseOverrideSchema>;

export const notifyUserSchema = z.strictObject({
  userId: uuidIdSchema,
  provider: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  contextUrl: z.string().optional(),
});
export type NotifyUser = z.infer<typeof notifyUserSchema>;

export const calendarRepeatSchema = z.strictObject({
  freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'daily', 'weekly', 'monthly']),
  count: z.number().int().optional(),
  until: z.string().optional(),
});
export type CalendarRepeat = z.infer<typeof calendarRepeatSchema>;

export const createCalendarEventSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
  eventType: z.enum(['site', 'category', 'course', 'group', 'user']),
  courseId: uuidIdSchema.optional(),
  groupId: uuidIdSchema.optional(),
  categoryId: uuidIdSchema.optional(),
  timeStart: z.string(),
  timeDuration: z.number().int().optional(),
  location: z.string().optional(),
  repeat: calendarRepeatSchema.optional(),
});
export type CreateCalendarEvent = z.infer<typeof createCalendarEventSchema>;

export const createCalendarExceptionSchema = z.strictObject({
  name: z.string().optional(),
  timeStart: z.string(),
  description: z.string().optional(),
});
export type CreateCalendarException = z.infer<typeof createCalendarExceptionSchema>;

export const createCalendarSubscriptionSchema = z.strictObject({
  name: z.string().min(1),
  url: z.string().optional(),
  icsData: z.string().optional(),
  eventType: z.enum(['site', 'category', 'course', 'group', 'user']).optional(),
  courseId: uuidIdSchema.optional(),
  categoryId: uuidIdSchema.optional(),
  pollInterval: z.number().int().optional(),
});
export type CreateCalendarSubscription = z.infer<typeof createCalendarSubscriptionSchema>;

export const calendarRemindSchema = z.strictObject({
  minutesBefore: z.number().int(),
});
export type CalendarRemind = z.infer<typeof calendarRemindSchema>;

export const createBadgeSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.number().int().optional(),
  courseId: uuidIdSchema.optional(),
  issuerName: z.string().optional(),
  issuerUrl: z.string().optional(),
  issuerContact: z.string().optional(),
  expireDate: z.string().optional(),
  expirePeriod: z.number().int().optional(),
  version: z.string().optional(),
});
export type CreateBadge = z.infer<typeof createBadgeSchema>;

export const updateBadgeSchema = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
  issuerName: z.string().optional(),
  expirePeriod: z.number().int().optional(),
});
export type UpdateBadge = z.infer<typeof updateBadgeSchema>;

export const setBadgeStatusSchema = z.strictObject({
  status: z.number().int(),
});
export type SetBadgeStatus = z.infer<typeof setBadgeStatusSchema>;

export const badgeCriteriaParamsSchema = z.union([
  z.strictObject({ courseId: uuidIdSchema, byDate: z.iso.datetime({ offset: true }).optional() }),
  z.strictObject({ cmId: uuidIdSchema }),
  z.strictObject({ competencyId: uuidIdSchema }),
  z.strictObject({ badgeId: uuidIdSchema }),
  z.strictObject({ roleId: uuidIdSchema.optional() }),
  z.strictObject({ cohortId: uuidIdSchema }),
  z.strictObject({ cohortIds: z.array(uuidIdSchema).min(1) }),
  z.strictObject({ field: z.string().min(1), value: z.string().optional() }),
]);
export type BadgeCriteriaParams = z.infer<typeof badgeCriteriaParamsSchema>;

export const badgeCriteriaLeafTypes = [
  'coursecompletion', 'activitycompletion', 'competency', 'badge', 'manual', 'cohort', 'profile',
] as const;

export const badgeCriteriaLeafSchema = z.strictObject({
  criteriaType: z.enum(badgeCriteriaLeafTypes),
  params: badgeCriteriaParamsSchema.optional(),
  description: z.string().optional(),
});
export type BadgeCriteriaLeaf = z.infer<typeof badgeCriteriaLeafSchema>;

export const setBadgeCriteriaSchema = z.strictObject({
  method: z.number().int(),
  criteria: z.array(badgeCriteriaLeafSchema),
});
export type SetBadgeCriteria = z.infer<typeof setBadgeCriteriaSchema>;

export const badgeUserSchema = z.strictObject({
  userId: uuidIdSchema,
});
export type BadgeUser = z.infer<typeof badgeUserSchema>;

export const competencyScaleSchema = z.strictObject({
  values: z.array(z.string()),
  proficient: z.array(z.number().int()),
});
export type CompetencyScale = z.infer<typeof competencyScaleSchema>;

export const createCompetencyFrameworkSchema = z.strictObject({
  shortName: z.string().min(1),
  idNumber: z.string().optional(),
  description: z.string().optional(),
  scale: competencyScaleSchema,
  visible: z.boolean().optional(),
});
export type CreateCompetencyFramework = z.infer<typeof createCompetencyFrameworkSchema>;

export const createCompetencySchema = z.strictObject({
  shortName: z.string().min(1),
  idNumber: z.string().optional(),
  description: z.string().optional(),
  parentId: uuidIdSchema.optional(),
});
export type CreateCompetency = z.infer<typeof createCompetencySchema>;

export const linkCompetencySchema = z.strictObject({
  competencyId: uuidIdSchema,
  ruleOutcome: z.string(),
});
export type LinkCompetency = z.infer<typeof linkCompetencySchema>;

export const createLearningPlanTemplateSchema = z.strictObject({
  shortName: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().optional(),
});
export type CreateLearningPlanTemplate = z.infer<typeof createLearningPlanTemplateSchema>;

export const addTemplateCompetencySchema = z.strictObject({
  competencyId: uuidIdSchema,
});
export type AddTemplateCompetency = z.infer<typeof addTemplateCompetencySchema>;

export const addTemplateCohortSchema = z.strictObject({
  cohortId: uuidIdSchema,
});
export type AddTemplateCohort = z.infer<typeof addTemplateCohortSchema>;

export const createLearningPlanSchema = z.strictObject({
  userId: uuidIdSchema.optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  templateId: uuidIdSchema.optional(),
});
export type CreateLearningPlan = z.infer<typeof createLearningPlanSchema>;

export const addCompetencyEvidenceSchema = z.strictObject({
  userId: uuidIdSchema,
  competencyId: uuidIdSchema,
  planId: uuidIdSchema.optional(),
  courseId: uuidIdSchema.optional(),
  description: z.string().min(1),
  url: z.string().optional(),
  grade: z.number().int().optional(),
  note: z.string().optional(),
  sendForReview: z.boolean().optional(),
});
export type AddCompetencyEvidence = z.infer<typeof addCompetencyEvidenceSchema>;

export const gradeUserCompetencySchema = z.strictObject({
  userId: uuidIdSchema,
  competencyId: uuidIdSchema,
  planId: uuidIdSchema.optional(),
  courseId: uuidIdSchema.optional(),
  grade: z.number().int(),
  note: z.string().optional(),
});
export type GradeUserCompetency = z.infer<typeof gradeUserCompetencySchema>;

export const competencyReviewDecisionSchema = z.strictObject({
  grade: z.number().int().optional(),
  note: z.string().optional(),
});
export type CompetencyReviewDecision = z.infer<typeof competencyReviewDecisionSchema>;

export const competencyNoteSchema = z.strictObject({
  note: z.string().optional(),
});
export type CompetencyNote = z.infer<typeof competencyNoteSchema>;

export const numericValueSchema = z.strictObject({
  value: z.number().optional(),
});
export type NumericValue = z.infer<typeof numericValueSchema>;

export const competencyRuleOutcomeSchema = z.enum(['complete', 'attach-evidence', 'nothing']);
export type CompetencyRuleOutcome = z.infer<typeof competencyRuleOutcomeSchema>;

export const competencyRulePointsEntrySchema = z.strictObject({
  competencyId: uuidIdSchema,
  points: z.number().int().min(0),
  required: z.boolean(),
});
export type CompetencyRulePointsEntry = z.infer<typeof competencyRulePointsEntrySchema>;

export const setCompetencyRuleSchema = z.strictObject({
  outcome: competencyRuleOutcomeSchema,
  pointsRequired: z.number().int().min(1),
  entries: z.array(competencyRulePointsEntrySchema).min(1),
});
export type SetCompetencyRule = z.infer<typeof setCompetencyRuleSchema>;

export const frameworkExportRuleEntrySchema = z.strictObject({
  competencyKey: z.string().min(1),
  points: z.number().int().min(0),
  required: z.boolean(),
});
export type FrameworkExportRuleEntry = z.infer<typeof frameworkExportRuleEntrySchema>;

export const frameworkExportRuleSchema = z.strictObject({
  outcome: competencyRuleOutcomeSchema,
  pointsRequired: z.number().int().min(1),
  entries: z.array(frameworkExportRuleEntrySchema).min(1),
});
export type FrameworkExportRule = z.infer<typeof frameworkExportRuleSchema>;

export const frameworkExportCompetencySchema = z.strictObject({
  key: z.string().min(1),
  shortName: z.string().min(1),
  idNumber: z.string(),
  description: z.string(),
  parentKey: z.string().min(1).nullable(),
  sortOrder: z.number().int(),
  rule: frameworkExportRuleSchema.nullable(),
});
export type FrameworkExportCompetency = z.infer<typeof frameworkExportCompetencySchema>;

export const frameworkExportSchema = z.strictObject({
  format: z.literal('giaokhoa-competency-framework'),
  version: z.literal(1),
  framework: z.strictObject({
    shortName: z.string().min(1),
    idNumber: z.string(),
    description: z.string(),
    visible: z.boolean(),
    taxonomies: z.string(),
    scale: competencyScaleSchema,
  }),
  competencies: z.array(frameworkExportCompetencySchema),
});
export type FrameworkExport = z.infer<typeof frameworkExportSchema>;

export const setItemTagsSchema = z.strictObject({
  component: z.string(),
  itemType: z.string(),
  itemId: uuidIdSchema,
  contextId: uuidIdSchema,
  tags: z.array(z.string()),
});
export type SetItemTags = z.infer<typeof setItemTagsSchema>;

export const addItemTagSchema = z.strictObject({
  component: z.string(),
  itemType: z.string(),
  itemId: uuidIdSchema,
  contextId: uuidIdSchema,
  tag: z.string().min(1),
});
export type AddItemTag = z.infer<typeof addItemTagSchema>;

export const addCommentSchema = z.strictObject({
  contextId: uuidIdSchema,
  component: z.string(),
  commentArea: z.string(),
  itemId: uuidIdSchema,
  content: z.string().min(1),
});
export type AddComment = z.infer<typeof addCommentSchema>;

export const rateItemSchema = z.strictObject({
  contextId: uuidIdSchema,
  component: z.string(),
  ratingArea: z.string(),
  itemId: uuidIdSchema,
  scaleId: z.number().int(),
  rating: z.number().int(),
});
export type RateItem = z.infer<typeof rateItemSchema>;


export const createNoteSchema = z.strictObject({
  userId: uuidIdSchema,
  courseId: uuidIdSchema.optional(),
  content: z.string().min(1),
  publishState: z.enum(['draft', 'public', 'site']).optional(),
  groupId: uuidIdSchema.optional(),
});
export type CreateNote = z.infer<typeof createNoteSchema>;
