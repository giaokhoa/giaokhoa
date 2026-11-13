import type {
  Cohort,
  Course,
  CourseCompletion,
  CourseGroup,
  CourseGrouping,
  EnrolInstance,
  UserEnrolment,
} from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type { CourseConversationView, MemberRow } from '../types/course-admin';


export function fetchCourseGroups(courseId: string) {
  return apiJson<CourseGroup[]>(`/api/v1/courses/${courseId}/groups`);
}

export function fetchCourseGroupings(courseId: string) {
  return apiJson<CourseGrouping[]>(`/api/v1/courses/${courseId}/groupings`);
}

export function fetchCohorts() {
  return apiJson<Cohort[]>('/api/v1/cohorts');
}

export function fetchCourseEnrolInstances(courseId: string) {
  return apiJson<EnrolInstance[]>(`/api/v1/courses/${courseId}/enrol/instances`);
}

export function fetchCourseEnrolments(courseId: string) {
  return apiJson<UserEnrolment[]>(`/api/v1/courses/${courseId}/enrolments`);
}

export function fetchCourseCompletions(courseId: string) {
  return apiJson<CourseCompletion[]>(`/api/v1/courses/${courseId}/completion`);
}

export function fetchCourseDetail(courseId: string) {
  return apiJson<Course>(`/api/v1/courses/${courseId}`);
}

export function fetchCourseConversation(courseId: string) {
  return apiJson<CourseConversationView>(`/api/v1/messages/courses/${courseId}/conversation`);
}

export function fetchCourseGroupMembers(courseId: string, groupId: string) {
  return apiJson<MemberRow[]>(`/api/v1/courses/${courseId}/groups/${groupId}/members`);
}

export function fetchCourseGroupingGroups(courseId: string, groupingId: string) {
  return apiJson<CourseGroup[]>(`/api/v1/courses/${courseId}/groupings/${groupingId}/groups`);
}

export function fetchCohortMembers(cohortId: string) {
  return apiJson<MemberRow[]>(`/api/v1/cohorts/${cohortId}/members`);
}

export function createCourseGroup(courseId: string, name: string) {
  return apiJson(`/api/v1/courses/${courseId}/groups`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function renameCourseGroup(courseId: string, input: { groupId: string; name: string }) {
  return apiJson(`/api/v1/courses/${courseId}/groups/${input.groupId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: input.name }),
  });
}

export function deleteCourseGroup(courseId: string, groupId: string) {
  return apiJson(`/api/v1/courses/${courseId}/groups/${groupId}`, { method: 'DELETE' });
}

export function addCourseGroupMember(
  courseId: string,
  input: { groupId: string; userId: string },
) {
  return apiJson(`/api/v1/courses/${courseId}/groups/${input.groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId: input.userId }),
  });
}

export function removeCourseGroupMember(
  courseId: string,
  input: { groupId: string; userId: string },
) {
  return apiJson(`/api/v1/courses/${courseId}/groups/${input.groupId}/members/${input.userId}`, {
    method: 'DELETE',
  });
}

export function saveCourseGroupMode(
  courseId: string,
  body: { groupMode: number; groupModeForce: boolean },
) {
  return apiJson(`/api/v1/courses/${courseId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function toggleCourseConversation(input: { conversationId: string; enabled: boolean }) {
  return apiJson<CourseConversationView>(`/api/v1/messages/conversations/${input.conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: input.enabled }),
  });
}

export function openGroupConversation(groupId: string) {
  return apiJson<{ id: string }>('/api/v1/messages/conversations/group', {
    method: 'POST',
    body: JSON.stringify({ groupId }),
  });
}

export function createCourseGrouping(
  courseId: string,
  body: { name: string; idNumber?: string; description?: string },
) {
  return apiJson(`/api/v1/courses/${courseId}/groupings`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteCourseGrouping(courseId: string, groupingId: string) {
  return apiJson(`/api/v1/courses/${courseId}/groupings/${groupingId}`, { method: 'DELETE' });
}

export function addGroupToGrouping(
  courseId: string,
  input: { groupingId: string; groupId: string },
) {
  return apiJson(`/api/v1/courses/${courseId}/groupings/${input.groupingId}/groups`, {
    method: 'POST',
    body: JSON.stringify({ groupId: input.groupId }),
  });
}

export function addCohortMember(input: { cohortId: string; userId: string }) {
  return apiJson(`/api/v1/cohorts/${input.cohortId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId: input.userId }),
  });
}

export function removeCohortMember(input: { cohortId: string; userId: string }) {
  return apiJson(`/api/v1/cohorts/${input.cohortId}/members/${input.userId}`, {
    method: 'DELETE',
  });
}

export async function enrolUserManually(
  courseId: string,
  input: { manualInstanceId: string | null; userId: string },
) {
  let instanceId = input.manualInstanceId;
  if (!instanceId) {
    const created = await apiJson<EnrolInstance>(`/api/v1/courses/${courseId}/enrol/instances`, {
      method: 'POST',
      body: JSON.stringify({ method: 'manual' }),
    });
    instanceId = created.id;
  }
  await apiJson(`/api/v1/courses/${courseId}/enrol/instances/${instanceId}/enrol`, {
    method: 'POST',
    body: JSON.stringify({ userId: input.userId }),
  });
}

export function toggleEnrolSuspend(courseId: string, ue: UserEnrolment) {
  const action = ue.status === 1 ? 'reactivate' : 'suspend';
  return apiJson(
    `/api/v1/courses/${courseId}/enrol/instances/${ue.enrolId}/users/${ue.userId}/${action}`,
    { method: 'POST' },
  );
}
