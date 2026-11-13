import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Button } from '@giaokhoa/ui/components/button';
import { Label } from '@giaokhoa/ui/components/label';

import type { SubjectLite } from '#lib/curriculum';
import { useBankMatrices, useBankMatrixContributions, useCopyMatrixToMyBank, useDeleteMatrix, useProposeMatrixContribution, useReviewMatrixContribution } from '../queries/questions';
import type { BankLite, MatrixLite } from '../types/questions';
import { matrixStatusKey } from '../utils/shared';

export interface MyMatricesPanelProps {
  myMatrices: MatrixLite[];
  sharedMatrixBanks: BankLite[];
  subjects: SubjectLite[];
  refreshMatrixBanks: () => void;
  setMessage: (message: string | null) => void;
}

export interface SystemMatricesPanelProps {
  sharedMatrixBanks: BankLite[];
  subjects: SubjectLite[];
  refreshMatrixBanks: () => void;
  refreshSharedMatrices: (bankId: string) => void;
  setMessage: (message: string | null) => void;
}

export function MyMatricesPanel({
  myMatrices,
  sharedMatrixBanks,
  subjects,
  refreshMatrixBanks,
  setMessage,
}: MyMatricesPanelProps) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const deleteMatrixMutation = useDeleteMatrix();
  const proposeMatrixMutation = useProposeMatrixContribution();
  const [proposeMatrixId, setProposeMatrixId] = useState('');
  const [proposeMatrixBankId, setProposeMatrixBankId] = useState('');

  const subjectName = (subjectId: string) => subjects.find((s) => s.id === subjectId)?.name ?? '';

  async function deleteMyMatrix(matrixId: string) {
    if (!window.confirm(t('matrixDeleteConfirm'))) return;
    try {
      await deleteMatrixMutation.mutateAsync(matrixId);
      setMessage(t('matrixDeleted'));
      refreshMatrixBanks();
    } catch {
      setMessage(t('matrixDeleteFailed'));
    }
  }

  async function proposeMatrixToBank(matrixId: string, targetBankId: string) {
    if (!matrixId || !targetBankId) return;
    try {
      await proposeMatrixMutation.mutateAsync({ matrixId, targetBankId });
      setMessage(t('proposedOk'));
    } catch {
      setMessage(t('proposeFailed'));
    }
  }

  return (
    <>
  <div className="space-y-4">
        {myMatrices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('dashboard:emptyTable')}</p>
        ) : (
          <ul className="space-y-2">
            {myMatrices.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {m.name}
                  {m.isTemplate ? (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">{t('matrixTemplateBadge')}</span>
                  ) : null}
                  <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">{t(matrixStatusKey(m.status))}</span>
                  <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-xs">v{m.version}</span>
                  <span className="block text-xs text-muted-foreground">
                    {subjectName(m.subjectId)} · {t('matrixCellsCount', { count: m.cells.length })}
                    {m.derivedFromMatrixId ? ` · ${t('matrixDerivedNote')}` : ''}
                  </span>
                </span>
                <Button type="button" variant="outline" onClick={() => navigate(`/matrices/${m.id}/edit`)}>
                  {t('editRow')}
                </Button>
                <Button type="button" variant="outline" onClick={() => void deleteMyMatrix(m.id)}>
                  {t('deleteRow')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {sharedMatrixBanks.length > 0 && myMatrices.some((m) => m.status === 'ready') ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="propose-matrix">{t('proposeToBank')}</Label>
                <select
                  id="propose-matrix"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                  value={proposeMatrixId}
                  onChange={(e) => setProposeMatrixId(e.target.value)}
                >
                  <option value="">—</option>
                  {myMatrices
                    .filter((m) => m.status === 'ready')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <Label htmlFor="propose-matrix-bank">{t('pickBank')}</Label>
                <select
                  id="propose-matrix-bank"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                  value={proposeMatrixBankId}
                  onChange={(e) => setProposeMatrixBankId(e.target.value)}
                >
                  <option value="">—</option>
                  {sharedMatrixBanks.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                disabled={!proposeMatrixId || !proposeMatrixBankId}
                onClick={() => void proposeMatrixToBank(proposeMatrixId, proposeMatrixBankId)}
              >
                {t('propose')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('matrixProposeHint')}</p>
          </div>
        ) : null}
  </div>
    </>
  );
}

export function SystemMatricesPanel({
  sharedMatrixBanks,
  subjects,
  refreshMatrixBanks,
  refreshSharedMatrices,
  setMessage,
}: SystemMatricesPanelProps) {
  const { t } = useTranslation('app');
  const copyMatrixMutation = useCopyMatrixToMyBank();
  const reviewMatrixContributionMutation = useReviewMatrixContribution();
  const [sharedMatrixBankId, setSharedMatrixBankId] = useState('');
  const sharedMatrices = useBankMatrices(sharedMatrixBankId || undefined).data ?? [];
  const [matrixSubjectFilter, setMatrixSubjectFilter] = useState('');
  const matrixContributions = useBankMatrixContributions(sharedMatrixBankId).data ?? [];

  const subjectName = (subjectId: string) => subjects.find((s) => s.id === subjectId)?.name ?? '';

  const filteredSharedMatrices = sharedMatrices.filter(
    (m) =>
      !matrixSubjectFilter || m.subjectId === matrixSubjectFilter,
  );

  async function copyMatrixToMyBank(matrixId: string) {
    try {
      await copyMatrixMutation.mutateAsync(matrixId);
      setMessage(t('matrixCopiedToMyBank'));
      refreshMatrixBanks();
    } catch {
      setMessage(t('matrixCopyFailed'));
    }
  }

  async function reviewMatrixContribution(bankId: string, contributionId: string, approve: boolean) {
    try {
      if (approve) {
        await reviewMatrixContributionMutation.mutateAsync({ bankId, contributionId, approve: true });
      } else {
        const reason = window.prompt(t('contributionReject')) ?? '';
        if (!reason.trim()) return;
        await reviewMatrixContributionMutation.mutateAsync({ bankId, contributionId, approve: false, reason });
      }
      refreshSharedMatrices(bankId);
    } catch {
      setMessage(t('proposeFailed'));
    }
  }

  return (
    <section id="system-matrices" className="space-y-3 scroll-mt-24">
      <h3 className="font-medium">{t('sharedMatrixBank')}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="shared-matrix-bank">{t('pickBank')}</Label>
          <select
            id="shared-matrix-bank"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
            value={sharedMatrixBankId}
            onChange={(e) => {
              setSharedMatrixBankId(e.target.value);
            }}
          >
            <option value="">—</option>
            {sharedMatrixBanks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.name} ({t(`bankScope${bank.scope[0]!.toUpperCase()}${bank.scope.slice(1)}`)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="matrix-subject-filter">{t('matrixFilterSubject')}</Label>
          <select
            id="matrix-subject-filter"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
            value={matrixSubjectFilter}
            onChange={(e) => setMatrixSubjectFilter(e.target.value)}
          >
            <option value="">{t('matrixAllSubjects')}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!sharedMatrixBankId ? (
        <p className="text-sm text-muted-foreground">{t('discoveryEmpty')}</p>
      ) : filteredSharedMatrices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard:emptyTable')}</p>
      ) : (
        <ul className="space-y-2">
          {filteredSharedMatrices.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                {m.name}
                {m.isTemplate ? (
                  <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">{t('matrixTemplateBadge')}</span>
                ) : null}
                <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">{t(matrixStatusKey(m.status))}</span>
                <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-xs">v{m.version}</span>
                <span className="block text-xs text-muted-foreground">
                  {subjectName(m.subjectId)} · {t('matrixCellsCount', { count: m.cells.length })}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                title={t('copyToMyBankFull')}
                aria-label={t('copyToMyBankFull')}
                onClick={() => void copyMatrixToMyBank(m.id)}
              >
                {t('copyToMyBank')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {sharedMatrixBankId ? (
        <div className="space-y-2">
          <h4 className="font-medium">{t('contributionQueue')}</h4>
          {matrixContributions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('contributionEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {matrixContributions.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {c.matrixName ?? c.matrixId}
                    <span className="block text-xs text-muted-foreground">
                      {t('contributionBy', { name: c.proposerName ?? '—' })}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void reviewMatrixContribution(sharedMatrixBankId, c.id, true)}
                  >
                    {t('contributionApprove')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void reviewMatrixContribution(sharedMatrixBankId, c.id, false)}
                  >
                    {t('contributionReject')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
