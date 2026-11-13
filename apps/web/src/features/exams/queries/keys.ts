export const queryKeys = {
  systemExamQuestionPreview: (id: string, version: number) => ['exams', 'system-question', id, version] as const,
  systemExamQuestions: (offset: number) => ['exams', 'system-questions', offset] as const,
  examPaperDetail: (paperId: string) => ['exam-papers', paperId] as const,
  examPaperPins: (paperId: string) => ['exam-papers', paperId, 'pins'] as const,
};
