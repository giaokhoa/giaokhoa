import type { PaperBatch, PaperScan } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';


export function fetchPaperBatches(pinId: string) {
  return apiJson<PaperBatch[]>(`/api/v1/exam-batches?pinId=${pinId}`);
}

export function fetchPaperScans(pinId: string) {
  return apiJson<PaperScan[]>(`/api/v1/exam-scans?pinId=${pinId}`);
}

export function createPaperBatch(pinId: string, body: Record<string, unknown>) {
  return apiJson<PaperBatch>(`/api/v1/exam-batches?pinId=${pinId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function assignScanIdentity(scanId: string, studentId: string) {
  return apiJson(`/api/v1/exam-scans/${scanId}/assign-identity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId }),
  });
}

export function assignScanBatch(scanId: string, batchId: string) {
  return apiJson(`/api/v1/exam-scans/${scanId}/assign-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId }),
  });
}

export function resolveScanReadings(scanId: string, readings: unknown[]) {
  return apiJson(`/api/v1/exam-scans/${scanId}/resolve-readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readings }),
  });
}

export function recordScan(scanId: string) {
  return apiJson<PaperScan & { sumGrades: number }>(`/api/v1/exam-scans/${scanId}/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export function deleteScan(scanId: string) {
  return apiJson(`/api/v1/exam-scans/${scanId}`, { method: 'DELETE' });
}
