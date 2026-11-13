import type { ExamMatrixView, MatrixImportPreview } from '@giaokhoa/contracts';
import { apiFetch, apiJson } from '#lib/api';
import type {
  AvailabilityLite,
  BankLite,
  CurriculumLite,
  MatrixLite,
  MatrixSpecificationLite,
  MatrixTreeNode,
} from '../types/matrix';


async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch {
    return null;
  }
}

export function fetchMatrixBanks() {
  return apiJson<BankLite[]>('/api/v1/question-banks?kind=matrix');
}

export function fetchCurriculaBySubject(subjectId: string, forCourseId?: string) {
  const frame = forCourseId ? `&forCourseId=${forCourseId}` : '';
  return apiJson<CurriculumLite[]>(`/api/v1/curriculum/curricula?subjectId=${subjectId}${frame}`);
}

export function fetchMatrixDetail(matrixId: string) {
  return apiJson<MatrixLite>(`/api/v1/exam-matrices/${matrixId}`);
}

export function fetchCurriculumTree(curriculumId: string) {
  return probe<MatrixTreeNode[]>(`/api/v1/curriculum/curricula/${curriculumId}/tree`);
}

export function fetchMatrixAvailability(matrixId: string) {
  return probe<AvailabilityLite>(`/api/v1/exam-matrices/${matrixId}/availability`);
}

export function fetchMatrixSpecification(matrixId: string) {
  return apiJson<MatrixSpecificationLite>(`/api/v1/exam-matrices/${matrixId}/specification`);
}

export async function downloadMatrixSpecification(matrixId: string, format: 'xlsx' | 'docx'): Promise<void> {
  const res = await apiFetch(`/api/v1/exam-matrices/${matrixId}/specification/export?format=${format}`);
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `ban-dac-ta-${matrixId.slice(0, 8)}.${format}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function createMatrix(body: {
  name: string;
  subjectId: string;
  curriculumId: string;
  bankId: string;
  levelSet: 'three' | 'four';
  totalScore: number;
  isTemplate: boolean;
  status: string;
}) {
  return apiJson<MatrixLite>('/api/v1/exam-matrices', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateMatrix(
  matrixId: string,
  body: { name: string; status: string; isTemplate: boolean; totalScore: number; levelSet?: 'three' | 'four' },
) {
  return apiJson(`/api/v1/exam-matrices/${matrixId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function addMatrixCell(
  matrixId: string,
  body: {
    curriculumNodeId: string;
    cognitiveLevel: string;
    qtype: string;
    questionCount: number;
    cellScore: number;
  },
) {
  return apiJson(`/api/v1/exam-matrices/${matrixId}/cells`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteMatrixCell(matrixId: string, cellId: string) {
  return apiJson(`/api/v1/exam-matrices/${matrixId}/cells/${cellId}`, { method: 'DELETE' });
}


export async function downloadMatrixImportTemplate(input: {
  subjectId: string;
  curriculumId: string;
  includeAdvanced: boolean;
}): Promise<void> {
  const params = new URLSearchParams({
    subjectId: input.subjectId,
    curriculumId: input.curriculumId,
    levelSet: input.includeAdvanced ? 'four' : 'three',
  });
  const res = await apiFetch(`/api/v1/exam-matrices/template?${params.toString()}`);
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename =
    /filename="([^"]+)"/.exec(disposition)?.[1] ?? `mau-ma-tran-${input.subjectId.slice(0, 8)}.xlsx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function previewMatrixImport(file: File): Promise<MatrixImportPreview> {
  const form = new FormData();
  form.append('file', file);
  return apiJson<MatrixImportPreview>('/api/v1/exam-matrices/import/preview', { method: 'POST', body: form });
}

export async function commitMatrixImport(file: File): Promise<ExamMatrixView> {
  const form = new FormData();
  form.append('file', file);
  return apiJson<ExamMatrixView>('/api/v1/exam-matrices/import', { method: 'POST', body: form });
}
