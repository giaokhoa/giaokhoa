export const queryKeys = {
  questionBanksByKind: (kind: string) => ['question-banks', kind] as const,
  curriculaBySubject: (subjectId: string) => ['curriculum', 'curricula', subjectId] as const,
  matrixDetail: (matrixId: string) => ['exam-matrices', matrixId] as const,
  matrixAvailability: (matrixId: string) => ['exam-matrices', matrixId, 'availability'] as const,
  matrixSpecification: (matrixId: string) => ['exam-matrices', matrixId, 'specification'] as const,
};
