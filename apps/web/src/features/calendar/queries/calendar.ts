import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  createCalendarEvent, createCalendarExportToken, createCalendarSubscription, deleteCalendarEvent,
  fetchCalendarEvents, fetchCalendarExportToken, fetchCalendarSubscriptions, importCalendarSubscription,
  remindCalendarEvent, revokeCalendarExportToken,
} from '../api/calendar';
import { queryKeys } from './keys';


export function useCalendarEvents(fromIso: string, toIso: string) {
  return useQuery({
    queryKey: sharedQueryKeys.calendarEvents(fromIso, toIso),
    queryFn: () => fetchCalendarEvents(fromIso, toIso),
  });
}

export function useCalendarSubscriptions() {
  return useQuery({
    queryKey: queryKeys.calendarSubscriptions,
    queryFn: () => fetchCalendarSubscriptions(),
    placeholderData: keepPreviousData,
  });
}

export function useCalendarExportToken() {
  return useQuery({
    queryKey: queryKeys.calendarExportToken,
    queryFn: () => fetchCalendarExportToken(),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateCalendar() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: sharedQueryKeys.calendar });
}

export function useCreateCalendarEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => createCalendarEvent(body),
    onSuccess: invalidate,
  });
}

export function useDeleteCalendarEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (id: string) => deleteCalendarEvent(id),
    onSuccess: invalidate,
  });
}

export function useRemindCalendarEvent() {
  return useMutation({
    mutationFn: (id: string) => remindCalendarEvent(id),
  });
}

export function useCreateCalendarSubscription() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (input: { name: string; url: string }) => createCalendarSubscription(input),
    onSuccess: invalidate,
  });
}

export function useImportCalendarSubscription() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (id: string) => importCalendarSubscription(id),
    onSuccess: invalidate,
  });
}

export function useCreateCalendarExportToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createCalendarExportToken(),
    onSuccess: (created) => queryClient.setQueryData(queryKeys.calendarExportToken, created),
  });
}

export function useRevokeCalendarExportToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revokeCalendarExportToken(),
    onSuccess: () => queryClient.setQueryData(queryKeys.calendarExportToken, null),
  });
}
