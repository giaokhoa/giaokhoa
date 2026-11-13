import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TeacherCommentBankEntryView } from '@giaokhoa/contracts';
import {
  addSubmissionAnnotation,
  createCommentBankEntry,
  deleteAssignment,
  deleteSubmissionAnnotation,
  deleteSubmissionFile,
  fetchAssignment,
  fetchAssignmentSubmissions,
  fetchCommentBank,
  fetchCurrentUser,
  fetchSubmissionDetail,
  gradeSubmission,
  postFeedbackMessage,
  releaseSubmission,
  releaseSubmissionsBatch,
  reopenSubmission,
  saveAssignmentRubric,
  submitSubmission,
  updateAssignment,
  uploadSubmissionFile,
} from '../api/assignment';
import type { AssignmentWriteBody } from '../types/assignment';
import { queryKeys } from './keys';


export function assignmentQueryOptions(assignmentId: string) {
  return queryOptions({
    queryKey: queryKeys.assignmentDetail(assignmentId),
    queryFn: () => fetchAssignment(assignmentId),
  });
}

export function useAssignment(assignmentId: string | undefined) {
  return useQuery({
    ...assignmentQueryOptions(assignmentId ?? ''),
    enabled: !!assignmentId,
  });
}


export function assignmentSubmissionsQueryOptions(assignmentId: string) {
  return queryOptions({
    queryKey: queryKeys.assignmentSubmissions(assignmentId),
    queryFn: () => fetchAssignmentSubmissions(assignmentId),
  });
}

export function submissionDetailQueryOptions(assignmentId: string, userId: string) {
  return queryOptions({
    queryKey: queryKeys.submissionDetail(assignmentId, userId),
    queryFn: () => fetchSubmissionDetail(assignmentId, userId),
  });
}

export function commentBankQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.commentBank,
    queryFn: () => fetchCommentBank(),
  });
}

export function currentUserQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.currentUser,
    queryFn: () => fetchCurrentUser(),
  });
}

export function useReleaseSubmissionsBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => releaseSubmissionsBatch(assignmentId),
    onSuccess: (_data, assignmentId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentSubmissions(assignmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentDetail(assignmentId) });
    },
  });
}

export function useGradeSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; userId: string; body: AssignmentWriteBody }) =>
      gradeSubmission(input),
    onSuccess: (_data, { assignmentId, userId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.submissionDetail(assignmentId, userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentSubmissions(assignmentId) });
    },
  });
}

export function useAddSubmissionAnnotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; userId: string; body: AssignmentWriteBody }) =>
      addSubmissionAnnotation(input),
    onSuccess: (_data, { assignmentId, userId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.submissionDetail(assignmentId, userId) });
    },
  });
}

export function useDeleteSubmissionAnnotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; userId: string; annotationId: string }) =>
      deleteSubmissionAnnotation(input),
    onSuccess: (_data, { assignmentId, userId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.submissionDetail(assignmentId, userId) });
    },
  });
}

export function useReleaseSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; userId: string }) => releaseSubmission(input),
    onSuccess: (_data, { assignmentId, userId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.submissionDetail(assignmentId, userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentSubmissions(assignmentId) });
    },
  });
}

export function useCreateCommentBankEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { category: string; text: string }) => createCommentBankEntry(body),
    onSuccess: (created) => {
      queryClient.setQueryData<TeacherCommentBankEntryView[]>(queryKeys.commentBank, (old) =>
        old ? (old.some((entry) => entry.id === created.id) ? old : [...old, created]) : old,
      );
    },
  });
}

export function usePostFeedbackMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; userId: string; body: string }) =>
      postFeedbackMessage(input),
    onSuccess: (_data, { assignmentId, userId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.submissionDetail(assignmentId, userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentDetail(assignmentId) });
    },
  });
}

export function useUploadSubmissionFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; formData: FormData }) => uploadSubmissionFile(input),
    onSuccess: (_data, { assignmentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentDetail(assignmentId) });
    },
  });
}

export function useDeleteSubmissionFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; fileId: string }) => deleteSubmissionFile(input),
    onSuccess: (_data, { assignmentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentDetail(assignmentId) });
    },
  });
}

export function useSubmitSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => submitSubmission(assignmentId),
    onSuccess: (_data, assignmentId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentDetail(assignmentId) });
    },
  });
}

export function useReopenSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => reopenSubmission(assignmentId),
    onSuccess: (_data, assignmentId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentDetail(assignmentId) });
    },
  });
}

export function useUpdateAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; body: AssignmentWriteBody }) =>
      updateAssignment(input),
    onSuccess: (_data, { assignmentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentDetail(assignmentId) });
    },
  });
}

export function useSaveAssignmentRubric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; body: AssignmentWriteBody }) =>
      saveAssignmentRubric(input),
    onSuccess: (_data, { assignmentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentDetail(assignmentId) });
    },
  });
}

export function useDeleteAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => deleteAssignment(assignmentId),
    onSuccess: (_data, assignmentId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentDetail(assignmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignmentSubmissions(assignmentId) });
    },
  });
}
