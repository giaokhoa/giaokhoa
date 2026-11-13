import { apiJson } from '#lib/api';
import type {
  BackupJob,
  BackupStep,
  InsightView,
  PrivacyRequestView,
  ReportView,
  ServiceView,
  TokenView,
} from '../types/platform';



export function fetchMyInsights() {
  return apiJson<InsightView[]>('/api/v1/analytics/insights/me');
}


export function fetchPrivacyRequests() {
  return apiJson<PrivacyRequestView[]>('/api/v1/privacy/requests');
}

export function createPrivacyRequest(type: 'export' | 'delete') {
  return apiJson<PrivacyRequestView>('/api/v1/privacy/requests', {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
}

export function decidePrivacyRequest(id: string, decision: 'approved' | 'rejected') {
  return apiJson<PrivacyRequestView>(`/api/v1/privacy/requests/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}


export function fetchBackupJobs() {
  return apiJson<BackupJob[]>('/api/v1/backup/jobs');
}

export function fetchBackupSteps(jobId: string) {
  return apiJson<BackupStep[]>(`/api/v1/backup/jobs/${jobId}/steps`);
}

export function createBackupJob(courseId: string) {
  return apiJson<BackupJob>('/api/v1/backup/jobs', {
    method: 'POST',
    body: JSON.stringify({ courseId }),
  });
}

export function restoreBackup(jobId: string) {
  return apiJson<BackupJob>('/api/v1/backup/restore', {
    method: 'POST',
    body: JSON.stringify({ backupJobId: jobId, mode: 'new' }),
  });
}


export function fetchWebserviceServices() {
  return apiJson<ServiceView[]>('/api/v1/webservice/services');
}

export function fetchWebserviceTokens() {
  return apiJson<TokenView[]>('/api/v1/webservice/tokens');
}

export function createWebserviceService(input: { name: string; shortName: string; functions: string[] }) {
  return apiJson<ServiceView>('/api/v1/webservice/services', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createWebserviceToken(serviceId: string) {
  const me = await apiJson<{ id: string }>('/api/v1/users/me');
  return apiJson<{ token: string }>('/api/v1/webservice/tokens', {
    method: 'POST',
    body: JSON.stringify({ userId: me.id, serviceId }),
  });
}

export function revokeWebserviceToken(tokenId: string) {
  return apiJson<TokenView>(`/api/v1/webservice/tokens/${tokenId}/revoke`, {
    method: 'POST',
    body: '{}',
  });
}


export function fetchPlatformReports() {
  return apiJson<ReportView[]>('/api/v1/reports');
}

export function fetchReportRun(reportId: string) {
  return apiJson<{ rows: Record<string, unknown>[] }>(`/api/v1/reports/${reportId}/run`);
}

export function createReport(input: { name: string; dataSource: string }) {
  return apiJson<ReportView>('/api/v1/reports', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      dataSource: input.dataSource,
      columns: ['userId', 'courseId', 'status'],
      filters: {},
    }),
  });
}

export function scheduleReport(id: string) {
  return apiJson(`/api/v1/reports/${id}/schedules`, {
    method: 'POST',
    body: JSON.stringify({ cron: 'daily' }),
  });
}
