import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { usePermissions } from '#lib/permissions';
import { submitSharedExam } from '../api/questions';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { courseContentQueryOptions } from '#lib/course-content';
import { coursesListQueryOptions } from '#features/course-builder/queries/course-builder';
import { courseGroupsQueryOptions } from '#features/progress-report/queries/progress-report';
import { queryKeys } from '#lib/query-keys';
import { queryKeys as questionsQueryKeys } from '../queries/keys';
import { useDeleteExamPaper, useDeployExamPin, useMyDossiers, useProposeExamDossierContribution, useProposeExamPaperContribution, useSetExamPaperStatus } from '../queries/questions';
import type { BankLite, PaperSummaryLite } from '../types/questions';
import { dossierStatusKey, withApiReason } from '../utils/shared';

export interface MyPapersPanelProps {
  myPapers: PaperSummaryLite[];
  sharedExamBanks: BankLite[];
  systemExamBankId: string;
  refreshExamBanks: () => void;
  refreshSystemPapers: (bankId: string) => void;
  refreshMyDossiers: () => void;
  setMessage: (message: string | null) => void;
}

export function MyPapersPanel({
  myPapers,
  sharedExamBanks,
  systemExamBankId,
  refreshExamBanks,
  refreshSystemPapers,
  refreshMyDossiers,
  setMessage,
}: MyPapersPanelProps) {
  const { t } = useTranslation('app');
  const permissions = usePermissions();
  const canSubmitShared = permissions.ready && (permissions.access?.contexts.some((context) =>
    context.contextLevel === 20 && context.capabilities.includes('tenant:manage')) ?? false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const paperStatusMutation = useSetExamPaperStatus();
  const deletePaperMutation = useDeleteExamPaper();
  const proposePaperMutation = useProposeExamPaperContribution();
  const deployPinMutation = useDeployExamPin();
  const proposeDossierContributionMutation = useProposeExamDossierContribution();
  const [proposePaperId, setProposePaperId] = useState('');
  const [proposePaperBankId, setProposePaperBankId] = useState('');
  const myDossiers = useMyDossiers().data ?? [];
  const [dossierPaperId, setDossierPaperId] = useState('');
  const [dossierBankId, setDossierBankId] = useState('');
  const [deployPaper, setDeployPaper] = useState<PaperSummaryLite | null>(null);
  const deployCourses = useQuery({ ...coursesListQueryOptions(), enabled: !!deployPaper }).data ?? [];
  const [deployCourseId, setDeployCourseId] = useState('');
  const deployContentQuery = useQuery({
    ...courseContentQueryOptions(deployCourseId),
    enabled: !!deployCourseId,
  });
  const deploySections = deployContentQuery.data?.sections ?? [];
  const [deploySectionId, setDeploySectionId] = useState('');
  const deployGroups = useQuery({ ...courseGroupsQueryOptions(deployCourseId), enabled: !!deployCourseId }).data ?? [];
  const [deployGroupId, setDeployGroupId] = useState('');
  const [deployVariantCount, setDeployVariantCount] = useState('1');

  const firstDeploySectionId = deployContentQuery.data?.sections[0]?.id;
  if (!deploySectionId && firstDeploySectionId) {
    setDeploySectionId(firstDeploySectionId);
  }

  async function setPaperStatus(paperId: string, status: 'ready' | 'hidden' | 'draft') {
    try {
      await paperStatusMutation.mutateAsync({ paperId, status });
      refreshExamBanks();
      if (systemExamBankId) refreshSystemPapers(systemExamBankId);
    } catch (err) {
      setMessage(withApiReason(t('examPaperSaveFailed'), err));
    }
  }

  async function deletePaper(paperId: string) {
    if (!window.confirm(t('examPaperDeleteConfirm'))) return;
    try {
      await deletePaperMutation.mutateAsync(paperId);
      setMessage(t('examPaperDeleted'));
      refreshExamBanks();
    } catch (err) {
      setMessage(withApiReason(t('examPaperDeleteFailed'), err));
    }
  }

  async function proposePaper() {
    if (!proposePaperId || !proposePaperBankId) return;
    try {
      await proposePaperMutation.mutateAsync({ bankId: proposePaperBankId, paperId: proposePaperId });
      setMessage(t('paperProposedOk'));
    } catch (err) {
      setMessage(withApiReason(t('proposeFailed'), err));
    }
  }

  function openDeploy(paper: PaperSummaryLite) {
    setDeployPaper(paper);
    setDeploySectionId('');
    setDeployGroupId('');
    void queryClient.invalidateQueries({ queryKey: queryKeys.courses });
  }

  async function runDeploy() {
    if (!deployPaper || !deployCourseId || !deploySectionId) return;
    try {
      const pin = await deployPinMutation.mutateAsync({
        courseId: deployCourseId,
        body: {
          sectionId: deploySectionId,
          examId: deployPaper.id,
          variantCount: Math.min(50, Math.max(1, Number(deployVariantCount) || 1)),
          ...(deployGroupId ? { targetGroupId: deployGroupId } : {}),
        },
      });
      setMessage(t('pinOk', { version: deployPaper.latestVersion }));
      setDeployPaper(null);
      navigate(`/courses/${deployCourseId}/exams/${pin.id}`);
    } catch (err) {
      setMessage(withApiReason(t('pinFailed'), err));
    }
  }

  async function proposeDossier() {
    if (!dossierPaperId || !dossierBankId) return;
    try {
      await proposeDossierContributionMutation.mutateAsync({ bankId: dossierBankId, examId: dossierPaperId });
      setMessage(t('dossierProposedOk'));
      void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.bankExamContributions(dossierBankId) });
      void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.bankDossiers(dossierBankId) });
      refreshMyDossiers();
    } catch (err) {
      setMessage(withApiReason(t('dossierFailed'), err));
    }
  }

  return (
    <>
  <div className="space-y-4">
        {myPapers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('examPaperEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {myPapers.map((paper) => (
              <li key={paper.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {paper.name}
                  <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">
                    {paper.status === 'ready'
                      ? t('examPaperStatusReady')
                      : paper.status === 'hidden'
                        ? t('examPaperStatusHidden')
                        : t('examPaperStatusDraft')}
                  </span>
                  <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-xs">v{paper.latestVersion}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t('examPaperSlotsCount', { count: paper.slotCount })}
                  </span>
                </span>
                <Button type="button" variant="outline" onClick={() => navigate(`/exams/${paper.id}/edit`)}>
                  {t('editRow')}
                </Button>
                {paper.status === 'draft' ? (
                  <Button type="button" variant="outline" onClick={() => void setPaperStatus(paper.id, 'ready')}>
                    {t('examPaperMarkReady')}
                  </Button>
                ) : null}
                {paper.status === 'ready' ? (
                  <Button type="button" variant="outline" onClick={() => void setPaperStatus(paper.id, 'hidden')}>
                    {t('examPaperHide')}
                  </Button>
                ) : null}
                {paper.status === 'hidden' ? (
                  <Button type="button" variant="outline" onClick={() => void setPaperStatus(paper.id, 'ready')}>
                    {t('examPaperRestore')}
                  </Button>
                ) : null}
                {paper.status === 'ready' && canSubmitShared ? (
                  <Button type="button" variant="outline" onClick={() => void submitSharedExam(paper.id)
                    .then(() => setMessage(t('sharedExamSubmitted')))
                    .catch(() => setMessage(t('sharedExamSubmitFailed')))}>
                    {t('sharedExamSubmit')}
                  </Button>
                ) : null}
                {paper.status === 'ready' && paper.capabilities.deploy ? (
                  <Button type="button" variant="outline" onClick={() => void openDeploy(paper)}>
                    {t('pinExamAction')}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => void deletePaper(paper.id)}>
                  {t('deleteRow')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {deployPaper ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div>
              <Label htmlFor="deploy-course">{t('deployPickCourse')}</Label>
              <select
                id="deploy-course"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                value={deployCourseId}
                onChange={(e) => {
                setDeployCourseId(e.target.value);
                setDeploySectionId('');
                setDeployGroupId('');
              }}
              >
                <option value="">—</option>
                {deployCourses.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="deploy-section">{t('pinPickSection')}</Label>
              <select
                id="deploy-section"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                value={deploySectionId}
                onChange={(e) => setDeploySectionId(e.target.value)}
              >
                <option value="">—</option>
                {deploySections.map((sec) => (
                  <option key={sec.id} value={sec.id}>{sec.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="deploy-group">{t('pinPickGroup')}</Label>
              <select
                id="deploy-group"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                value={deployGroupId}
                onChange={(e) => setDeployGroupId(e.target.value)}
              >
                <option value="">{t('pinExamWholeCourse')}</option>
                {deployGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="deploy-variants">{t('deployVariantCount')}</Label>
              <Input
                id="deploy-variants"
                type="number"
                min={1}
                max={50}
                className="w-24"
                value={deployVariantCount}
                onChange={(e) => setDeployVariantCount(e.target.value)}
              />
            </div>
            <Button type="button" disabled={!deployCourseId || !deploySectionId} onClick={() => void runDeploy()}>
              {t('pinExamAction')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDeployPaper(null)}>
              ✕
            </Button>
          </div>
        ) : null}
        {sharedExamBanks.length > 0 && myPapers.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="propose-paper">{t('proposePaperToBank')}</Label>
              <select
                id="propose-paper"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                value={proposePaperId}
                onChange={(e) => setProposePaperId(e.target.value)}
              >
                <option value="">—</option>
                {myPapers.filter((p) => p.status === 'ready').map((paper) => (
                  <option key={paper.id} value={paper.id}>{paper.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="propose-paper-bank">{t('pickBank')}</Label>
              <select
                id="propose-paper-bank"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                value={proposePaperBankId}
                onChange={(e) => setProposePaperBankId(e.target.value)}
              >
                <option value="">—</option>
                {sharedExamBanks.map((bank) => (
                  <option key={bank.id} value={bank.id}>{bank.name}</option>
                ))}
              </select>
            </div>
            <Button type="button" disabled={!proposePaperId || !proposePaperBankId} onClick={() => void proposePaper()}>
              {t('propose')}
            </Button>
          </div>
        ) : null}
        {sharedExamBanks.length > 0 && myPapers.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="dossier-paper">{t('dossierPropose')}</Label>
                <select
                  id="dossier-paper"
                  data-testid="dossier-paper-select"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                  value={dossierPaperId}
                  onChange={(e) => setDossierPaperId(e.target.value)}
                >
                  <option value="">—</option>
                  {myPapers.filter((p) => p.status === 'ready').map((paper) => (
                    <option key={paper.id} value={paper.id}>{paper.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="dossier-bank">{t('pickBank')}</Label>
                <select
                  id="dossier-bank"
                  data-testid="dossier-bank-select"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                  value={dossierBankId}
                  onChange={(e) => setDossierBankId(e.target.value)}
                >
                  <option value="">—</option>
                  {sharedExamBanks.map((bank) => (
                    <option key={bank.id} value={bank.id}>{bank.name}</option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                data-testid="dossier-submit-button"
                disabled={!dossierPaperId || !dossierBankId}
                onClick={() => void proposeDossier()}
              >
                {t('dossierPropose')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('dossierProposeHint')}</p>
          </div>
        ) : null}
        <div className="space-y-2">
          <h4 className="font-medium">{t('dossierMine')}</h4>
          {myDossiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dossierEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {myDossiers.map((d) => {
                const rejection = [...d.reviews].reverse().find((r) => r.decision === 'rejected');
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2" data-testid="my-dossier-row">
                    <span className="min-w-0 flex-1">
                      {d.examName ?? d.examId}
                      <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">
                        {t(dossierStatusKey(d.status))}
                      </span>
                      {d.examVersionNumber !== null ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t('dossierPinned', { paperVersion: d.examVersionNumber, matrixVersion: d.matrixVersion ?? '—' })}
                        </span>
                      ) : null}
                      {d.status === 'rejected' && rejection?.reason ? (
                        <span className="block text-xs text-destructive">
                          {t('dossierRejectedReason', { reason: rejection.reason })}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
  </div>
    </>
  );
}
