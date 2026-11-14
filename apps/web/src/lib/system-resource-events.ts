import { apiJson } from '#lib/api';

export interface SystemQuestionEvent {
  id: string;
  type: 'question_version_published' | 'question_withdrawn' |
    'exam_version_published' | 'exam_withdrawn' |
    'material_version_published' | 'material_withdrawn' |
    'programme_version_published' | 'programme_withdrawn';
  sourceQuestionId: string | null;
  resourceKind: 'exam' | 'material' | 'programme' | null;
  resourceKey: string | null;
  payload: { versionNumber?: number; version?: number | string; reason?: string };
}

export function fetchSystemQuestionEvents() {
  return apiJson<SystemQuestionEvent[]>('/api/v1/system-bank/events/pending');
}

export function acknowledgeSystemQuestionEvent(id: string) {
  return apiJson<unknown>(`/api/v1/system-bank/events/${id}/acknowledge`, { method: 'POST' });
}
