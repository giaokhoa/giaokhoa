export const queryKeys = {
  messagingGroupTree: ['messages', 'group-tree'] as const,
  messagingConversations: ['messages', 'conversations'] as const,
  messagingArchivedConversations: ['messages', 'conversations', 'archived'] as const,
  messagingBlockedContacts: ['messages', 'contacts', 'blocked'] as const,
  messagingContacts: ['messages', 'contacts'] as const,
  messagingContactRequests: ['messages', 'contacts', 'requests'] as const,
  messagingCourses: ['messages', 'courses'] as const,
  messagingConversationDetail: (conversationId: string) => ['messages', 'conversations', conversationId] as const,
  messagingMessagesPage: (conversationId: string, beforeSeq: number) =>
    ['messages', 'conversations', conversationId, 'messages', beforeSeq] as const,
  messagingSearch: (conversationId: string, q: string) => ['messages', 'conversations', conversationId, 'search', q] as const,
  messagingRosterPage: (url: string) => ['messages', 'roster', url] as const,
  messagingClassConversation: (classId: string) => ['messages', 'classes', classId, 'conversation'] as const,
  messagingPersonProfile: (userId: string) => ['messages', 'users', userId, 'profile'] as const,
};
