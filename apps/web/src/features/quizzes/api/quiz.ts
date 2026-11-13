import type {
  CourseRosterMember,
  PinRegradeLogEntry,
  PinRegradeResult,
  PinVersionUpdatePreview,
  QuestionView,
  ExamPinOverrideView as QuizOverrideView,
} from '@giaokhoa/contracts';
import { extractRichTextPlainText } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type {
  AttemptView,
  ExamPinOverrideFields,
  ExamPinPageData,
  ExamPinSettingsPayload,
  ExamSourceInfo,
  QuizForUser,
  RegradeQuestionVersion,
} from '../types/quiz';


async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch {
    return null;
  }
}

export async function fetchExamPin(pinId: string): Promise<ExamPinPageData> {
  const view = await apiJson<QuizForUser>(`/api/v1/exam-pins/${pinId}`);
  const slotNames: Record<string, string> = {};
  await Promise.all(
    view.quiz.slots.map(async (s) => {
      try {
        if (s.questionId) {
          const q = await apiJson<QuestionView>(`/api/v1/questions/${s.questionId}`);
          slotNames[s.id] = extractRichTextPlainText(q.latestVersion.questionText).slice(0, 120);
        }
      } catch {   }
    }),
  );
  return { view, slotNames };
}

export function fetchExamPinOverrides(pinId: string) {
  return apiJson<QuizOverrideView[]>(`/api/v1/exam-pins/${pinId}/overrides`);
}

export async function fetchExamSource(examId: string): Promise<ExamSourceInfo | null> {
  const view = await probe<{ version: { id: string; version: number; name: string }; paper: { status: string } }>(
    `/api/v1/exams/${examId}`,
  );
  return view
    ? {
        name: view.version.name,
        version: view.version.version,
        currentVersionId: view.version.id,
        status: view.paper.status,
      }
    : null;
}

export function fetchCourseRoster(courseId: string) {
  return probe<{ members: CourseRosterMember[] }>(
    `/api/v1/messages/courses/${courseId}/members?limit=100`,
  );
}

export function fetchQuizAttempt(attemptId: string) {
  return apiJson<AttemptView>(`/api/v1/quiz-attempts/${attemptId}`);
}

export function saveQuizResponse(vars: {
  attemptId: string;
  questionAttemptId: string;
  response: string | null;
}) {
  return apiJson(`/api/v1/quiz-attempts/${vars.attemptId}/responses`, {
    method: 'POST',
    body: JSON.stringify({ questionAttemptId: vars.questionAttemptId, response: vars.response }),
  });
}

export function submitQuizAttempt(attemptId: string) {
  return apiJson(`/api/v1/quiz-attempts/${attemptId}/submit`, { method: 'POST', body: '{}' });
}

export function fetchExamPinRegrades(pinId: string) {
  return apiJson<PinRegradeLogEntry[]>(`/api/v1/exam-pins/${pinId}/regrades`);
}

export function fetchExamPinMyRegrades(pinId: string) {
  return apiJson<PinRegradeLogEntry[]>(`/api/v1/exam-pins/${pinId}/my-regrades`);
}

export function fetchExamPinVersionUpdate(pinId: string) {
  return apiJson<PinVersionUpdatePreview>(`/api/v1/exam-pins/${pinId}/version-update`);
}

export function fetchRegradeQuestionVersions(questionId: string) {
  return apiJson<RegradeQuestionVersion[]>(`/api/v1/questions/${questionId}/versions`);
}

export function updateExamPinSettings(pinId: string, payload: ExamPinSettingsPayload) {
  return apiJson(`/api/v1/exam-pins/${pinId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function applyExamPinVersionUpdate(pinId: string, toExamVersionId: string) {
  return apiJson(`/api/v1/exam-pins/${pinId}/version-update`, {
    method: 'POST',
    body: JSON.stringify({ toExamVersionId }),
  });
}

export function createExamPinOverride(
  pinId: string,
  body: ExamPinOverrideFields & { userId?: string; groupId?: string },
) {
  return apiJson(`/api/v1/exam-pins/${pinId}/overrides`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateExamPinOverride(overrideId: string, fields: ExamPinOverrideFields) {
  return apiJson(`/api/v1/exam-pin-overrides/${overrideId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function deleteExamPinOverride(overrideId: string) {
  return apiJson(`/api/v1/exam-pin-overrides/${overrideId}`, { method: 'DELETE' });
}

export function runExamPinRegrade(
  pinId: string,
  vars: { questionId: string; toVersionId: string; dryRun: boolean },
) {
  return apiJson<PinRegradeResult>(`/api/v1/exam-pins/${pinId}/regrades`, {
    method: 'POST',
    body: JSON.stringify(vars),
  });
}

export function startExamPinAttempt(pinId: string, preview: boolean) {
  return apiJson<{ attempt: { id: string } }>(`/api/v1/exam-pins/${pinId}/attempts`, {
    method: 'POST',
    body: JSON.stringify({ preview }),
  });
}
