export const queryKeys = {
  systemMaterials: ['content-bank', 'system-materials'] as const,
  materialSources: ['content-bank', 'material-sources'] as const,
  materialSubmissions: (scope: 'mine' | 'pending') => ['content-bank', 'material-submissions', scope] as const,
  contentBankSpaces: ['content-bank', 'spaces'] as const,
  contentBankItems: ['content-bank', 'items'] as const,
  contentBankItem: (itemId: string) => ['content-bank', 'items', itemId] as const,
  contentBankItemFileUrl: (itemId: string) => ['content-bank', 'items', itemId, 'file-url'] as const,
  contentBankSubjects: ['content-bank', 'subjects'] as const,
  contentBankQuestionCategories: ['content-bank', 'question-categories'] as const,
  contentBankCurriculumNodes: (subjectId: string, grade: number) =>
    ['content-bank', 'curriculum-nodes', subjectId, grade] as const,
};
