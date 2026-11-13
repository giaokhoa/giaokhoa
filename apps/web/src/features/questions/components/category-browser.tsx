import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import type { QuestionCategory, QuestionView, RichTextDocument, StimulusView } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { CardContent } from '@giaokhoa/ui/components/card';
import { Checkbox } from '@giaokhoa/ui/components/checkbox';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';

import { useQueryClient } from '@tanstack/react-query';

import { questionVersionsQueryOptions, useCopyQuestionToMyBank, useCreateQuestionUsage, useDeleteBankQuestion, useRestoreQuestion, useWithdrawQuestion } from '../queries/questions';
import type { AttributionLite } from '../types/questions';
import { CollapsibleSection } from '#components/collapsible-section';
import { DataTable, type DataColumn } from '#components/data-table';
import { plainText, QTYPE_LABEL_KEYS, QTYPES, questionExcerpt, type Qtype } from '../utils/shared';

export interface CategoryBrowserProps {
  categories: QuestionCategory[];
  questions: QuestionView[];
  stimuli: StimulusView[];
  attributions: Record<string, AttributionLite>;
  qCategory: string;
  setQCategory: (categoryId: string) => void;
  loading: boolean;
  refreshBanks: () => void;
  refreshCategoryQuestions: () => void;
  setMessage: (message: string | null) => void;
}

export function CategoryBrowser({
  categories,
  questions,
  stimuli,
  attributions,
  qCategory,
  setQCategory,
  loading,
  refreshBanks,
  refreshCategoryQuestions,
  setMessage,
}: CategoryBrowserProps) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copyQuestionMutation = useCopyQuestionToMyBank();
  const deleteQuestionMutation = useDeleteBankQuestion();
  const restoreQuestionMutation = useRestoreQuestion();
  const withdrawQuestionMutation = useWithdrawQuestion();
  const createUsageMutation = useCreateQuestionUsage();
  const [selected, setSelected] = useState<string[]>([]);
  const [versionsOf, setVersionsOf] = useState<{
    questionId: string;
    versions: { version: number; questionText: RichTextDocument }[];
  } | null>(null);

  function stimulusTextOf(view: QuestionView): string {
    if (view.stimulus) return plainText(view.stimulus.content);
    const stimulusId = view.latestVersion.stimulusId;
    if (!stimulusId) return '';
    const found = stimuli.find((s) => s.id === stimulusId);
    return found ? plainText(found.content) : '';
  }

  const questionColumns: DataColumn<QuestionView>[] = [
    {
      id: 'select',
      header: '',
      cell: (view) => (
        <Checkbox
          aria-label={t('selectQuestionForAttempt', { name: questionExcerpt(view) })}
          checked={selected.includes(view.question.id)}
          onCheckedChange={(checked) =>
            setSelected((prev) =>
              checked === true ? [...prev, view.question.id] : prev.filter((qid) => qid !== view.question.id),
            )
          }
        />
      ),
    },
    {
      id: 'excerpt',
      header: t('questionText'),
      cell: (view) => {
        const a = attributions[view.question.id];
        const isCopy = Boolean((view.question as { derivedFromQuestionId?: string | null }).derivedFromQuestionId);
        return (
          <span>
            {questionExcerpt(view)}
            {(view.entry as { status?: string }).status === 'hidden' ? (
              <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">{t('withdrawnBadge')}</span>
            ) : null}
            {isCopy && a ? (
              <span className="block text-xs text-muted-foreground">
                {t('copiedFromLine', { author: a.originalAuthorName ?? '—', bank: a.sourceBankName ?? '—' })}
              </span>
            ) : null}
          </span>
        );
      },
      sortValue: (view) => questionExcerpt(view),
      filterValue: (view) => questionExcerpt(view),
    },
    {
      id: 'qtype',
      header: t('questionType'),
      cell: (view) =>
        t(QTYPE_LABEL_KEYS[(QTYPES as readonly string[]).includes(view.question.qtype) ? (view.question.qtype as Qtype) : 'truefalse']),
      sortValue: (view) => view.question.qtype,
      filterValue: (view) => view.question.qtype,
    },
    {
      id: 'version',
      header: t('version'),
      cell: (view) => (
        <span data-testid={`version-badge-${view.question.id}`} className="rounded bg-secondary px-2 py-0.5 text-xs">
          v{view.entry.latestVersion}
        </span>
      ),
      sortValue: (view) => view.entry.latestVersion,
    },
    {
      id: 'text',
      header: t('questionText'),
      cell: (view) => (
        <span>
          <span className="text-sm text-muted-foreground">{plainText(view.latestVersion.questionText)}</span>
          {stimulusTextOf(view) ? (
            <span data-testid={`stimulus-of-${view.question.id}`} className="block text-sm">
              {t('stimulusPreview', { content: stimulusTextOf(view) })}
            </span>
          ) : null}
        </span>
      ),
      filterValue: (view) => `${plainText(view.latestVersion.questionText)} ${stimulusTextOf(view)}`,
    },
    {
      id: 'actions',
      header: t('actions'),
      cell: (view) => (
        <span className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            render={<Link to={`/questions/${view.question.id}/edit?category=${view.question.category}`} />}
          >
            {t('editNewVersion')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void showVersions(view)}>
            {t('history')}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void deleteQuestion(view)}>
            {t('deleteAction')}
          </Button>
          <Button
            type="button"
            variant="outline"
            title={t('copyToMyBankFull')}
            aria-label={t('copyToMyBankFull')}
            onClick={() => void copyToMyBank(view.question.id)}
          >
            {t('copyToMyBank')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void toggleWithdraw(view)}>
            {(view.entry as { status?: string }).status === 'hidden' ? t('restoreQuestion') : t('withdrawQuestion')}
          </Button>
        </span>
      ),
    },
  ];

  async function copyToMyBank(questionId: string) {
    try {
      await copyQuestionMutation.mutateAsync(questionId);
      setMessage(t('copiedToMyBank'));
      refreshBanks();
    } catch {
      setMessage(t('copyFailed'));
    }
  }

  async function toggleWithdraw(view: QuestionView) {
    const status = (view.entry as { status?: string }).status;
    try {
      if (status === 'hidden') {
        await restoreQuestionMutation.mutateAsync(view.question.id);
        setMessage(t('questionRestored'));
      } else {
        const reason = window.prompt(t('withdrawQuestion')) ?? '';
        if (!reason.trim()) return;
        await withdrawQuestionMutation.mutateAsync({ questionId: view.question.id, reason });
        setMessage(t('questionWithdrawn'));
      }
      refreshBanks();
      refreshCategoryQuestions();
    } catch {
      setMessage(t('proposeFailed'));
    }
  }

  async function deleteQuestion(view: QuestionView) {
    if (!window.confirm(t('confirmDeleteQuestion', { name: questionExcerpt(view) }))) return;
    setMessage(null);
    try {
      await deleteQuestionMutation.mutateAsync(view.question.id);
      setMessage(t('questionDeleted'));
      setSelected((prev) => prev.filter((qid) => qid !== view.question.id));
      refreshCategoryQuestions();
    } catch {
      setMessage(t('questionDeleteFailed'));
    }
  }

  async function showVersions(view: QuestionView) {
    const versions = await queryClient.fetchQuery(questionVersionsQueryOptions(view.question.id));
    setVersionsOf({ questionId: view.question.id, versions });
  }

  async function startUsageFromSelection() {
    try {
      const created = await createUsageMutation.mutateAsync({
        component: 'mod_quiz',
        slots: selected.map((questionId) => ({ questionId })),
      });
      await navigate(`/question-usages/${created.usage.id}`);
    } catch {
      setMessage(t('usageCreateFailed'));
    }
  }

  return (
    <>
  {categories.map((cat) => {
    const isActive = qCategory === String(cat.id);
    return (
      <CollapsibleSection
        key={cat.id}
        title={cat.name}
        open={isActive}
        onOpenChange={(open) => {
          if (open) {
            setQCategory(String(cat.id));
          }
        }}
        paddedContent={false}
      >
        {isActive ? (
          <>
                <DataTable
                  data={questions}
                  columns={questionColumns}
                  labels={{
                    columns: t('dashboard:tableColumns'),
                    previous: t('dashboard:tablePrevious'),
                    next: t('dashboard:tableNext'),
                    empty: t('dashboard:emptyTable'),
                    filterPlaceholder: t('dashboard:tableFilterPlaceholder'),
                    pageInfo: (page, pages) => t('dashboard:tablePageInfo', { page, pages }),
                  }}
                  getRowId={(view) => view.question.id}
                  rowTestId={(view) => `question-${view.question.id}`}
                />
                <CardContent className="space-y-4">
                  <Button
                    type="button"
                    disabled={selected.length === 0}
                    onClick={() => void startUsageFromSelection()}
                  >
                    {t('startAttemptFromSelection')}
                  </Button>
                  {versionsOf && (
                    <div data-testid="version-history">
                      <h3 className="font-medium">{t('versionHistory')}</h3>
                      <ul>
                        {versionsOf.versions.map((v) => (
                          <li key={v.version}>
                            v{v.version} — {plainText(v.questionText)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </>
        ) : null}
      </CollapsibleSection>
    );
  })}
  {loading && categories.length === 0 ? (
    <div className="space-y-2" aria-label={t('loading')}>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  ) : null}
    </>
  );
}
