import type { SystemMaterialSubmission, SystemMaterialVersion, UseSystemMaterial } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type { LibraryItem } from '../types/content-bank';

const ROOT = '/api/v1/system-bank/materials';

export const materialSources = () => apiJson<LibraryItem[]>(`${ROOT}/submissions/sources`);
export const materialSubmissions = (scope: 'mine' | 'pending') => apiJson<SystemMaterialSubmission[]>(`${ROOT}/submissions/${scope}`);
export const publishedMaterials = () => apiJson<SystemMaterialVersion[]>(ROOT);
export const submitMaterial = (contentId: string) => apiJson<SystemMaterialSubmission>(`${ROOT}/submissions`, { method: 'POST', body: JSON.stringify({ contentId }) });
export const reviewMaterial = (id: string, reason?: string) => apiJson<SystemMaterialSubmission>(`${ROOT}/submissions/${id}/${reason ? 'reject' : 'approve'}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) });
export const attachPublishedMaterial = (input: UseSystemMaterial) => apiJson<{ cmId: string; resourceId: string }>(`${ROOT}/use`, { method: 'POST', body: JSON.stringify(input) });
