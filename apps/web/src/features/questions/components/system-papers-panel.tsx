import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Button } from '@giaokhoa/ui/components/button';
import { Label } from '@giaokhoa/ui/components/label';

import { useBankExams, useCopyExamPaper, useReviewExamPaperContribution } from '../queries/questions';
import type { BankLite, DossierSpecLite, ExamContributionLite } from '../types/questions';
import { dossierStatusKey, withApiReason } from '../utils/shared';

export interface SystemPapersPanelProps {
  systemExamBankId: string;
  setSystemExamBankId: (bankId: string) => void;
  sharedExamBanks: BankLite[];
  paperContributions: ExamContributionLite[];
  refreshExamBanks: () => void;
  refreshSystemPapers: (bankId: string) => void;
  setMessage: (message: string | null) => void;
}

export function SystemPapersPanel({
  systemExamBankId,
  setSystemExamBankId,
  sharedExamBanks,
  paperContributions,
  refreshExamBanks,
  refreshSystemPapers,
  setMessage,
}: SystemPapersPanelProps) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const copyPaperMutation = useCopyExamPaper();
  const reviewPaperContributionMutation = useReviewExamPaperContribution();
  const systemPapers = useBankExams(systemExamBankId || undefined).data ?? [];
  const [openContributionSpec, setOpenContributionSpec] = useState<{ contributionId: string; spec: DossierSpecLite } | null>(null);

  async function copyPaperToMine(paperId: string) {
    try {
      await copyPaperMutation.mutateAsync(paperId);
      setMessage(t('paperCopiedToMyBank'));
      refreshExamBanks();
    } catch (err) {
      setMessage(withApiReason(t('examPaperCopyFailed'), err));
    }
  }

  async function reviewPaperContribution(
    bankId: string,
    contributionId: string,
    action: 'approve' | 'reject',
  ) {
    try {
      if (action === 'approve') {
        await reviewPaperContributionMutation.mutateAsync({ bankId, contributionId, action });
      } else {
        const reason = window.prompt(t('contributionReject')) ?? '';
        if (!reason.trim()) return;
        await reviewPaperContributionMutation.mutateAsync({ bankId, contributionId, action, reason });
      }
      refreshSystemPapers(bankId);
    } catch (err) {
      setMessage(withApiReason(t('proposeFailed'), err));
    }
  }

  function toggleContributionSpec(contribution: ExamContributionLite) {
    if (openContributionSpec?.contributionId === contribution.id) { setOpenContributionSpec(null); return; }
    if (contribution.dossierSpecSnapshot) {
      setOpenContributionSpec({ contributionId: contribution.id, spec: contribution.dossierSpecSnapshot });
    }
  }

  return (
    <>
    <h3 className="font-medium">{t('sharedExamBank')}</h3>
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="exam-bank-pick">{t('pickBank')}</Label>
        <select
          id="exam-bank-pick"
          className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
          value={systemExamBankId}
          onChange={(e) => setSystemExamBankId(e.target.value)}
        >
          <option value="">—</option>
          {sharedExamBanks.map((bank) => (
            <option key={bank.id} value={bank.id}>
              {bank.name} ({t(`bankScope${bank.scope[0]!.toUpperCase()}${bank.scope.slice(1)}`)})
            </option>
          ))}
        </select>
      </div>
    </div>
    {systemExamBankId && systemPapers.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t('examPaperEmpty')}</p>
    ) : (
      <ul className="space-y-2">
        {systemPapers.map((paper) => (
          <li key={paper.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              {paper.name}
              <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-xs">v{paper.latestVersion}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {t('examPaperSlotsCount', { count: paper.slotCount })} · {t('copiedTimes', { count: paper.copyCount })}
              </span>
            </span>
            {paper.capabilities.edit ? (
              <Button type="button" variant="outline" onClick={() => navigate(`/exams/${paper.id}/edit`)}>
                {t('editRow')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              title={t('copyToMyBankFull')}
              aria-label={t('copyToMyBankFull')}
              onClick={() => void copyPaperToMine(paper.id)}
            >
              {t('copyPaperToMyBank')}
            </Button>
          </li>
        ))}
      </ul>
    )}
    {systemExamBankId && paperContributions.length > 0 ? (
      <div className="space-y-2">
        <h4 className="font-medium">{t('examContributionQueue')}</h4>
        <ul className="space-y-2">
          {paperContributions.map((c) => (
            <li key={c.id} className="space-y-1" data-testid="exam-contribution-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {c.paperName ?? c.examId}
                  {c.status === 'pending_board' ? (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">
                      {t(dossierStatusKey(c.status))}
                    </span>
                  ) : null}
                  {c.dossierExamVersionNumber !== null ? (
                    <span className="block text-xs text-muted-foreground">
                      {t('dossierPinned', { paperVersion: c.dossierExamVersionNumber, matrixVersion: c.dossierMatrixVersion ?? '—' })}
                    </span>
                  ) : null}
                </span>
                {c.dossierSpecSnapshot ? (
                  <Button type="button" variant="outline" onClick={() => toggleContributionSpec(c)}>
                    {t('dossierViewSpec')}
                  </Button>
                ) : null}
                {c.status === 'pending_board' ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void reviewPaperContribution(systemExamBankId, c.id, 'approve')}
                    >
                      {t('dossierBoardApprove')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void reviewPaperContribution(systemExamBankId, c.id, 'reject')}
                    >
                      {t('dossierBoardReject')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void reviewPaperContribution(systemExamBankId, c.id, 'approve')}
                    >
                      {t('contributionApprove')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void reviewPaperContribution(systemExamBankId, c.id, 'reject')}
                    >
                      {t('contributionReject')}
                    </Button>
                  </>
                )}
              </div>
              {openContributionSpec?.contributionId === c.id ? (
                <div className="rounded-md border p-3 text-sm" data-testid="contribution-spec-panel">
                  <p className="font-medium">
                    {t('dossierSpecTotals', {
                      count: openContributionSpec.spec.totals.totalQuestions,
                      score: openContributionSpec.spec.totals.totalScore,
                    })}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {openContributionSpec.spec.topics.flatMap((topic) =>
                      topic.nodes.flatMap((node) =>
                        node.outcomes.flatMap((outcome) =>
                          outcome.cells.map((cell, idx) => (
                            <li key={idx}>
                              {cell.cognitiveLevel} · {cell.questionCount} · {cell.cellScore}
                              {cell.slotNumbers?.length
                                ? ` · ${t('dossierSpecSlots', { slots: cell.slotNumbers.join(', ') })}`
                                : ''}
                            </li>
                          )),
                        ),
                      ),
                    )}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    ) : null}
    </>
  );
}
