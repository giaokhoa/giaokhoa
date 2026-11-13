import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { QuestionView, RichTextDocument } from '@giaokhoa/contracts';
import { queryClient } from '#lib/query-client';
import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  attachQuestionOutcome,
  attachQuestionSubject,
  copyExamPaper,
  copyMatrixToMyBank,
  copyQuestionToMyBank,
  createQuestion,
  createQuestionCategory,
  createQuestionUsage,
  createStimulus,
  deleteBankQuestion,
  deleteExamPaper,
  deleteMatrix,
  deleteStimulus,
  deployExamPin,
  detachQuestionOutcome,
  detachQuestionSubject,
  fetchBankDossiers,
  fetchBankExamContributions,
  fetchBankExams,
  fetchBankMatrices,
  fetchBankMatrixContributions,
  fetchBankQuestionContributions,
  fetchCategoryQuestions,
  fetchCategoryStimuli,
  fetchEditorQuestionVersions,
  fetchExamDossierSpec,
  fetchMyBankQuestions,
  fetchMyDossiers,
  fetchPinnedQuestionVersions,
  fetchQuestionAttribution,
  fetchQuestionBanks,
  fetchQuestionCategories,
  fetchQuestionCurriculumLinks,
  fetchQuestionDetail,
  fetchQuestionDiscovery,
  fetchQuestionUsage,
  fetchQuestionVersions,
  fetchStimulusDetail,
  finishQuestionUsage,
  finishUsageAttempt,
  proposeExamDossierContribution,
  proposeExamPaperContribution,
  proposeMatrixContribution,
  proposeQuestionContribution,
  restoreQuestion,
  reviewExamPaperContribution,
  reviewMatrixContribution,
  reviewQuestionContribution,
  setExamPaperStatus,
  setQuestionStatus,
  startQuestionUsage,
  startUsageAttempt,
  submitUsageAttempt,
  updateQuestionContent,
  updateQuestionOutcomeLink,
  updateStimulus,
  withdrawQuestion,
} from '../api/questions';
import type { BankKindParam, BankLite, ContributionReviewVars } from '../types/questions';
import { queryKeys } from './keys';



export function questionCategoriesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.questionCategories,
    queryFn: () => fetchQuestionCategories(),
  });
}

export function useQuestionCategories(enabled: boolean) {
  return useQuery({ ...questionCategoriesQueryOptions(), enabled });
}

export function categoryQuestionsQueryOptions(categoryId: string) {
  return queryOptions({
    queryKey: queryKeys.categoryQuestions(categoryId),
    queryFn: () => fetchCategoryQuestions(categoryId),
  });
}

export function useCategoryQuestions(categoryId: string, enabled: boolean) {
  return useQuery({ ...categoryQuestionsQueryOptions(categoryId), enabled: enabled && !!categoryId });
}

export function categoryStimuliQueryOptions(categoryId: string) {
  return queryOptions({
    queryKey: queryKeys.categoryStimuli(categoryId),
    queryFn: () => fetchCategoryStimuli(categoryId),
  });
}

export function useCategoryStimuli(categoryId: string, enabled: boolean) {
  return useQuery({ ...categoryStimuliQueryOptions(categoryId), enabled: enabled && !!categoryId });
}


export function questionBanksQueryOptions(kind: BankKindParam) {
  return queryOptions({
    queryKey: sharedQueryKeys.questionBanks(kind),
    queryFn: async () => (await fetchQuestionBanks(kind)) ?? [],
  });
}

export function useQuestionBanks(kind: BankKindParam) {
  return useQuery(questionBanksQueryOptions(kind));
}

export function useMyBankQuestions(bank: BankLite | undefined) {
  return useQuery({
    queryKey: bank
      ? [...queryKeys.myBankQuestions(bank.id), bank.categoryIds.join(',')]
      : ['question-banks', 'none', 'all-questions'],
    queryFn: () => (bank ? fetchMyBankQuestions(bank) : Promise.resolve([] as QuestionView[])),
    enabled: !!bank,
  });
}

export function bankMatricesQueryOptions(bankId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.bankMatrices(bankId),
    queryFn: async () => (await fetchBankMatrices(bankId)) ?? [],
  });
}

export function useBankMatrices(bankId: string | undefined) {
  return useQuery({ ...bankMatricesQueryOptions(bankId ?? ''), enabled: !!bankId });
}

export function bankMatrixContributionsQueryOptions(bankId: string) {
  return queryOptions({
    queryKey: queryKeys.bankMatrixContributions(bankId),
    queryFn: async () => (await fetchBankMatrixContributions(bankId)) ?? [],
  });
}

export function useBankMatrixContributions(bankId: string) {
  return useQuery({ ...bankMatrixContributionsQueryOptions(bankId), enabled: !!bankId });
}

export function bankQuestionContributionsQueryOptions(bankId: string) {
  return queryOptions({
    queryKey: queryKeys.bankQuestionContributions(bankId),
    queryFn: async () => (await fetchBankQuestionContributions(bankId)) ?? [],
  });
}

export function useBankQuestionContributions(bankId: string) {
  return useQuery({ ...bankQuestionContributionsQueryOptions(bankId), enabled: !!bankId });
}

export function bankExamsQueryOptions(bankId: string) {
  return queryOptions({
    queryKey: queryKeys.bankExams(bankId),
    queryFn: async () => (await fetchBankExams(bankId)) ?? [],
  });
}

export function useBankExams(bankId: string | undefined) {
  return useQuery({ ...bankExamsQueryOptions(bankId ?? ''), enabled: !!bankId });
}

export function bankExamContributionsQueryOptions(bankId: string) {
  return queryOptions({
    queryKey: queryKeys.bankExamContributions(bankId),
    queryFn: async () => (await fetchBankExamContributions(bankId)) ?? [],
  });
}

export function useBankExamContributions(bankId: string) {
  return useQuery({ ...bankExamContributionsQueryOptions(bankId), enabled: !!bankId });
}

export function bankDossiersQueryOptions(bankId: string) {
  return queryOptions({
    queryKey: queryKeys.bankDossiers(bankId),
    queryFn: async () => (await fetchBankDossiers(bankId)) ?? [],
  });
}

export function useBankDossiers(bankId: string) {
  return useQuery({ ...bankDossiersQueryOptions(bankId), enabled: !!bankId });
}

export function myDossiersQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.myDossiers,
    queryFn: async () => (await fetchMyDossiers()) ?? [],
  });
}

export function useMyDossiers() {
  return useQuery(myDossiersQueryOptions());
}


export function questionAttributionQueryOptions(questionId: string) {
  return queryOptions({
    queryKey: queryKeys.questionAttribution(questionId),
    queryFn: () => fetchQuestionAttribution(questionId),
  });
}

export function questionVersionsQueryOptions(questionId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.questionVersions(questionId),
    queryFn: () => fetchQuestionVersions(questionId),
  });
}

export function questionDetailQueryOptions(questionId: string) {
  return queryOptions({
    queryKey: queryKeys.questionDetail(questionId),
    queryFn: () => fetchQuestionDetail(questionId),
  });
}

export function questionDiscoveryQueryOptions(params: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.questionDiscovery(params),
    queryFn: () => fetchQuestionDiscovery(params),
  });
}

export function clearQuestionBankListCache(client: QueryClient) {
  client.removeQueries({ queryKey: queryKeys.questionCategories });
  client.removeQueries({ queryKey: queryKeys.questionBanksRoot });
}

export async function questionsPageClientLoader() {
  await Promise.all([
    queryClient.prefetchQuery(questionCategoriesQueryOptions()),
    queryClient.prefetchQuery(questionBanksQueryOptions('question')),
    queryClient.prefetchQuery(questionBanksQueryOptions('matrix')),
    queryClient.prefetchQuery(questionBanksQueryOptions('exam')),
  ]);
  return null;
}


export function questionCurriculumLinksQueryOptions(questionId: string) {
  return queryOptions({
    queryKey: queryKeys.questionCurriculumLinks(questionId),
    queryFn: () => fetchQuestionCurriculumLinks(questionId),
  });
}

export function editorQuestionVersionsQueryOptions(questionId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.questionVersions(questionId),
    queryFn: () => fetchEditorQuestionVersions(questionId),
  });
}

export function useSetQuestionStatus() {
  return useMutation({
    mutationFn: ({ questionId, status }: { questionId: string; status: 'draft' | 'ready' }) =>
      setQuestionStatus(questionId, status),
  });
}

export function useUpdateQuestionContent() {
  return useMutation({
    mutationFn: ({ questionId, body }: { questionId: string; body: Record<string, unknown> }) =>
      updateQuestionContent(questionId, body),
  });
}

export function useCreateQuestion() {
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => createQuestion(body),
  });
}

export function useAttachQuestionSubject() {
  return useMutation({
    mutationFn: ({ questionId, subjectId }: { questionId: string; subjectId: string }) =>
      attachQuestionSubject(questionId, subjectId),
  });
}

export function useDetachQuestionSubject() {
  return useMutation({
    mutationFn: ({ questionId, subjectId }: { questionId: string; subjectId: string }) =>
      detachQuestionSubject(questionId, subjectId),
  });
}

export function useAttachQuestionOutcome() {
  return useMutation({
    mutationFn: ({
      questionId,
      outcomeId,
      cognitiveLevel,
    }: {
      questionId: string;
      outcomeId: string;
      cognitiveLevel: string;
    }) => attachQuestionOutcome(questionId, outcomeId, cognitiveLevel),
  });
}

export function useUpdateQuestionOutcomeLink() {
  return useMutation({
    mutationFn: ({
      questionId,
      outcomeId,
      cognitiveLevel,
    }: {
      questionId: string;
      outcomeId: string;
      cognitiveLevel: string;
    }) => updateQuestionOutcomeLink(questionId, outcomeId, cognitiveLevel),
  });
}

export function useDetachQuestionOutcome() {
  return useMutation({
    mutationFn: ({ questionId, outcomeId }: { questionId: string; outcomeId: string }) =>
      detachQuestionOutcome(questionId, outcomeId),
  });
}


export function useCopyMatrixToMyBank() {
  return useMutation({
    mutationFn: (matrixId: string) => copyMatrixToMyBank(matrixId),
  });
}

export function useDeleteMatrix() {
  return useMutation({
    mutationFn: (matrixId: string) => deleteMatrix(matrixId),
  });
}

export function useProposeMatrixContribution() {
  return useMutation({
    mutationFn: ({ matrixId, targetBankId }: { matrixId: string; targetBankId: string }) =>
      proposeMatrixContribution(matrixId, targetBankId),
  });
}

export function useReviewMatrixContribution() {
  return useMutation({
    mutationFn: ({ bankId, ...vars }: ContributionReviewVars & { bankId: string }) =>
      reviewMatrixContribution(bankId, vars),
  });
}

export function useProposeExamDossierContribution() {
  return useMutation({
    mutationFn: ({ bankId, examId }: { bankId: string; examId: string }) =>
      proposeExamDossierContribution(bankId, examId),
  });
}

export function examDossierSpecQueryOptions(dossierId: string) {
  return queryOptions({
    queryKey: queryKeys.examDossierSpec(dossierId),
    queryFn: () => fetchExamDossierSpec(dossierId),
  });
}

export function useCopyExamPaper() {
  return useMutation({
    mutationFn: (paperId: string) => copyExamPaper(paperId),
  });
}

export function useSetExamPaperStatus() {
  return useMutation({
    mutationFn: ({ paperId, status }: { paperId: string; status: 'ready' | 'hidden' | 'draft' }) =>
      setExamPaperStatus(paperId, status),
  });
}

export function useDeleteExamPaper() {
  return useMutation({
    mutationFn: (paperId: string) => deleteExamPaper(paperId),
  });
}

export function useProposeExamPaperContribution() {
  return useMutation({
    mutationFn: ({ bankId, paperId }: { bankId: string; paperId: string }) =>
      proposeExamPaperContribution(bankId, paperId),
  });
}

export function useReviewExamPaperContribution() {
  return useMutation({
    mutationFn: (input: {
      bankId: string;
      contributionId: string;
      action: 'approve' | 'reject';
      reason?: string;
    }) => reviewExamPaperContribution(input),
  });
}

export function useDeployExamPin() {
  return useMutation({
    mutationFn: ({ courseId, body }: { courseId: string; body: Record<string, unknown> }) =>
      deployExamPin(courseId, body),
  });
}

export function useCopyQuestionToMyBank() {
  return useMutation({
    mutationFn: (questionId: string) => copyQuestionToMyBank(questionId),
  });
}

export function useProposeQuestionContribution() {
  return useMutation({
    mutationFn: ({ bankId, questionId }: { bankId: string; questionId: string }) =>
      proposeQuestionContribution(bankId, questionId),
  });
}

export function useReviewQuestionContribution() {
  return useMutation({
    mutationFn: ({ bankId, ...vars }: ContributionReviewVars & { bankId: string }) =>
      reviewQuestionContribution(bankId, vars),
  });
}

export function useDeleteBankQuestion() {
  return useMutation({
    mutationFn: (questionId: string) => deleteBankQuestion(questionId),
  });
}

export function useRestoreQuestion() {
  return useMutation({
    mutationFn: (questionId: string) => restoreQuestion(questionId),
  });
}

export function useWithdrawQuestion() {
  return useMutation({
    mutationFn: ({ questionId, reason }: { questionId: string; reason: string }) =>
      withdrawQuestion(questionId, reason),
  });
}

export function useUpdateStimulus() {
  return useMutation({
    mutationFn: ({ stimulusId, content }: { stimulusId: string; content: RichTextDocument | string }) =>
      updateStimulus(stimulusId, content),
  });
}

export function useCreateStimulus() {
  return useMutation({
    mutationFn: ({ categoryId, content }: { categoryId: string; content: RichTextDocument | string }) =>
      createStimulus(categoryId, content),
  });
}

export function useDeleteStimulus() {
  return useMutation({
    mutationFn: (stimulusId: string) => deleteStimulus(stimulusId),
  });
}

export function useCreateQuestionCategory() {
  return useMutation({
    mutationFn: (body: { name: string; contextId: string }) => createQuestionCategory(body),
  });
}

export function useCreateQuestionUsage() {
  return useMutation({
    mutationFn: (body: { component: string; slots: { questionId: string }[] }) => createQuestionUsage(body),
  });
}


export function questionUsageQueryOptions(usageId: string) {
  return queryOptions({
    queryKey: queryKeys.questionUsage(usageId),
    queryFn: () => fetchQuestionUsage(usageId),
  });
}

export function useQuestionUsage(usageId: string, enabled: boolean) {
  return useQuery({ ...questionUsageQueryOptions(usageId), enabled });
}

export function pinnedQuestionVersionsQueryOptions(questionId: string) {
  return queryOptions({
    queryKey: sharedQueryKeys.questionVersions(questionId),
    queryFn: () => fetchPinnedQuestionVersions(questionId),
  });
}

export function stimulusDetailQueryOptions(stimulusId: string) {
  return queryOptions({
    queryKey: queryKeys.stimulusDetail(stimulusId),
    queryFn: () => fetchStimulusDetail(stimulusId),
  });
}

function useUsageAction<TVars>(mutationFn: (vars: TVars) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (_data, vars) => {
      const usageId = (vars as { usageId: string }).usageId;
      void client.invalidateQueries({ queryKey: queryKeys.questionUsage(usageId) });
    },
  });
}

export function useStartQuestionUsage() {
  return useUsageAction((vars: { usageId: string }) => startQuestionUsage(vars.usageId));
}

export function useFinishQuestionUsage() {
  return useUsageAction((vars: { usageId: string }) => finishQuestionUsage(vars.usageId));
}

export function useStartUsageAttempt() {
  return useUsageAction((vars: { usageId: string; attemptId: string }) =>
    startUsageAttempt(vars.usageId, vars.attemptId),
  );
}

export function useSubmitUsageAttempt() {
  return useUsageAction((vars: { usageId: string; attemptId: string; response: string | null }) =>
    submitUsageAttempt(vars.usageId, vars.attemptId, vars.response),
  );
}

export function useFinishUsageAttempt() {
  return useUsageAction((vars: { usageId: string; attemptId: string }) =>
    finishUsageAttempt(vars.usageId, vars.attemptId),
  );
}
