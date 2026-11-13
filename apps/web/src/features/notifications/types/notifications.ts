
export interface NotificationItemView {
  id: string;
  subject: string;
  fullMessage: string;
  smallMessage: string;
  eventType: string;
  contextUrl: string | null;
  contextUrlName: string | null;
  timeRead: string | null;
  createdAt: string;
}

export type NotificationGroupFilter = 'learning' | 'people' | 'system';

export interface NotificationGroupView {
  eventType: string;
  component: string;
  group: NotificationGroupFilter;
  contextUrl: string | null;
  day: string;
  count: number;
  unreadCount: number;
  latest: {
    id: string;
    subject: string;
    smallMessage: string;
    contextUrlName: string | null;
    createdAt: string;
    timeRead: string | null;
  };
}

export interface NotificationGroupsPage {
  items: NotificationGroupView[];
  nextCursor: string | null;
}

export type EmailFrequency = 'immediate' | 'daily' | 'off';

export interface NotificationPreferenceView {
  provider: string;
  component: string;
  group: NotificationGroupFilter;
  label: { vi: string; en: string };
  description: { vi: string; en: string };
  teacherOnly: boolean;
  mandatoryInApp: boolean;
  popupEnabled: boolean;
  emailFrequency: EmailFrequency | null;
  emailAvailable: boolean;
  siteEnabled: boolean;
}

export interface PreferencePatch {
  popupEnabled?: boolean;
  emailFrequency?: EmailFrequency;
}

export type NotificationCourseOverrideMode = 'all' | 'mute';

export interface NotificationCourseOverrideView {
  courseId: string;
  courseName: string;
  mode: NotificationCourseOverrideMode;
}
