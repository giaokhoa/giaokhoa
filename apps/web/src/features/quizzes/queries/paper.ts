import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryClient } from '#lib/query-client';
import {
  assignScanBatch,
  assignScanIdentity,
  createPaperBatch,
  deleteScan,
  fetchPaperBatches,
  fetchPaperScans,
  recordScan,
  resolveScanReadings,
} from '../api/paper';
import { queryKeys } from './keys';


export function paperBatchesQueryOptions(pinId: string) {
  return queryOptions({
    queryKey: queryKeys.examBatches(pinId),
    queryFn: () => fetchPaperBatches(pinId),
  });
}

export function usePaperBatches(pinId: string) {
  return useQuery(paperBatchesQueryOptions(pinId));
}

export function paperScansQueryOptions(pinId: string) {
  return queryOptions({
    queryKey: queryKeys.examScans(pinId),
    queryFn: () => fetchPaperScans(pinId),
  });
}

export function usePaperScans(pinId: string) {
  return useQuery(paperScansQueryOptions(pinId));
}

function useInvalidatePaperLists(pinId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.examBatches(pinId) });
    void client.invalidateQueries({ queryKey: queryKeys.examScans(pinId) });
  };
}

export function useCreatePaperBatch(pinId: string) {
  const invalidate = useInvalidatePaperLists(pinId);
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => createPaperBatch(pinId, body),
    onSuccess: invalidate,
  });
}

export function useAssignScanIdentity(pinId: string) {
  const invalidate = useInvalidatePaperLists(pinId);
  return useMutation({
    mutationFn: ({ scanId, studentId }: { scanId: string; studentId: string }) =>
      assignScanIdentity(scanId, studentId),
    onSuccess: invalidate,
  });
}

export function useAssignScanBatch(pinId: string) {
  const invalidate = useInvalidatePaperLists(pinId);
  return useMutation({
    mutationFn: ({ scanId, batchId }: { scanId: string; batchId: string }) =>
      assignScanBatch(scanId, batchId),
    onSuccess: invalidate,
  });
}

export function useResolveScanReadings(pinId: string) {
  const invalidate = useInvalidatePaperLists(pinId);
  return useMutation({
    mutationFn: ({ scanId, readings }: { scanId: string; readings: unknown[] }) =>
      resolveScanReadings(scanId, readings),
    onSuccess: invalidate,
  });
}

export function useRecordScan(pinId: string) {
  const invalidate = useInvalidatePaperLists(pinId);
  return useMutation({
    mutationFn: (scanId: string) => recordScan(scanId),
    onSuccess: invalidate,
  });
}

export function useDeleteScan(pinId: string) {
  const invalidate = useInvalidatePaperLists(pinId);
  return useMutation({
    mutationFn: (scanId: string) => deleteScan(scanId),
    onSuccess: invalidate,
  });
}

export async function paperPageClientLoader(pinId: string) {
  await Promise.all([
    queryClient.prefetchQuery(paperBatchesQueryOptions(pinId)),
    queryClient.prefetchQuery(paperScansQueryOptions(pinId)),
  ]);
  return null;
}
