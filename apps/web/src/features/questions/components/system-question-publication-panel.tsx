/**
 * Giao diện hai vai cho luồng công bố câu hỏi chung (#13):
 * quản trị trung tâm chọn câu trong bank riêng, biên tập viên hệ thống
 * xem trọn bản chụp/ảnh/nguồn/đáp án rồi duyệt hoặc từ chối kèm lý do.
 * Cổng quyền phía API luôn là nguồn quyết định cuối cùng.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { ApiError } from '#lib/api';
import { Label } from '@giaokhoa/ui/components/label';
import { usePermissions } from '#lib/permissions';
import {
  approveSystemQuestionSubmission, fetchSystemQuestionSubmissions, fetchSystemSubmissionSources,
  rejectSystemQuestionSubmission, submitSystemQuestion,
  type SystemQuestionSubmission, type SystemSubmissionSource,
} from '../api/questions';
import { QTYPE_LABEL_KEYS, QTYPES, systemBankPlainText, type Qtype } from '../utils/shared';
import { SystemSubmissionReviewPreview } from './system-submission-review-preview';

/** Chuỗi văn bản gọn để người duyệt xem cùng đáp án, không hiển thị JSON thô. */
function excerpt(doc: SystemQuestionSubmission['package']['questionText']): string {
  return systemBankPlainText(doc).slice(0, 320);
}

/** Panel công bố chỉ hiện khi người dùng có vai trò quản trị trung tâm hoặc biên tập hệ thống. */
export function SystemQuestionPublicationPanel() {
  const { t } = useTranslation('app');
  const permissions = usePermissions();
  const access = permissions.access;
  const canSubmit = permissions.ready && (access?.contexts.some(
    (ctx) => ctx.contextLevel === 20 && ctx.capabilities.includes('tenant:manage'),
  ) ?? false);
  const canReview = permissions.ready && ((access?.contexts.some(
    (ctx) => ctx.contextLevel === 10 && ctx.capabilities.includes('systembank:review'),
  ) ?? false) || (access?.isSiteAdmin && !canSubmit) || false);

  const [sourceId, setSourceId] = useState('');
  const [sources, setSources] = useState<SystemSubmissionSource[]>([]);
  const [license, setLicense] = useState('');
  const [mine, setMine] = useState<SystemQuestionSubmission[]>([]);
  const [pending, setPending] = useState<SystemQuestionSubmission[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (canSubmit) {
      void fetchSystemSubmissionSources().then((rows) => {
        if (active) setSources(rows);
      }).catch(() => {
        if (active) setNotice(t('systemSourcesLoadFailed'));
      });
      void fetchSystemQuestionSubmissions('mine').then((rows) => {
        if (active) setMine(rows);
      }).catch(() => {
        if (active) setNotice(t('systemSubmitLoadFailed'));
      });
    }
    if (canReview) {
      void fetchSystemQuestionSubmissions('pending').then((rows) => {
        if (active) setPending(rows);
      }).catch(() => {
        if (active) setNotice(t('systemReviewLoadFailed'));
      });
    }
    return () => { active = false; };
  }, [canSubmit, canReview, t]);

  if (!canSubmit && !canReview) return null;

  const selected = pending.find((item) => item.id === selectedId);

  async function refresh() {
    if (canSubmit) {
      setMine(await fetchSystemQuestionSubmissions('mine'));
      setSources(await fetchSystemSubmissionSources());
    }
    if (canReview) setPending(await fetchSystemQuestionSubmissions('pending'));
  }

  async function send() {
    if (!sourceId.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      await submitSystemQuestion(sourceId.trim(), license);
      await refresh();
      setSourceId('');
      setNotice(t('systemSubmitSuccess'));
    } catch (error) {
      setNotice(error instanceof ApiError && error.problem.code === 'system_bank.submission_rejected_requires_new_version'
        ? t('systemSubmitRejectedVersion') : t('systemSubmitFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function review(approve: boolean) {
    if (!selected) return;
    if (!approve && !reason.trim()) {
      setNotice(t('systemRejectionRequired'));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      if (approve) {
        await approveSystemQuestionSubmission(selected.id);
      } else {
        await rejectSystemQuestionSubmission(selected.id, reason.trim());
      }
      await refresh();
      setSelectedId('');
      setReason('');
      setNotice(approve ? t('systemApproved') : t('systemRejected'));
    } catch {
      setNotice(t('systemReviewFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="system-question-publication" className="space-y-4 rounded-md border p-4">
      <h3 className="font-semibold">{t('systemPublicationTitle')}</h3>
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}

      {canSubmit ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('systemSubmitHint')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Label htmlFor="system-submit-question">{t('systemSourceQuestionId')}</Label>
              <select id="system-submit-question" value={sourceId}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs"
                onChange={(event) => setSourceId(event.target.value)}>
                <option value="">{t('systemSelectSourcePlaceholder')}</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {systemBankPlainText(source.questionText).slice(0, 100) || source.id} ·
                    {' '}{t(QTYPE_LABEL_KEYS[(QTYPES as readonly string[]).includes(source.qtype) ? source.qtype as Qtype : 'essay'])}
                    {' '}· v{source.version}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-48 flex-1">
              <Label htmlFor="system-submit-license">{t('systemSourceLicense')}</Label>
              <Input id="system-submit-license" value={license}
                onChange={(event) => setLicense(event.target.value)} />
            </div>
            <Button disabled={busy || !sourceId.trim()} onClick={() => void send()}>
              {t('systemSubmitAction')}
            </Button>
          </div>
          <h4 className="font-medium">{t('systemSubmittedHistory')}</h4>
          {mine.length ? (
            <ul className="space-y-2">
              {mine.map((item) => (
                <li key={item.id} className="rounded-md border p-2 text-sm">
                  <span>{excerpt(item.package.questionText)} · v{item.sourceVersionNumber}</span>
                  <span className="ml-2 font-medium">
                    {t(`systemSubmissionStatus_${item.status}`)}
                  </span>
                  {item.rejectionReason ? (
                    <p className="mt-1 text-muted-foreground">
                      {t('systemRejectionReason')}: {item.rejectionReason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t('systemNoSubmissions')}</p>}
        </div>
      ) : null}

      {canReview ? (
        <div className="space-y-3">
          <h4 className="font-medium">{t('systemReviewQueue')}</h4>
          {pending.length ? (
            <ul className="space-y-2">
              {pending.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                  <span className="flex-1">
                    {excerpt(item.package.questionText)} · {item.centreSlug}
                  </span>
                  <Button variant="outline" disabled={busy} onClick={() => {
                    setSelectedId(item.id);
                    setReason('');
                  }}>
                    {t('systemReviewOpen')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t('systemReviewEmpty')}</p>}
          {selected ? (
            <div className="space-y-3 rounded-md border p-3">
              <h5 className="font-medium">{t('systemReviewDetails')}</h5>
              <SystemSubmissionReviewPreview submission={selected} />
              <Label htmlFor="system-rejection-reason">{t('systemRejectionReason')}</Label>
              <Input id="system-rejection-reason" value={reason}
                onChange={(event) => setReason(event.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void review(true)}>
                  {t('systemReviewApprove')}
                </Button>
                <Button disabled={busy || !reason.trim()} variant="outline" onClick={() => void review(false)}>
                  {t('systemReviewReject')}
                </Button>
                <Button disabled={busy} variant="ghost" onClick={() => setSelectedId('')}>
                  {t('systemReviewClose')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
