import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { queryClient } from '#lib/query-client';
import {
  createBackupJob, createPrivacyRequest, createReport, createWebserviceService, createWebserviceToken,
  decidePrivacyRequest, fetchBackupJobs, fetchBackupSteps, fetchMyInsights, fetchPlatformReports,
  fetchPrivacyRequests, fetchReportRun, fetchWebserviceServices, fetchWebserviceTokens, restoreBackup,
  revokeWebserviceToken, scheduleReport,
} from '../api/platform';
import { queryKeys } from './keys';



export function myInsightsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.myInsights,
    queryFn: () => fetchMyInsights(),
  });
}

export function useMyInsights() {
  return useQuery(myInsightsQueryOptions());
}

export async function insightsPageClientLoader() {
  await queryClient.prefetchQuery(myInsightsQueryOptions());
  return null;
}


export function privacyRequestsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.privacyRequests,
    queryFn: () => fetchPrivacyRequests(),
  });
}

export function usePrivacyRequests() {
  return useQuery(privacyRequestsQueryOptions());
}

export function useCreatePrivacyRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (type: 'export' | 'delete') => createPrivacyRequest(type),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.privacyRequests }),
  });
}

export function useDecidePrivacyRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      decidePrivacyRequest(id, decision),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.privacyRequests }),
  });
}

export async function privacyPageClientLoader() {
  await queryClient.prefetchQuery(privacyRequestsQueryOptions());
  return null;
}


export function backupJobsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.backupJobs,
    queryFn: () => fetchBackupJobs(),
  });
}

export function useBackupJobs() {
  return useQuery(backupJobsQueryOptions());
}

export function backupStepsQueryOptions(jobId: string) {
  return queryOptions({
    queryKey: queryKeys.backupSteps(jobId),
    queryFn: () => fetchBackupSteps(jobId),
  });
}

export function useBackupSteps(selectedJobId: string | null) {
  return useQuery({
    ...backupStepsQueryOptions(selectedJobId ?? ''),
    enabled: selectedJobId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useCreateBackupJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) => createBackupJob(courseId),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.backupJobs }),
  });
}

export function useRestoreBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => restoreBackup(jobId),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.backupJobs }),
  });
}

export async function backupPageClientLoader() {
  await queryClient.prefetchQuery(backupJobsQueryOptions());
  return null;
}


export function webserviceServicesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.webserviceServices,
    queryFn: () => fetchWebserviceServices(),
  });
}

export function useWebserviceServices() {
  return useQuery(webserviceServicesQueryOptions());
}

export function webserviceTokensQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.webserviceTokens,
    queryFn: () => fetchWebserviceTokens(),
  });
}

export function useWebserviceTokens() {
  return useQuery(webserviceTokensQueryOptions());
}

export function useCreateWebserviceService() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; shortName: string; functions: string[] }) =>
      createWebserviceService(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.webserviceServices });
      void client.invalidateQueries({ queryKey: queryKeys.webserviceTokens });
    },
  });
}

export function useCreateWebserviceToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (serviceId: string) => createWebserviceToken(serviceId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.webserviceServices });
      void client.invalidateQueries({ queryKey: queryKeys.webserviceTokens });
    },
  });
}

export function useRevokeWebserviceToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => revokeWebserviceToken(tokenId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.webserviceServices });
      void client.invalidateQueries({ queryKey: queryKeys.webserviceTokens });
    },
  });
}

export async function tokensPageClientLoader() {
  await Promise.all([
    queryClient.prefetchQuery(webserviceServicesQueryOptions()),
    queryClient.prefetchQuery(webserviceTokensQueryOptions()),
  ]);
  return null;
}


export function platformReportsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.platformReports,
    queryFn: () => fetchPlatformReports(),
  });
}

export function usePlatformReports() {
  return useQuery(platformReportsQueryOptions());
}

export function reportRunQueryOptions(reportId: string) {
  return queryOptions({
    queryKey: queryKeys.reportRun(reportId),
    queryFn: () => fetchReportRun(reportId),
  });
}

export function useReportRun(selectedReportId: string | null) {
  return useQuery({
    ...reportRunQueryOptions(selectedReportId ?? ''),
    enabled: selectedReportId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useCreateReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; dataSource: string }) => createReport(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.platformReports }),
  });
}

export function useScheduleReport() {
  return useMutation({
    mutationFn: (id: string) => scheduleReport(id),
  });
}

export async function reportsPageClientLoader() {
  await queryClient.prefetchQuery(platformReportsQueryOptions());
  return null;
}
