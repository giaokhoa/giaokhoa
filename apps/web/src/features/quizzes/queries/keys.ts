export const queryKeys = {
  quizResults: (quizId: string) => ['quizzes', quizId, 'results'] as const,
  examPin: (pinId: string) => ['exam-pins', pinId] as const,
  examPinOverrides: (pinId: string) => ['exam-pins', pinId, 'overrides'] as const,
  examSource: (examId: string) => ['exams', examId] as const,
  courseRosterMembers: (courseId: string) => ['courses', courseId, 'roster-members'] as const,
  examBatches: (pinId: string) => ['exam-batches', pinId] as const,
  examScans: (pinId: string) => ['exam-scans', pinId] as const,
  quizAttempt: (attemptId: string) => ['quiz-attempts', attemptId] as const,
  examPinRegrades: (pinId: string) => ['exam-pins', pinId, 'regrades'] as const,
  examPinMyRegrades: (pinId: string) => ['exam-pins', pinId, 'my-regrades'] as const,
  examPinVersionUpdate: (pinId: string) => ['exam-pins', pinId, 'version-update'] as const,
};
