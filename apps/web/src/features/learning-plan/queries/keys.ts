export const queryKeys = {
  userLearningPlans: (userId: string) => ['competencies', 'plans', 'user', userId] as const,
  learningPlanDetail: (planId: string) => ['competencies', 'plans', planId] as const,
  competencyFrameworks: ['competencies', 'frameworks'] as const,
  competencyTemplates: ['competencies', 'templates'] as const,
  frameworkCompetencies: (frameworkId: string) =>
    ['competencies', 'frameworks', frameworkId, 'competencies'] as const,
  frameworkExport: (frameworkId: string) => ['competencies', 'frameworks', frameworkId, 'export'] as const,
  userCompetencies: (userId: string) => ['competencies', 'usercomp', 'user', userId] as const,
  userOptions: ['users', 'options'] as const,
};
