export const queryKeys = {
  guardianLinks: ['guardian', 'links'] as const,
  guardianOverview: (studentId: string) => ['guardian', 'overview', studentId] as const,
  guardianResults: (studentId: string) => ['guardian', 'results', studentId] as const,
  guardianDigestPreference: (studentId: string) => ['guardian', 'digest-preference', studentId] as const,
};
