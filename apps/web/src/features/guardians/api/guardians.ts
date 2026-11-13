import type {
  GuardianDigestFrequency, GuardianDigestPreferenceView, GuardianStudentOverviewView, GuardianStudentResultsView,
} from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type { CreateGuardianLinkDraft, GuardianLinkView, GuardianMyStudentEntry } from '../types/guardians';


export function fetchGuardianMyStudents() {
  return apiJson<GuardianMyStudentEntry[]>('/api/v1/guardian-links/mine/students');
}

export function fetchGuardianOverview(studentId: string) {
  return apiJson<GuardianStudentOverviewView>(`/api/v1/guardian/students/${studentId}/overview`);
}

export function fetchGuardianResults(studentId: string) {
  return apiJson<GuardianStudentResultsView>(`/api/v1/guardian/students/${studentId}/results`);
}

export function fetchGuardianDigestPreference(studentId: string) {
  return apiJson<GuardianDigestPreferenceView>(`/api/v1/guardian/students/${studentId}/digest-preference`);
}

export function updateGuardianDigestPreference(studentId: string, frequency: GuardianDigestFrequency) {
  return apiJson<GuardianDigestPreferenceView>(
    `/api/v1/guardian/students/${studentId}/digest-preference`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frequency }) },
  );
}

export function fetchGuardianLinks() {
  return apiJson<GuardianLinkView[]>('/api/v1/guardian-links');
}

export function createGuardianLink(draft: CreateGuardianLinkDraft) {
  return apiJson<GuardianLinkView>('/api/v1/guardian-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
}

export function revokeGuardianLink(linkId: string) {
  return apiJson<GuardianLinkView>(`/api/v1/guardian-links/${linkId}`, { method: 'DELETE' });
}
