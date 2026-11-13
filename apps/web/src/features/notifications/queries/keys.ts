export const queryKeys = {
  notificationGroupsRoot: ['notifications', 'groups'] as const,
  notificationGroups: (group: string, unreadOnly: boolean) =>
    ['notifications', 'groups', group, unreadOnly] as const,
  notificationGroupItems: (eventType: string, contextUrl: string, day: string) =>
    ['notifications', 'items', eventType, contextUrl, day] as const,
  messagePreferences: ['messages', 'preferences'] as const,
  messageCourseOverrides: ['messages', 'preferences', 'courses'] as const,
};
