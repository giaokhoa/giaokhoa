import { apiJson } from '#lib/api';
import type {
  LibraryFilters,
  LibraryItem,
  LibraryItemInput,
  LibrarySpace,
  ReviewChecklist,
} from '../types/content-bank';


export function fetchSpaces(): Promise<LibrarySpace[]> {
  return apiJson<LibrarySpace[]>('/api/v1/contentbank/spaces');
}

export function fetchItems(filters: LibraryFilters = {}): Promise<LibraryItem[]> {
  const params = new URLSearchParams();
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.spaceId) params.set('spaceId', filters.spaceId);
  if (filters.subjectId) params.set('subjectId', filters.subjectId);
  if (filters.grade) params.set('grade', String(filters.grade));
  if (filters.level) params.set('level', filters.level);
  if (filters.resourceType) params.set('resourceType', filters.resourceType);
  if (filters.reviewStatus) params.set('reviewStatus', filters.reviewStatus);
  const qs = params.toString();
  return apiJson<LibraryItem[]>(`/api/v1/contentbank${qs ? `?${qs}` : ''}`);
}

export function fetchItem(id: string): Promise<LibraryItem> {
  return apiJson<LibraryItem>(`/api/v1/contentbank/${id}`);
}

export function createItem(input: LibraryItemInput): Promise<LibraryItem> {
  return apiJson<LibraryItem>('/api/v1/contentbank', { method: 'POST', body: JSON.stringify(input) });
}

export function updateItem(id: string, input: Partial<LibraryItemInput>): Promise<LibraryItem> {
  return apiJson<LibraryItem>(`/api/v1/contentbank/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteItem(id: string): Promise<{ deleted: boolean }> {
  return apiJson<{ deleted: boolean }>(`/api/v1/contentbank/${id}`, { method: 'DELETE' });
}

export function submitItem(id: string): Promise<LibraryItem> {
  return apiJson<LibraryItem>(`/api/v1/contentbank/${id}/submit`, { method: 'POST' });
}

export function reviewItem(id: string, decision: 'approved' | 'rejected', note?: string, checklist?: ReviewChecklist): Promise<LibraryItem> {
  return apiJson<LibraryItem>(`/api/v1/contentbank/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, ...(note ? { note } : {}), ...(checklist ? { checklist } : {}) }),
  });
}

export function insertItem(id: string, courseId: string, sectionId: string): Promise<{ cmId: string; fileId: string | null }> {
  return apiJson<{ cmId: string; fileId: string | null }>(`/api/v1/contentbank/${id}/insert`, {
    method: 'POST',
    body: JSON.stringify({ courseId, sectionId }),
  });
}

export function uploadItemFile(id: string, fileName: string, contentBase64: string, mimeType?: string): Promise<LibraryItem> {
  return apiJson<LibraryItem>(`/api/v1/contentbank/${id}/file`, {
    method: 'POST',
    body: JSON.stringify({ fileName, contentBase64, ...(mimeType ? { mimeType } : {}) }),
  });
}

export function fetchItemFileUrl(id: string): Promise<{ url: string; expiresAt: number }> {
  return apiJson<{ url: string; expiresAt: number }>(`/api/v1/contentbank/${id}/file-url`);
}
