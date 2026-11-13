import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@giaokhoa/ui/components/button';

import { useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '#lib/api';
import { examDossierSpecQueryOptions, useReviewExamPaperContribution } from '../queries/questions';
import type { DossierSpecLite, ExamContributionLite, ExamDossierLite } from '../types/questions';
import { dossierStatusKey, withApiReason } from '../utils/shared';

export interface DossierQueuePanelProps {
  bankDossiers: ExamDossierLite[];
  contributionBySourceDossierId: Map<string, ExamContributionLite>;
  systemExamBankId: string;
  refreshSystemPapers: (bankId: string) => void;
  refreshMyDossiers: () => void;
  setMessage: (message: string | null) => void;
}

export function DossierQueuePanel({
  bankDossiers,
  contributionBySourceDossierId,
  systemExamBankId,
  refreshSystemPapers,
  refreshMyDossiers,
  setMessage,
}: DossierQueuePanelProps) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const reviewPaperContributionMutation = useReviewExamPaperContribution();
  const [openDossierSpec, setOpenDossierSpec] = useState<{ dossierId: string; spec: DossierSpecLite } | null>(null);

  async function reviewDossier(dossierId: string, action: 'approve' | 'reject') {
    const contribution = contributionBySourceDossierId.get(dossierId);
    if (!contribution || !systemExamBankId) return;
    try {
      if (action === 'approve') {
        await reviewPaperContributionMutation.mutateAsync({
          bankId: systemExamBankId,
          contributionId: contribution.id,
          action,
        });
      } else {
        const reason = window.prompt(t('contributionReject')) ?? '';
        if (!reason.trim()) return;
        await reviewPaperContributionMutation.mutateAsync({
          bankId: systemExamBankId,
          contributionId: contribution.id,
          action,
          reason,
        });
      }
      if (systemExamBankId) refreshSystemPapers(systemExamBankId);
      refreshMyDossiers();
    } catch (err) {
      setMessage(withApiReason(t('dossierFailed'), err));
    }
  }

  async function toggleDossierSpec(dossierId: string) {
    if (openDossierSpec?.dossierId === dossierId) { setOpenDossierSpec(null); return; }
    try {
      const spec = await queryClient.fetchQuery(examDossierSpecQueryOptions(dossierId));
      setOpenDossierSpec({ dossierId, spec });
    } catch (err) {
      setMessage(withApiReason(t('dossierFailed'), err));
    }
  }

  async function downloadDossierSpec(dossierId: string) {
    try {
      const res = await apiFetch(`/api/v1/exams/dossiers/${dossierId}/specification/export?format=xlsx`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ban-dac-ta.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage(withApiReason(t('dossierFailed'), err));
    }
  }

  return (
    <>
    {systemExamBankId && bankDossiers.length > 0 ? (
      <div className="space-y-2">
        <h4 className="font-medium">{t('dossierQueue')}</h4>
        <ul className="space-y-2">
          {bankDossiers.map((d) => {
            const linkedContribution = contributionBySourceDossierId.get(d.id);
            return (
            <li key={d.id} className="space-y-1" data-testid="dossier-queue-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {d.examName ?? d.examId}
                  <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">
                    {t(dossierStatusKey(d.status))}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t('contributionBy', { name: d.proposerName ?? '—' })}
                    {d.examVersionNumber !== null
                      ? ` · ${t('dossierPinned', { paperVersion: d.examVersionNumber, matrixVersion: d.matrixVersion ?? '—' })}`
                      : ''}
                  </span>
                </span>
                <Button type="button" variant="outline" onClick={() => void toggleDossierSpec(d.id)}>
                  {t('dossierViewSpec')}
                </Button>
                <Button type="button" variant="outline" onClick={() => void downloadDossierSpec(d.id)}>
                  {t('dossierDownloadSpec')}
                </Button>
                {linkedContribution?.status === 'pending' ? (
                  <>
                    <Button type="button" variant="outline" onClick={() => void reviewDossier(d.id, 'approve')}>
                      {t('contributionApprove')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void reviewDossier(d.id, 'reject')}>
                      {t('contributionReject')}
                    </Button>
                  </>
                ) : linkedContribution?.status === 'pending_board' ? (
                  <>
                    <Button type="button" variant="outline" onClick={() => void reviewDossier(d.id, 'approve')}>
                      {t('dossierBoardApprove')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void reviewDossier(d.id, 'reject')}>
                      {t('dossierBoardReject')}
                    </Button>
                  </>
                ) : null}
              </div>
              {openDossierSpec?.dossierId === d.id ? (
                <div className="rounded-md border p-3 text-sm" data-testid="dossier-spec-panel">
                  <p className="font-medium">
                    {t('dossierSpecTotals', {
                      count: openDossierSpec.spec.totals.totalQuestions,
                      score: openDossierSpec.spec.totals.totalScore,
                    })}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {openDossierSpec.spec.topics.flatMap((topic) =>
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
            );
          })}
        </ul>
      </div>
    ) : null}
    </>
  );
}
