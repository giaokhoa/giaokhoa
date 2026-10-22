import { toInstant } from '#lib/http/dates.js';
export function assignmentInput(form: FormData) {
  return {
    audienceMode: form.get('audienceMode'),
    selectedUserIds: form.getAll('selectedUserIds'),
    openAt: toInstant(form.get('openAt')),
    closeAt: toInstant(form.get('closeAt')),
    maxAttempts: Number(form.get('maxAttempts')),
    releaseScoreAt: toInstant(form.get('releaseScoreAt')),
    releaseFeedbackAt: toInstant(form.get('releaseFeedbackAt')),
    releaseSolutionsAt: toInstant(form.get('releaseSolutionsAt')),
  };
}
