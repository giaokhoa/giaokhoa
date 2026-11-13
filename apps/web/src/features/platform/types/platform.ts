
export interface InsightView {
  id: string;
  userId: string;
  heading: string;
  courseId: string;
}

export interface PrivacyRequestView {
  id: string;
  userId: string;
  type: string;
  status: string;
}

export interface BackupJob {
  id: string;
  type: string;
  courseId: string;
  targetCourseId: string | null;
  mode: string;
  status: string;
}

export interface BackupStep {
  id: string;
  name: string;
  status: string;
}

export interface ServiceView {
  id: string;
  name: string;
  shortName: string;
  enabled: boolean;
  functions: string[];
}

export interface TokenView {
  id: string;
  userId: string;
  serviceId: string;
  revoked: boolean;
}

export interface ReportView {
  id: string;
  name: string;
  dataSource: string;
  columns: string[];
}
