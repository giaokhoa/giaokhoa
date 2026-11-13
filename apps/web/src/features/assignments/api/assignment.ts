import type {
  AssignSubmissionDetail,
  AssignSubmissionSummary,
  AssignmentForUserView,
  TeacherCommentBankEntryView,
} from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type { AssignmentWriteBody } from '../types/assignment';


export function fetchAssignment(assignmentId: string) {
  return apiJson<AssignmentForUserView>(`/api/v1/assignments/${assignmentId}`);
}

export function fetchAssignmentSubmissions(assignmentId: string) {
  return apiJson<AssignSubmissionSummary[]>(`/api/v1/assignments/${assignmentId}/submissions`);
}

export function fetchSubmissionDetail(assignmentId: string, userId: string) {
  return apiJson<AssignSubmissionDetail>(
    `/api/v1/assignments/${assignmentId}/submissions/${userId}`,
  );
}

export function fetchCommentBank() {
  return apiJson<TeacherCommentBankEntryView[]>('/api/v1/assign-comment-bank');
}

export function fetchCurrentUser() {
  return apiJson<{ id: string }>('/api/v1/users/me');
}

export function releaseSubmissionsBatch(assignmentId: string) {
  return apiJson<{ releasedCount: number; skippedUserIds: string[] }>(
    `/api/v1/assignments/${assignmentId}/release-batch`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export function gradeSubmission(input: {
  assignmentId: string;
  userId: string;
  body: AssignmentWriteBody;
}) {
  return apiJson(`/api/v1/assignments/${input.assignmentId}/submissions/${input.userId}/grade`, {
    method: 'POST',
    body: JSON.stringify(input.body),
  });
}

export function addSubmissionAnnotation(input: {
  assignmentId: string;
  userId: string;
  body: AssignmentWriteBody;
}) {
  return apiJson(
    `/api/v1/assignments/${input.assignmentId}/submissions/${input.userId}/annotations`,
    { method: 'POST', body: JSON.stringify(input.body) },
  );
}

export function deleteSubmissionAnnotation(input: {
  assignmentId: string;
  userId: string;
  annotationId: string;
}) {
  return apiJson(
    `/api/v1/assignments/${input.assignmentId}/submissions/${input.userId}/annotations/${input.annotationId}`,
    { method: 'DELETE' },
  );
}

export function releaseSubmission(input: { assignmentId: string; userId: string }) {
  return apiJson(`/api/v1/assignments/${input.assignmentId}/submissions/${input.userId}/release`, {
    method: 'POST',
  });
}

export function createCommentBankEntry(body: { category: string; text: string }) {
  return apiJson<TeacherCommentBankEntryView>('/api/v1/assign-comment-bank', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function postFeedbackMessage(input: {
  assignmentId: string;
  userId: string;
  body: string;
}) {
  return apiJson(
    `/api/v1/assignments/${input.assignmentId}/submissions/${input.userId}/messages`,
    { method: 'POST', body: JSON.stringify({ body: input.body }) },
  );
}

export function uploadSubmissionFile(input: { assignmentId: string; formData: FormData }) {
  return apiJson(`/api/v1/assignments/${input.assignmentId}/submission/files`, {
    method: 'POST',
    body: input.formData,
  });
}

export function deleteSubmissionFile(input: { assignmentId: string; fileId: string }) {
  return apiJson(`/api/v1/assignments/${input.assignmentId}/submission/files/${input.fileId}`, {
    method: 'DELETE',
  });
}

export function submitSubmission(assignmentId: string) {
  return apiJson(`/api/v1/assignments/${assignmentId}/submission/submit`, { method: 'POST' });
}

export function reopenSubmission(assignmentId: string) {
  return apiJson(`/api/v1/assignments/${assignmentId}/submission/reopen`, { method: 'POST' });
}

export function updateAssignment(input: { assignmentId: string; body: AssignmentWriteBody }) {
  return apiJson(`/api/v1/assignments/${input.assignmentId}`, {
    method: 'PATCH',
    body: JSON.stringify(input.body),
  });
}

export function saveAssignmentRubric(input: { assignmentId: string; body: AssignmentWriteBody }) {
  return apiJson(`/api/v1/assignments/${input.assignmentId}/rubric`, {
    method: 'PUT',
    body: JSON.stringify(input.body),
  });
}

export function deleteAssignment(assignmentId: string) {
  return apiJson(`/api/v1/assignments/${assignmentId}`, { method: 'DELETE' });
}
