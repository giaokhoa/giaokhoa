import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  addTemplateCohort, addTemplateCompetency, createCompetency, createCompetencyFramework,
  createLearningPlanTemplate, createPlansFromTemplate, fetchCompetencyFrameworks, fetchCompetencyTemplates,
  fetchFrameworkCompetencies, fetchFrameworkExport, fetchLearningPlanDetail, fetchUserCompetencies,
  fetchUserLearningPlans, fetchUserOptions, importCompetencyFramework, planReviewAction, requestCompetencyReview,
  requestPlanReview, usercompReviewAction,
} from '../api/learning-plan';
import type { PlanReviewActionName, UsercompReviewActionName } from '../types/learning-plan';
import { queryKeys } from './keys';


export function userLearningPlansQueryOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.userLearningPlans(userId),
    queryFn: () => fetchUserLearningPlans(userId),
  });
}

export function useUserLearningPlans(userId: string | undefined) {
  return useQuery({
    ...userLearningPlansQueryOptions(userId ?? ''),
    enabled: userId !== undefined,
  });
}

export function learningPlanDetailQueryOptions(planId: string) {
  return queryOptions({
    queryKey: queryKeys.learningPlanDetail(planId),
    queryFn: () => fetchLearningPlanDetail(planId),
  });
}

export function useLearningPlanDetail(selectedPlanId: string | null) {
  return useQuery({
    ...learningPlanDetailQueryOptions(selectedPlanId ?? ''),
    enabled: selectedPlanId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useRequestPlanReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ planId }: { planId: string; userId: string }) => requestPlanReview(planId),
    onSuccess: (_data, vars) =>
      void client.invalidateQueries({ queryKey: queryKeys.userLearningPlans(vars.userId) }),
  });
}

export function useRequestCompetencyReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { usercompId: string; planId: string; description: string }) =>
      requestCompetencyReview(vars.usercompId, vars.description),
    onSuccess: (_data, vars) =>
      void client.invalidateQueries({ queryKey: queryKeys.learningPlanDetail(vars.planId) }),
  });
}


export function competencyFrameworksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.competencyFrameworks,
    queryFn: () => fetchCompetencyFrameworks(),
  });
}

export function useCompetencyFrameworks() {
  return useQuery(competencyFrameworksQueryOptions());
}

export function competencyTemplatesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.competencyTemplates,
    queryFn: () => fetchCompetencyTemplates(),
  });
}

export function useCompetencyTemplates() {
  return useQuery(competencyTemplatesQueryOptions());
}

export function frameworkCompetenciesQueryOptions(frameworkId: string) {
  return queryOptions({
    queryKey: queryKeys.frameworkCompetencies(frameworkId),
    queryFn: () => fetchFrameworkCompetencies(frameworkId),
  });
}

export function useFrameworkCompetencies(selectedFrameworkId: string) {
  return useQuery({
    ...frameworkCompetenciesQueryOptions(selectedFrameworkId),
    enabled: selectedFrameworkId !== '',
    placeholderData: keepPreviousData,
  });
}

export function frameworkExportQueryOptions(frameworkId: string) {
  return queryOptions({
    queryKey: queryKeys.frameworkExport(frameworkId),
    queryFn: () => fetchFrameworkExport(frameworkId),
    staleTime: 0,
  });
}

export function userOptionsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.userOptions,
    queryFn: () => fetchUserOptions(),
  });
}

export function useUserOptions() {
  return useQuery(userOptionsQueryOptions());
}

export function userCompetenciesQueryOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.userCompetencies(userId),
    queryFn: () => fetchUserCompetencies(userId),
  });
}

export function useReviewQueuePlans(queueUserId: string | null) {
  return useQuery({
    ...userLearningPlansQueryOptions(queueUserId ?? ''),
    enabled: queueUserId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useReviewQueueUsercomps(queueUserId: string | null) {
  return useQuery({
    ...userCompetenciesQueryOptions(queueUserId ?? ''),
    enabled: queueUserId !== null,
    placeholderData: keepPreviousData,
  });
}

function invalidateAdminLists(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.competencyFrameworks }),
    client.invalidateQueries({ queryKey: queryKeys.competencyTemplates }),
  ]);
}

function invalidateReviewQueue(client: QueryClient, userId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.userLearningPlans(userId) }),
    client.invalidateQueries({ queryKey: queryKeys.userCompetencies(userId) }),
  ]);
}

export function useCreateCompetencyFramework() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      shortName: string;
      idNumber?: string;
      description?: string;
      scale: { values: string[]; proficient: number[] };
      visible?: boolean;
    }) => createCompetencyFramework(body),
    onSuccess: () => void invalidateAdminLists(client),
  });
}

export function useImportCompetencyFramework() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (doc: unknown) => importCompetencyFramework(doc),
    onSuccess: () => void invalidateAdminLists(client),
  });
}

export function useCreateCompetency() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      frameworkId: string;
      body: { shortName: string; idNumber?: string; description?: string; parentId?: string };
    }) => createCompetency(vars.frameworkId, vars.body),
    onSuccess: (_data, vars) =>
      void client.invalidateQueries({ queryKey: queryKeys.frameworkCompetencies(vars.frameworkId) }),
  });
}

export function useCreateLearningPlanTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { shortName: string; description?: string; dueDate?: string }) =>
      createLearningPlanTemplate(body),
    onSuccess: () => void invalidateAdminLists(client),
  });
}

export function useAddTemplateCompetency() {
  return useMutation({
    mutationFn: (vars: { templateId: string; competencyId: string }) =>
      addTemplateCompetency(vars.templateId, vars.competencyId),
  });
}

export function useAddTemplateCohort() {
  return useMutation({
    mutationFn: (vars: { templateId: string; cohortId: string }) =>
      addTemplateCohort(vars.templateId, vars.cohortId),
  });
}

export function useCreatePlansFromTemplate() {
  return useMutation({
    mutationFn: (vars: { templateId: string }) => createPlansFromTemplate(vars.templateId),
  });
}

export function usePlanReviewAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { planId: string; action: PlanReviewActionName; userId: string }) =>
      planReviewAction(vars.planId, vars.action),
    onSuccess: (_data, vars) => void invalidateReviewQueue(client, vars.userId),
  });
}

export function useUsercompReviewAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { usercompId: string; action: UsercompReviewActionName; userId: string }) =>
      usercompReviewAction(vars.usercompId, vars.action),
    onSuccess: (_data, vars) => void invalidateReviewQueue(client, vars.userId),
  });
}
