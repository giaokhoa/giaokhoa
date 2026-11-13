export const queryKeys = {
  myInsights: ['analytics', 'insights', 'me'] as const,
  privacyRequests: ['privacy', 'requests'] as const,
  backupJobs: ['backup', 'jobs'] as const,
  backupSteps: (jobId: string) => ['backup', 'jobs', jobId, 'steps'] as const,
  webserviceServices: ['webservice', 'services'] as const,
  webserviceTokens: ['webservice', 'tokens'] as const,
  platformReports: ['reports'] as const,
  reportRun: (reportId: string) => ['reports', reportId, 'run'] as const,
};
