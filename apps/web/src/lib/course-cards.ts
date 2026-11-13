import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COURSE_CARD_COLORS,
  type CourseCardColor,
  type CourseCardPrefView,
} from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import { queryKeys } from '#lib/query-keys';

export const COURSE_CARD_COLOR_HEX: Record<CourseCardColor, string> = {
  red: '#dc2626',
  orange: '#ea580c',
  amber: '#d97706',
  green: '#16a34a',
  teal: '#0d9488',
  blue: '#2563eb',
  indigo: '#4f46e5',
  violet: '#7c3aed',
  pink: '#db2777',
  slate: '#64748b',
};

export { COURSE_CARD_COLORS };
export type { CourseCardColor, CourseCardPrefView };

export async function fetchCourseCardPrefs(): Promise<Map<string, CourseCardPrefView>> {
  const data = await apiJson<{ prefs: CourseCardPrefView[] }>('/api/v1/dashboard/course-cards');
  return new Map(data.prefs.map((p) => [p.courseId, p]));
}

export function useCourseCardPrefs() {
  return useQuery({
    queryKey: queryKeys.courseCards,
    queryFn: fetchCourseCardPrefs,
  });
}

export async function saveCourseCardPref(
  courseId: string,
  body: { color: CourseCardColor | null; nickname: string | null },
): Promise<CourseCardPrefView> {
  return apiJson<CourseCardPrefView>(`/api/v1/dashboard/course-cards/${courseId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function useSaveCourseCardPref() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      courseId: string;
      body: { color: CourseCardColor | null; nickname: string | null };
    }) => saveCourseCardPref(vars.courseId, vars.body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.courseCards }),
  });
}

export function displayCourseName(pref: CourseCardPrefView | undefined, fullName: string): string {
  return pref?.nickname?.trim() ? pref.nickname : fullName;
}
