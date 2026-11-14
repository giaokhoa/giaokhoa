import type {
  QuestionCategory, QuestionUsage, QuestionView, RichTextDocument, StimulusView, SystemBankPackage,
} from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type {
  AttributionLite,
  BankKindParam,
  BankLite,
  ContributionLite,
  ContributionReviewVars,
  DiscoveryItemLite,
  DossierSpecLite,
  EditorQuestionVersion,
  ExamContributionLite,
  ExamDossierLite,
  MatrixContributionLite,
  MatrixLite,
  PaperSummaryLite,
  PinnedQuestionVersion,
  QuestionCurriculumLinksView,
} from '../types/questions';


async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch {
    return null;
  }
}

export interface SystemSharedExamSummary {
  id: string;
  name: string;
  sourceExamId: string;
  sourceVersionNumber: number;
  grade: number | null;
  examKind: string | null;
  totalScore: number;
  durationMinutes: number | null;
  slotCount: number;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  createdAt: string;
  rejectionReason: string | null;
}

export function forkSharedExam(id: string) {
  return apiJson<{ paperId: string; versionId: string; sourceExamVersionId: string; questionIds: string[] }>(
    `/api/v1/system-bank/exams/${id}/fork`, { method: 'POST' });
}

export function withdrawSharedExam(id: string, reason: string) {
  return apiJson<SystemSharedExamSummary>(`/api/v1/system-bank/exams/${id}/withdraw`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
}

export function fetchSharedExams(courseId: string) {
  return apiJson<SystemSharedExamSummary[]>(`/api/v1/system-bank/exams?courseId=${encodeURIComponent(courseId)}`);
}

export function fetchUsedSharedExams() {
  return apiJson<SystemSharedExamSummary[]>('/api/v1/system-bank/exams/used');
}

export function fetchSharedExamSubmissions(scope: 'mine' | 'pending' | 'approved') {
  return apiJson<SystemSharedExamSummary[]>(`/api/v1/system-bank/exams/${scope}`);
}

export function submitSharedExam(examId: string) {
  return apiJson<SystemSharedExamSummary>('/api/v1/system-bank/exams', {
    method: 'POST', body: JSON.stringify({ examId }),
  });
}

export function approveSharedExam(id: string) {
  return apiJson<SystemSharedExamSummary>(`/api/v1/system-bank/exams/${id}/approve`, { method: 'POST' });
}

export function rejectSharedExam(id: string, reason: string) {
  return apiJson<SystemSharedExamSummary>(`/api/v1/system-bank/exams/${id}/reject`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
}

export function fetchSharedExamForReview(id: string) {
  return apiJson<{ package: import('@giaokhoa/contracts').SystemExamPackage }>(`/api/v1/system-bank/exams/${id}`);
}

export function assignSharedExam(courseId: string, body: {
  sharedExamVersionId: string; requestId: string; sectionId: string;
  targetGroupId?: string; timeOpen?: string | null; timeClose?: string | null;
  name?: string; variantCount?: number;
}) {
  return apiJson<{ id: string }>(`/api/v1/courses/${courseId}/exam-pins`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

export interface SystemQuestionSubmission {
  id: string;
  centreSlug: string;
  sourceQuestionId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  qtype: string;
  package: SystemBankPackage;
  checksum: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedBy: string;
  reviewedBy: string | null;
  rejectionReason: string | null;
  publishedQuestionId: string | null;
  publishedVersion: number | null;
  createdAt: string;
}

export interface SystemSubmissionSource {
  id: string;
  qtype: string;
  questionText: RichTextDocument;
  version: number;
}

export function fetchSystemSubmissionSources() {
  return apiJson<SystemSubmissionSource[]>('/api/v1/system-bank/submissions/sources');
}

export function fetchSystemQuestionSubmissions(scope: 'mine' | 'pending') {
  return apiJson<SystemQuestionSubmission[]>(`/api/v1/system-bank/submissions/${scope}`);
}

export function submitSystemQuestion(questionId: string, license?: string) {
  return apiJson<SystemQuestionSubmission>('/api/v1/system-bank/submissions', {
    method: 'POST', body: JSON.stringify({ questionId, ...(license?.trim() ? { license: license.trim() } : {}) }),
  });
}

export function approveSystemQuestionSubmission(id: string) {
  return apiJson<SystemQuestionSubmission>(`/api/v1/system-bank/submissions/${id}/approve`, { method: 'POST' });
}

export function rejectSystemQuestionSubmission(id: string, reason: string) {
  return apiJson<SystemQuestionSubmission>(`/api/v1/system-bank/submissions/${id}/reject`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
}

export interface SystemPublishedQuestion {
  id: string;
  qtype: 'multichoice' | 'truefalse' | 'shortanswer' | 'essay';
  status: 'published' | 'withdrawn';
  createdAt: string;
  versions: Array<{ version: number; checksum: string; createdAt: string }>;
}

export interface SystemPublishedDiscovery {
  items: SystemPublishedQuestion[];
  total: number;
  limit: number;
  offset: number;
}

export interface SystemPublishedVersion {
  id: string;
  version: number;
  checksum: string;
  package: SystemQuestionSubmission['package'];
}

export interface SystemUsedQuestion {
  questionId: string;
  sourceQuestionId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  packageChecksum: string;
  kind: 'pristine' | 'derived';
  sourceStatus: 'published' | 'withdrawn' | 'unavailable';
  latestVersionNumber: number | null;
  hasNewVersion: boolean;
}

export { fetchSystemQuestionEvents, acknowledgeSystemQuestionEvent } from '#lib/system-resource-events';
export type { SystemQuestionEvent } from '#lib/system-resource-events';

export function fetchUsedSystemQuestions() {
  return apiJson<SystemUsedQuestion[]>('/api/v1/system-bank/imports');
}

export function fetchSystemPublishedQuestions(params: { qtype?: string; offset?: number; limit?: number }) {
  const search = new URLSearchParams();
  if (params.qtype) search.set('qtype', params.qtype);
  search.set('offset', String(params.offset ?? 0));
  search.set('limit', String(params.limit ?? 20));
  return apiJson<SystemPublishedDiscovery>(`/api/v1/system-bank/discovery?${search.toString()}`);
}

export function fetchSystemPublishedVersion(questionId: string, version: number) {
  return apiJson<SystemPublishedVersion>(`/api/v1/system-bank/questions/${questionId}/versions/${version}`);
}

export function importSystemPublishedQuestion(questionId: string, version: number) {
  return apiJson<unknown>('/api/v1/system-bank/import', {
    method: 'POST',
    body: JSON.stringify({ sourceQuestionId: questionId, sourceVersionNumber: version }),
  });
}


export function fetchQuestionCategories() {
  return apiJson<QuestionCategory[]>('/api/v1/questions/categories');
}

export function fetchCategoryQuestions(categoryId: string) {
  return apiJson<QuestionView[]>(`/api/v1/questions/categories/${categoryId}/questions`);
}

export function fetchCategoryStimuli(categoryId: string) {
  return apiJson<StimulusView[]>(`/api/v1/stimuli?categoryId=${categoryId}`);
}


const BANK_KIND_SUFFIX: Record<BankKindParam, string> = {
  question: '',
  matrix: '?kind=matrix',
  exam: '?kind=exam',
};

export function fetchQuestionBanks(kind: BankKindParam) {
  return probe<BankLite[]>(`/api/v1/question-banks${BANK_KIND_SUFFIX[kind]}`);
}

export async function fetchMyBankQuestions(bank: BankLite): Promise<QuestionView[]> {
  const all: QuestionView[] = [];
  for (const categoryId of bank.categoryIds) {
    const rows = await probe<QuestionView[]>(`/api/v1/questions/categories/${categoryId}/questions`);
    if (rows) all.push(...rows);
  }
  return all;
}

export function fetchBankMatrices(bankId: string) {
  return probe<MatrixLite[]>(`/api/v1/question-banks/${bankId}/matrices`);
}

export function fetchBankMatrixContributions(bankId: string) {
  return probe<MatrixContributionLite[]>(`/api/v1/question-banks/${bankId}/matrix-contributions?status=pending`);
}

export function fetchBankQuestionContributions(bankId: string) {
  return probe<ContributionLite[]>(`/api/v1/question-banks/${bankId}/contributions?status=pending`);
}

export function fetchBankExams(bankId: string) {
  return probe<PaperSummaryLite[]>(`/api/v1/exams/banks/${bankId}/exams`);
}

export function fetchBankExamContributions(bankId: string) {
  return probe<ExamContributionLite[]>(`/api/v1/exams/banks/${bankId}/contributions`);
}

export function fetchBankDossiers(bankId: string) {
  return probe<ExamDossierLite[]>(`/api/v1/exams/banks/${bankId}/dossiers`);
}

export function fetchMyDossiers() {
  return probe<ExamDossierLite[]>('/api/v1/exams/dossiers/mine');
}


export function fetchQuestionAttribution(questionId: string) {
  return apiJson<AttributionLite>(`/api/v1/questions/${questionId}/attribution`);
}

export function fetchQuestionVersions(questionId: string) {
  return apiJson<{ version: number; questionText: RichTextDocument }[]>(`/api/v1/questions/${questionId}/versions`);
}

export function fetchQuestionDetail(questionId: string) {
  return apiJson<QuestionView>(`/api/v1/questions/${questionId}`);
}

export function fetchQuestionDiscovery(params: string) {
  return apiJson<DiscoveryItemLite[]>(`/api/v1/questions/discovery?${params}`);
}


export function fetchQuestionCurriculumLinks(questionId: string) {
  return apiJson<QuestionCurriculumLinksView>(`/api/v1/questions/${questionId}/curriculum-links`);
}

export function fetchEditorQuestionVersions(questionId: string) {
  return apiJson<EditorQuestionVersion[]>(`/api/v1/questions/${questionId}/versions`);
}

export function setQuestionStatus(questionId: string, status: 'draft' | 'ready') {
  return apiJson(`/api/v1/questions/${questionId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function updateQuestionContent(questionId: string, body: Record<string, unknown>) {
  return apiJson<QuestionView>(`/api/v1/questions/${questionId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function createQuestion(body: Record<string, unknown>) {
  return apiJson<QuestionView>('/api/v1/questions', { method: 'POST', body: JSON.stringify(body) });
}

export function attachQuestionSubject(questionId: string, subjectId: string) {
  return apiJson<QuestionCurriculumLinksView>(`/api/v1/questions/${questionId}/subjects`, {
    method: 'POST',
    body: JSON.stringify({ subjectId }),
  });
}

export function detachQuestionSubject(questionId: string, subjectId: string) {
  return apiJson<QuestionCurriculumLinksView>(`/api/v1/questions/${questionId}/subjects/${subjectId}`, {
    method: 'DELETE',
  });
}

export function attachQuestionOutcome(questionId: string, outcomeId: string, cognitiveLevel: string) {
  return apiJson<QuestionCurriculumLinksView>(`/api/v1/questions/${questionId}/outcomes`, {
    method: 'POST',
    body: JSON.stringify({ outcomeId, cognitiveLevel }),
  });
}

export function updateQuestionOutcomeLink(questionId: string, outcomeId: string, cognitiveLevel: string) {
  return apiJson<QuestionCurriculumLinksView>(`/api/v1/questions/${questionId}/outcomes/${outcomeId}`, {
    method: 'PATCH',
    body: JSON.stringify({ cognitiveLevel }),
  });
}

export function detachQuestionOutcome(questionId: string, outcomeId: string) {
  return apiJson<QuestionCurriculumLinksView>(`/api/v1/questions/${questionId}/outcomes/${outcomeId}`, {
    method: 'DELETE',
  });
}


export function copyMatrixToMyBank(matrixId: string) {
  return apiJson(`/api/v1/exam-matrices/${matrixId}/copy`, { method: 'POST', body: '{}' });
}

export function deleteMatrix(matrixId: string) {
  return apiJson(`/api/v1/exam-matrices/${matrixId}`, { method: 'DELETE' });
}

export function proposeMatrixContribution(matrixId: string, targetBankId: string) {
  return apiJson(`/api/v1/exam-matrices/${matrixId}/contributions`, {
    method: 'POST',
    body: JSON.stringify({ targetBankId }),
  });
}

export function reviewMatrixContribution(bankId: string, vars: ContributionReviewVars) {
  return vars.approve
    ? apiJson(`/api/v1/question-banks/${bankId}/matrix-contributions/${vars.contributionId}/approve`, {
        method: 'POST',
        body: '{}',
      })
    : apiJson(`/api/v1/question-banks/${bankId}/matrix-contributions/${vars.contributionId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: vars.reason ?? '' }),
      });
}

export function proposeExamDossierContribution(bankId: string, examId: string) {
  return apiJson(`/api/v1/exams/banks/${bankId}/contributions`, {
    method: 'POST',
    body: JSON.stringify({ examId, withDossier: true }),
  });
}

export function fetchExamDossierSpec(dossierId: string) {
  return apiJson<DossierSpecLite>(`/api/v1/exams/dossiers/${dossierId}/specification`);
}

export function copyExamPaper(paperId: string) {
  return apiJson(`/api/v1/exams/${paperId}/copy`, { method: 'POST', body: '{}' });
}

export function setExamPaperStatus(paperId: string, status: 'ready' | 'hidden' | 'draft') {
  return apiJson(`/api/v1/exams/${paperId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function deleteExamPaper(paperId: string) {
  return apiJson(`/api/v1/exams/${paperId}`, { method: 'DELETE' });
}

export function proposeExamPaperContribution(bankId: string, paperId: string) {
  return apiJson(`/api/v1/exams/banks/${bankId}/contributions`, {
    method: 'POST',
    body: JSON.stringify({ examId: paperId }),
  });
}

export function reviewExamPaperContribution(input: {
  bankId: string;
  contributionId: string;
  action: 'approve' | 'reject';
  reason?: string;
}) {
  return input.action === 'approve'
    ? apiJson(`/api/v1/exams/banks/${input.bankId}/contributions/${input.contributionId}/${input.action}`, {
        method: 'POST',
        body: '{}',
      })
    : apiJson(`/api/v1/exams/banks/${input.bankId}/contributions/${input.contributionId}/${input.action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: input.reason ?? '' }),
      });
}

export function deployExamPin(courseId: string, body: Record<string, unknown>) {
  return apiJson<{ id: string }>(`/api/v1/courses/${courseId}/exam-pins`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function copyQuestionToMyBank(questionId: string) {
  return apiJson(`/api/v1/questions/${questionId}/copy`, { method: 'POST', body: '{}' });
}

export function proposeQuestionContribution(bankId: string, questionId: string) {
  return apiJson(`/api/v1/question-banks/${bankId}/contributions`, {
    method: 'POST',
    body: JSON.stringify({ questionId }),
  });
}

export function reviewQuestionContribution(bankId: string, vars: ContributionReviewVars) {
  return vars.approve
    ? apiJson(`/api/v1/question-banks/${bankId}/contributions/${vars.contributionId}/approve`, {
        method: 'POST',
        body: '{}',
      })
    : apiJson(`/api/v1/question-banks/${bankId}/contributions/${vars.contributionId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: vars.reason ?? '' }),
      });
}

export function deleteBankQuestion(questionId: string) {
  return apiJson(`/api/v1/questions/${questionId}`, { method: 'DELETE' });
}

export function restoreQuestion(questionId: string) {
  return apiJson(`/api/v1/questions/${questionId}/restore`, { method: 'POST', body: '{}' });
}

export function withdrawQuestion(questionId: string, reason: string) {
  return apiJson(`/api/v1/questions/${questionId}/withdraw`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function updateStimulus(stimulusId: string, content: RichTextDocument | string) {
  return apiJson(`/api/v1/stimuli/${stimulusId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

export function createStimulus(categoryId: string, content: RichTextDocument | string) {
  return apiJson('/api/v1/stimuli', { method: 'POST', body: JSON.stringify({ categoryId, content }) });
}

export function deleteStimulus(stimulusId: string) {
  return apiJson(`/api/v1/stimuli/${stimulusId}`, { method: 'DELETE' });
}

export function createQuestionCategory(body: { name: string; contextId: string }) {
  return apiJson('/api/v1/questions/categories', { method: 'POST', body: JSON.stringify(body) });
}

export function createQuestionUsage(body: { component: string; slots: { questionId: string }[] }) {
  return apiJson<QuestionUsage>('/api/v1/question-usages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}


export function fetchQuestionUsage(usageId: string) {
  return apiJson<QuestionUsage>(`/api/v1/question-usages/${usageId}`);
}

export function fetchPinnedQuestionVersions(questionId: string) {
  return apiJson<PinnedQuestionVersion[]>(`/api/v1/questions/${questionId}/versions`);
}

export function fetchStimulusDetail(stimulusId: string) {
  return apiJson<StimulusView>(`/api/v1/stimuli/${stimulusId}`);
}

export function startQuestionUsage(usageId: string) {
  return apiJson(`/api/v1/question-usages/${usageId}/start`, { method: 'POST', body: '{}' });
}

export function finishQuestionUsage(usageId: string) {
  return apiJson(`/api/v1/question-usages/${usageId}/finish`, { method: 'POST', body: '{}' });
}

export function startUsageAttempt(usageId: string, attemptId: string) {
  return apiJson(`/api/v1/question-usages/${usageId}/attempts/${attemptId}/start`, {
    method: 'POST',
    body: '{}',
  });
}

export function submitUsageAttempt(usageId: string, attemptId: string, response: string | null) {
  return apiJson(`/api/v1/question-usages/${usageId}/attempts/${attemptId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ response }),
  });
}

export function finishUsageAttempt(usageId: string, attemptId: string) {
  return apiJson(`/api/v1/question-usages/${usageId}/attempts/${attemptId}/finish`, {
    method: 'POST',
    body: '{}',
  });
}
