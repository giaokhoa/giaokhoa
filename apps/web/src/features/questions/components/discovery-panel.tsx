import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { QuestionView } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';

import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../queries/keys';
import { questionDetailQueryOptions, questionDiscoveryQueryOptions, useBankQuestionContributions, useCopyQuestionToMyBank, useReviewQuestionContribution } from '../queries/questions';
import type { BankLite, DiscoveryItemLite } from '../types/questions';
import { plainText, QTYPE_LABEL_KEYS, QTYPES, questionExcerpt } from '../utils/shared';

export interface DiscoveryPanelProps {
  sharedBanks: BankLite[];
  refreshBanks: () => void;
  setMessage: (message: string | null) => void;
}

export function DiscoveryPanel({ sharedBanks, refreshBanks, setMessage }: DiscoveryPanelProps) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const copyQuestionMutation = useCopyQuestionToMyBank();
  const reviewContributionMutation = useReviewQuestionContribution();
  const [discBankId, setDiscBankId] = useState('');
  const [discKeyword, setDiscKeyword] = useState('');
  const [discQtype, setDiscQtype] = useState('');
  const [discResults, setDiscResults] = useState<DiscoveryItemLite[]>([]);
  const contributions = useBankQuestionContributions(discBankId).data ?? [];
  const [previewItem, setPreviewItem] = useState<QuestionView | null>(null);

  const refreshContributions = (bankId: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bankQuestionContributions(bankId) });
  };

  async function runDiscovery() {
    try {
      const params = new URLSearchParams();
      if (discBankId) params.set('bankId', discBankId);
      if (discKeyword.trim()) params.set('keyword', discKeyword.trim());
      if (discQtype) params.set('qtype', discQtype);
      const rows = await queryClient.fetchQuery(questionDiscoveryQueryOptions(params.toString()));
      setDiscResults(rows);
    } catch {
      setDiscResults([]);
    }
  }

  async function copyToMyBank(questionId: string) {
    try {
      await copyQuestionMutation.mutateAsync(questionId);
      setMessage(t('copiedToMyBank'));
      refreshBanks();
    } catch {
      setMessage(t('copyFailed'));
    }
  }

  async function reviewContribution(bankId: string, contributionId: string, approve: boolean) {
    try {
      if (approve) {
        await reviewContributionMutation.mutateAsync({ bankId, contributionId, approve: true });
      } else {
        const reason = window.prompt(t('contributionReject')) ?? '';
        if (!reason.trim()) return;
        await reviewContributionMutation.mutateAsync({ bankId, contributionId, approve: false, reason });
      }
      refreshContributions(bankId);
    } catch {
      setMessage(t('proposeFailed'));
    }
  }

  async function previewDiscoveryItem(questionId: string) {
    try {
      const view = await queryClient.fetchQuery(questionDetailQueryOptions(questionId));
      setPreviewItem(view);
    } catch {
      setPreviewItem(null);
    }
  }

  return (
    <section id="system-questions" className="space-y-3 scroll-mt-24">
      <h3 className="font-medium">{t('sharedQuestionBank')}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="disc-bank">{t('pickBank')}</Label>
          <select
            id="disc-bank"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
            value={discBankId}
            onChange={(e) => {
              setDiscBankId(e.target.value);
            }}
          >
            <option value="">{t('allSharedBanks')}</option>
            {sharedBanks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.name} ({t(`bankScope${bank.scope[0]!.toUpperCase()}${bank.scope.slice(1)}`)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="disc-keyword">{t('discoveryKeyword')}</Label>
          <Input
            id="disc-keyword"
            value={discKeyword}
            onChange={(e) => setDiscKeyword(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="disc-qtype">{t('questionType')}</Label>
          <select
            id="disc-qtype"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
            value={discQtype}
            onChange={(e) => setDiscQtype(e.target.value)}
          >
            <option value="">—</option>
            {QTYPES.map((qtype) => (
              <option key={qtype} value={qtype}>
                {t(QTYPE_LABEL_KEYS[qtype])}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" onClick={() => void runDiscovery()}>
          {t('discoverySearch')}
        </Button>
      </div>
      {discResults.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('discoveryEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {discResults.map((item) => (
            <li key={item.questionId} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                {item.excerpt}
                <span className="block text-xs text-muted-foreground">
                  {item.bankName} · {item.authorName ?? '—'} · {t('usedTimes', { count: item.useCount })} ·{' '}
                  {t('copiedTimes', { count: item.copyCount })}
                </span>
              </span>
              <Button type="button" variant="outline" onClick={() => void previewDiscoveryItem(item.questionId)}>
                {t('previewQuestion')}
              </Button>
              <Button
                type="button"
                variant="outline"
                title={t('copyToMyBankFull')}
                aria-label={t('copyToMyBankFull')}
                onClick={() => void copyToMyBank(item.questionId)}
              >
                {t('copyToMyBank')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {previewItem ? (
        <div className="rounded-md border p-3">
          <p className="font-medium">{questionExcerpt(previewItem)}</p>
          <p className="text-sm text-muted-foreground">{plainText(previewItem.latestVersion.questionText)}</p>
        </div>
      ) : null}
      {discBankId ? (
        <div className="space-y-2">
          <h4 className="font-medium">{t('contributionQueue')}</h4>
          {contributions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('contributionEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {contributions.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {c.questionName ?? c.questionId}
                    <span className="block text-xs text-muted-foreground">
                      {t('contributionBy', { name: c.proposerName ?? '—' })}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void reviewContribution(discBankId, c.id, true)}
                  >
                    {t('contributionApprove')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void reviewContribution(discBankId, c.id, false)}
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
