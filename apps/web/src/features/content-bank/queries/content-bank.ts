import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiJson } from '#lib/api';
import {
  fetchCurricula, fetchSubjects, fetchSystemContextId, fetchTree,
  type CurriculumSubject,
} from '#lib/curriculum';
import {
  createItem, deleteItem, fetchItem, fetchItemFileUrl, fetchItems, fetchSpaces, insertItem, reviewItem,
  submitItem, updateItem, uploadItemFile,
} from '../api/content-bank';
import type { FlatNode, LibraryItemInput, QuestionCategoryView, ReviewChecklist } from '../types/content-bank';
import { flattenNodes } from '../utils/content-bank';
import { queryKeys } from './keys';



export function contentBankSpacesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.contentBankSpaces,
    queryFn: () => fetchSpaces(),
    staleTime: 0,
  });
}

export function contentBankItemsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.contentBankItems,
    queryFn: () => fetchItems(),
    staleTime: 0,
  });
}

export function contentBankItemQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: queryKeys.contentBankItem(itemId),
    queryFn: () => fetchItem(itemId),
    staleTime: 0,
  });
}

export function contentBankItemFileUrlQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: queryKeys.contentBankItemFileUrl(itemId),
    queryFn: () => fetchItemFileUrl(itemId),
    staleTime: 0,
  });
}

export function contentBankSubjectsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.contentBankSubjects,
    queryFn: async () => {
      const systemContextId = await fetchSystemContextId().catch(() => null);
      if (!systemContextId) return [] as CurriculumSubject[];
      return fetchSubjects(systemContextId).catch(() => [] as CurriculumSubject[]);
    },
    staleTime: 0,
  });
}

export function contentBankQuestionCategoriesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.contentBankQuestionCategories,
    queryFn: async () => {
      const systemContextId = await fetchSystemContextId().catch(() => null);
      if (!systemContextId) return [] as QuestionCategoryView[];
      return apiJson<QuestionCategoryView[]>(`/api/v1/questions/categories?contextId=${systemContextId}`)
        .catch(() => [] as QuestionCategoryView[]);
    },
    staleTime: 0,
  });
}

export function contentBankCurriculumNodesQueryOptions(subjectId: string, grade: number) {
  return queryOptions({
    queryKey: queryKeys.contentBankCurriculumNodes(subjectId, grade),
    queryFn: async () => {
      const curricula = await fetchCurricula(subjectId).catch(() => []);
      const curriculum = curricula.find((c) => c.grade === grade);
      if (!curriculum) return [] as FlatNode[];
      const tree = await fetchTree(curriculum.id).catch(() => null);
      return tree ? flattenNodes(tree.nodes) : [];
    },
    staleTime: 0,
  });
}


export function useSubmitContentBankItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => submitItem(itemId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.contentBankItems });
    },
  });
}

export function useDeleteContentBankItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => deleteItem(itemId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.contentBankItems });
    },
  });
}

export function useReviewContentBankItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, decision, note, checklist }: {
      itemId: string;
      decision: 'approved' | 'rejected';
      note?: string;
      checklist?: ReviewChecklist;
    }) => reviewItem(itemId, decision, note, checklist),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.contentBankItems });
    },
  });
}

export function useInsertContentBankItem() {
  return useMutation({
    mutationFn: ({ itemId, courseId, sectionId }: { itemId: string; courseId: string; sectionId: string }) =>
      insertItem(itemId, courseId, sectionId),
  });
}

export function useCreateContentBankItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LibraryItemInput) => createItem(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.contentBankItems });
    },
  });
}

export function useUpdateContentBankItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: Partial<LibraryItemInput> }) => updateItem(itemId, input),
    onSuccess: (_data, { itemId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.contentBankItems });
      void client.invalidateQueries({ queryKey: queryKeys.contentBankItem(itemId) });
    },
  });
}

export function useUploadContentBankItemFile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, fileName, contentBase64, mimeType }: {
      itemId: string;
      fileName: string;
      contentBase64: string;
      mimeType?: string;
    }) => uploadItemFile(itemId, fileName, contentBase64, mimeType),
    onSuccess: (_data, { itemId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.contentBankItems });
      void client.invalidateQueries({ queryKey: queryKeys.contentBankItem(itemId) });
    },
  });
}
