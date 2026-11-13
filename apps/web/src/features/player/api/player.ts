import { apiJson } from '#lib/api';
import type { PlayerView } from '../types/player';


async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch {
    return null;
  }
}

export function fetchPlayerView(courseId: string, cmId: string) {
  return probe<PlayerView>(`/api/v1/courses/${courseId}/player/${cmId}`);
}

export async function markPlayerModuleLearned(
  courseId: string | undefined,
  cmId: string | undefined,
) {
  const mine = await probe<{ course: { userId: string } }>(
    `/api/v1/courses/${courseId}/completion/me`,
  );
  const userId = mine?.course.userId;
  if (!userId) throw new Error('no user');
  await apiJson(`/api/v1/courses/${courseId}/modules/${cmId}/completion/manual`, {
    method: 'POST',
    body: JSON.stringify({ userId, complete: true }),
  });
}
