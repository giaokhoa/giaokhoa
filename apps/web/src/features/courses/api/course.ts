import type { Course, CourseContent, EnrolInstance } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type {
  ClassMarkersView,
  CoursePageData,
  MyCompletionView,
  MyEnrolmentView,
  MyPaymentView,
  MyProgressView,
} from '../types/course';


async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch {
    return null;
  }
}

export async function fetchCoursePage(courseId: string): Promise<CoursePageData> {
  const [course, instances, enrolment, content] = await Promise.all([
    probe<Course>(`/api/v1/courses/${courseId}`),
    probe<EnrolInstance[]>(`/api/v1/courses/${courseId}/enrol/instances`),
    probe<MyEnrolmentView>(`/api/v1/courses/${courseId}/enrolments/me`),
    probe<CourseContent>(`/api/v1/courses/${courseId}/content`),
  ]);
  let completion: MyCompletionView | null = null;
  let progress: MyProgressView | null = null;
  let classMarkers: ClassMarkersView | null = null;
  if (content) {
    [completion, progress, classMarkers] = await Promise.all([
      probe<MyCompletionView>(`/api/v1/courses/${courseId}/completion/me`),
      probe<MyProgressView>(`/api/v1/courses/${courseId}/progress/me`),
      probe<ClassMarkersView>(`/api/v1/courses/${courseId}/progress/class-markers`),
    ]);
  }
  return {
    course,
    instances: instances ?? [],
    enrolment,
    content,
    completion,
    progress,
    classMarkers,
  };
}

export function fetchMyPayments() {
  return probe<MyPaymentView[]>('/api/v1/payments/me');
}

export function selfEnrolCourse(courseId: string | undefined, instanceId: string) {
  return apiJson(`/api/v1/courses/${courseId}/enrol/instances/${instanceId}/self-enrol`, {
    method: 'POST',
  });
}

export function createFeePayment(instanceId: string) {
  return apiJson(`/api/v1/payments/fee/${instanceId}`, { method: 'POST' });
}

export function setManualCompletion(
  courseId: string | undefined,
  vars: { cmId: string; userId: string; complete: boolean },
) {
  return apiJson(`/api/v1/courses/${courseId}/modules/${vars.cmId}/completion/manual`, {
    method: 'POST',
    body: JSON.stringify({ userId: vars.userId, complete: vars.complete }),
  });
}
