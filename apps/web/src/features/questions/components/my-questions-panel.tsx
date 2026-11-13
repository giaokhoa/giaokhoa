import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { QuestionView } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Label } from '@giaokhoa/ui/components/label';

import { useDeleteBankQuestion, useProposeQuestionContribution, useRestoreQuestion, useWithdrawQuestion } from '../queries/questions';
import type { AttributionLite, BankLite } from '../types/questions';
import { questionExcerpt } from '../utils/shared';

export interface MyQuestionsPanelProps {
  myQuestions: QuestionView[];
  attributions: Record<string, AttributionLite>;
  sharedBanks: BankLite[];
  refreshBanks: () => void;
  refreshCategoryQuestions: () => void;
  setMessage: (message: string | null) => void;
}

export function MyQuestionsPanel({
  myQuestions,
  attributions,
  sharedBanks,
  refreshBanks,
  refreshCategoryQuestions,
  setMessage,
}: MyQuestionsPanelProps) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const deleteQuestionMutation = useDeleteBankQuestion();
  const restoreQuestionMutation = useRestoreQuestion();
  const withdrawQuestionMutation = useWithdrawQuestion();
  const proposeQuestionMutation = useProposeQuestionContribution();
  const [proposeQuestionId, setProposeQuestionId] = useState('');
  const [proposeBankId, setProposeBankId] = useState('');

  function editMine(view: QuestionView) {
    navigate(`/questions/${view.question.id}/edit?category=${view.question.category}`);
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

  async function deleteMyQuestion(questionId: string) {
    if (!window.confirm(t('deleteQuestionConfirm'))) return;
    try {
      await deleteQuestionMutation.mutateAsync(questionId);
      setMessage(t('questionDeleted'));
      refreshBanks();
      refreshCategoryQuestions();
    } catch {
      setMessage(t('deleteFailed'));
    }
  }

  async function proposeToBank(questionId: string, targetBankId: string) {
    if (!targetBankId) return;
    try {
      await proposeQuestionMutation.mutateAsync({ bankId: targetBankId, questionId });
      setMessage(t('proposedOk'));
    } catch {
      setMessage(t('proposeFailed'));
    }
  }

  return (
    <>
  <div className="space-y-4">
        {myQuestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('dashboard:emptyTable')}</p>
        ) : (
          <ul className="space-y-2">
            {myQuestions.map((view) => {
              const a = attributions[view.question.id];
              const isCopy = Boolean(
                (view.question as { derivedFromQuestionId?: string | null }).derivedFromQuestionId,
              );
              return (
                <li key={view.question.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {questionExcerpt(view)}
                    {(view.entry as { status?: string }).status === 'hidden' ? (
                      <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">{t('withdrawnBadge')}</span>
                    ) : null}
                    <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-xs">v{view.entry.latestVersion}</span>
                    {isCopy && a ? (
                      <span className="block text-xs text-muted-foreground">
                        {t('copiedFromLine', { author: a.originalAuthorName ?? '—', bank: a.sourceBankName ?? '—' })}
                      </span>
                    ) : null}
                  </span>
                  <Button type="button" variant="outline" onClick={() => editMine(view)}>
                    {t('editRow')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void toggleWithdraw(view)}>
                    {(view.entry as { status?: string }).status === 'hidden' ? t('restoreQuestion') : t('withdrawQuestion')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void deleteMyQuestion(view.question.id)}>
                    {t('deleteRow')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {sharedBanks.length > 0 && myQuestions.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="propose-question">{t('proposeToBank')}</Label>
              <select
                id="propose-question"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                value={proposeQuestionId}
                onChange={(e) => setProposeQuestionId(e.target.value)}
              >
                <option value="">—</option>
                {myQuestions.map((view) => (
                  <option key={view.question.id} value={view.question.id}>
                    {questionExcerpt(view)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="propose-bank">{t('pickBank')}</Label>
              <select
                id="propose-bank"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                value={proposeBankId}
                onChange={(e) => setProposeBankId(e.target.value)}
              >
                <option value="">—</option>
                {sharedBanks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              disabled={!proposeQuestionId || !proposeBankId}
              onClick={() => void proposeToBank(proposeQuestionId, proposeBankId)}
            >
              {t('propose')}
            </Button>
          </div>
        ) : null}
  </div>
    </>
  );
}
