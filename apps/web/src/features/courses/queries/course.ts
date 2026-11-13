import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createFeePayment,
  fetchCoursePage,
  fetchMyPayments,
  selfEnrolCourse,
  setManualCompletion,
} from '../api/course';
import { queryKeys } from './keys';


export function coursePageQueryOptions(courseId: string) {
  return queryOptions({
    queryKey: queryKeys.coursePage(courseId),
    queryFn: () => fetchCoursePage(courseId),
  });
}

export function useCoursePage(courseId: string | undefined) {
  return useQuery({
    ...coursePageQueryOptions(courseId ?? ''),
    enabled: !!courseId,
  });
}

export function myPaymentsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.myPayments,
    queryFn: () => fetchMyPayments(),
  });
}

export function useMyPayments() {
  const query = useQuery(myPaymentsQueryOptions());
  return { ...query, payments: query.data ?? [] };
}

export function useSelfEnrol(courseId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) => selfEnrolCourse(courseId, instanceId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.coursePage(courseId ?? '') }),
  });
}

export function usePayFee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) => createFeePayment(instanceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.myPayments }),
  });
}

export function useToggleManualCompletion(courseId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { cmId: string; userId: string; complete: boolean }) =>
      setManualCompletion(courseId, vars),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.coursePage(courseId ?? '') }),
  });
}
