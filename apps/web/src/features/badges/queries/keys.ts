export const queryKeys = {
  badges: ['badges'] as const,
  badgesAll: ['badges', 'all'] as const,
  badgeIssued: (badgeId: string) => ['badges', badgeId, 'issued'] as const,
};
