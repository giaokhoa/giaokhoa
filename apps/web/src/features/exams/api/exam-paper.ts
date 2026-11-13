import type { ExamSlotInput } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type {
  CreateExamPaperBody,
  DiscoveryItemLite,
  PaperView,
  PinViewLite,
  UpdateExamPaperMetaBody,
} from '../types/exam-paper';


export function fetchExamQuestionDiscovery(params: string) {
  return apiJson<DiscoveryItemLite[]>(`/api/v1/questions/discovery?${params}`);
}

export function fetchExamPaper(paperId: string) {
  return apiJson<PaperView>(`/api/v1/exams/${paperId}`);
}

export async function fetchExamPaperPins(paperId: string): Promise<PinViewLite[]> {
  try {
    return await apiJson<PinViewLite[]>(`/api/v1/exams/${paperId}/pins`);
  } catch {
    return [];
  }
}

export function createExamPaper(bankId: string, body: CreateExamPaperBody) {
  return apiJson<PaperView>(`/api/v1/exams/banks/${bankId}/exams`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateExamPaperMeta(paperId: string, body: UpdateExamPaperMetaBody) {
  return apiJson<PaperView>(`/api/v1/exams/${paperId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function replaceExamPaperSlots(
  paperId: string,
  slots: ExamSlotInput[],
) {
  return apiJson<PaperView>(`/api/v1/exams/${paperId}/slots`, {
    method: 'PUT',
    body: JSON.stringify({ slots }),
  });
}

export function swapExamPaperSlot(paperId: string, position: number, questionId: string) {
  return apiJson<PaperView>(`/api/v1/exams/${paperId}/swap`, {
    method: 'POST',
    body: JSON.stringify({ position, questionId }),
  });
}

export function fetchSystemExamQuestions(offset: number) {
  return apiJson<{ items: { id: string; qtype: string; versions: { version: number }[] }[]; total: number }>(
    `/api/v1/system-bank/discovery?limit=20&offset=${offset}`,
  );
}

export function fetchSystemExamQuestionPreview(questionId: string, version: number) {
  return apiJson<{ package: import('@giaokhoa/contracts').SystemBankPackage }>(
    `/api/v1/system-bank/questions/${questionId}/versions/${version}`,
  );
}
