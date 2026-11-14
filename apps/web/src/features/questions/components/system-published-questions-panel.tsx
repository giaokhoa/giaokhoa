import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { Label } from '@giaokhoa/ui/components/label';
import { usePermissions } from '#lib/permissions';
import {
  acknowledgeSystemQuestionEvent, fetchSystemQuestionEvents, fetchUsedSystemQuestions,
  fetchSystemPublishedQuestions, fetchSystemPublishedVersion, importSystemPublishedQuestion,
  type SystemPublishedDiscovery, type SystemPublishedQuestion, type SystemPublishedVersion,
  type SystemUsedQuestion, type SystemQuestionEvent,
} from '../api/questions';
import { QTYPE_LABEL_KEYS, systemBankPlainText } from '../utils/shared';

const PAGE_SIZE = 20;

type Selected = { questionId: string; version: number };

export function SystemPublishedQuestionsPanel() {
  const { t } = useTranslation('app');
  const permissions = usePermissions();
  const allowed = permissions.ready && permissions.canUseQuestionBank;
  const [qtype, setQtype] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<SystemPublishedDiscovery | null>(null);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Selected | null>(null);
  const [preview, setPreview] = useState<SystemPublishedVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [used, setUsed] = useState<SystemUsedQuestion[]>([]);
  const [events, setEvents] = useState<SystemQuestionEvent[]>([]);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void Promise.all([fetchUsedSystemQuestions(), fetchSystemQuestionEvents()])
      .then(([imports, pending]) => {
        if (active) { setUsed(imports); setEvents(pending.filter((event) => event.sourceQuestionId !== null)); }
      })
      .catch(() => { if (active) setNotice(t('systemUsedLoadFailed')); });
    return () => { active = false; };
  }, [allowed, refreshKey, t]);

  async function receiveNewVersion(entry: SystemUsedQuestion) {
    if (!entry.latestVersionNumber || entry.sourceStatus !== 'published') return;
    setBusy(true);
    setNotice(null);
    try {
      await importSystemPublishedQuestion(entry.sourceQuestionId, entry.latestVersionNumber);
      setNotice(t('systemPublishedImportSuccess'));
      setRefreshKey((v) => v + 1);
    } catch {
      setNotice(t('systemPublishedImportFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(eventId: string) {
    setBusy(true);
    setNotice(null);
    try {
      await acknowledgeSystemQuestionEvent(eventId);
      setEvents((prior) => prior.filter((entry) => entry.id !== eventId));
    } catch {
      setNotice(t('systemEventAcknowledgeFailed'));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    void fetchSystemPublishedQuestions({ qtype: qtype || undefined, limit: PAGE_SIZE, offset })
      .then((data) => { if (live) setPage(data); })
      .catch(() => {
        if (live) {
          setPage(null);
          setNotice(t('systemPublishedLoadFailed'));
        }
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [allowed, offset, qtype, refreshKey, t]);

  if (!allowed) return null;

  function versionOf(item: SystemPublishedQuestion): number {
    return versions[item.id] ?? item.versions[item.versions.length - 1]!.version;
  }

  async function showPreview(item: SystemPublishedQuestion) {
    const version = versionOf(item);
    setBusy(true);
    setNotice(null);
    setPreview(null);
    setSelected({ questionId: item.id, version });
    try {
      setPreview(await fetchSystemPublishedVersion(item.id, version));
    } catch {
      setNotice(t('systemPublishedPreviewFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function importQuestion(item: SystemPublishedQuestion) {
    const version = versionOf(item);
    setBusy(true);
    setNotice(null);
    try {
      await importSystemPublishedQuestion(item.id, version);
      setNotice(t('systemPublishedImportSuccess'));
      setRefreshKey((v) => v + 1);
    } catch {
      setNotice(t('systemPublishedImportFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="system-published-questions" className="space-y-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t('systemPublishedTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('systemPublishedHint')}</p>
        </div>
        <Button variant="outline" disabled={loading || busy} onClick={() => { setLoading(true); setRefreshKey((v) => v + 1); }}>
          {t('systemPublishedRefresh')}
        </Button>
      </div>
      {notice ? <p className="text-sm" role="status">{notice}</p> : null}
      <section className="space-y-3" aria-label={t('systemUsedTitle')}>
        <h4 className="font-semibold">{t('systemUsedTitle')}</h4>
        {used.length === 0 ? <p className="text-sm text-muted-foreground">{t('systemUsedEmpty')}</p> : null}
        <ul className="space-y-2">
          {used.map((entry) => (
            <li key={entry.questionId} className="space-y-1 rounded-md border p-3 text-sm">
              <p>{t('systemUsedLocalQuestion')}: <code className="break-all">{entry.questionId}</code></p>
              <p>{t('systemUsedSource')}: <code className="break-all">{entry.sourceQuestionId}</code> · v{entry.sourceVersionNumber}</p>
              <p>{t('systemUsedKind')}: {entry.kind === 'derived' ? t('systemUsedDerived') : t('systemUsedPristine')}</p>
              <p>{t('systemUsedStatus')}: {entry.sourceStatus === 'withdrawn'
                ? t('systemUsedWithdrawn') : entry.sourceStatus === 'published'
                  ? t('systemUsedPublished') : t('systemUsedUnavailable')}</p>
              {entry.hasNewVersion ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span>{t('systemUsedNewVersion', { version: entry.latestVersionNumber })}</span>
                  {entry.sourceStatus === 'published' ? (
                    <Button size="sm" disabled={busy}
                      onClick={() => void receiveNewVersion(entry)}>{t('systemUsedReceiveNew')}</Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {events.length > 0 ? (
          <div className="space-y-2">
            <h4 className="font-semibold">{t('systemEventsTitle')}</h4>
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                <span>{event.type === 'question_withdrawn'
                  ? t('systemEventWithdrawn') : t('systemEventNewVersion', { version: event.payload.versionNumber })}</span>
                <code className="break-all">{event.sourceQuestionId}</code>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => void acknowledge(event.id)}>{t('systemEventAcknowledge')}</Button>
              </div>
            ))}
          </div>
        ) : null}
      </section>
      <div className="max-w-64">
        <Label htmlFor="system-published-qtype">{t('systemPublishedType')}</Label>
        <select id="system-published-qtype" value={qtype}
          className="w-full rounded-md border p-2 text-sm"
          onChange={(event) => {
            setLoading(true);
            setQtype(event.target.value);
            setOffset(0);
            setSelected(null);
            setPreview(null);
          }}>
          <option value="">{t('systemPublishedAllTypes')}</option>
          <option value="multichoice">{t(QTYPE_LABEL_KEYS.multichoice)}</option>
          <option value="truefalse">{t(QTYPE_LABEL_KEYS.truefalse)}</option>
          <option value="shortanswer">{t(QTYPE_LABEL_KEYS.shortanswer)}</option>
          <option value="essay">{t(QTYPE_LABEL_KEYS.essay)}</option>
        </select>
      </div>
      {loading ? <p className="text-sm">{t('systemPublishedLoading')}</p> : null}
      {!loading && page?.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('systemPublishedEmpty')}</p>
      ) : null}
      {page?.items.length ? (
        <ul className="space-y-3">
          {page.items.map((item) => (
            <li key={item.id} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t(QTYPE_LABEL_KEYS[item.qtype])}</span>
                <code className="break-all text-xs text-muted-foreground">{item.id}</code>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`system-published-version-${item.id}`}>{t('systemPublishedVersion')}</Label>
                <select id={`system-published-version-${item.id}`} className="rounded-md border p-2 text-sm"
                  value={versionOf(item)} onChange={(event) => {
                    setVersions((prior) => ({ ...prior, [item.id]: Number(event.target.value) }));
                    setPreview(null);
                    setSelected(null);
                  }}>
                  {item.versions.map((version) => (
                    <option value={version.version} key={version.version}>
                      v{version.version}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => void showPreview(item)}>{t('systemPublishedPreview')}</Button>
                <Button size="sm" disabled={busy}
                  onClick={() => void importQuestion(item)}>{t('systemPublishedImport')}</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {page ? (
        <div className="flex items-center gap-3 text-sm">
          <Button size="sm" variant="outline" disabled={offset === 0 || loading || busy}
            onClick={() => { setLoading(true); setOffset(Math.max(0, offset - PAGE_SIZE)); }}>{t('systemPublishedPrevious')}</Button>
          <span>{t('systemPublishedRange', {
            start: page.total ? offset + 1 : 0,
            end: Math.min(page.total, offset + page.limit),
            total: page.total,
          })}</span>
          <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= page.total || loading || busy}
            onClick={() => { setLoading(true); setOffset(offset + PAGE_SIZE); }}>{t('systemPublishedNext')}</Button>
        </div>
      ) : null}
      {selected && preview ? (
        <div className="space-y-2 rounded-md border p-3">
          <h4 className="font-medium">{t('systemPublishedPreview')} — v{selected.version}</h4>
          <p className="text-sm">{systemBankPlainText(preview.package.questionText)}</p>
          <p className="text-xs text-muted-foreground">
            {t('systemSourceChecksum')}: {preview.checksum}
          </p>
          <p className="text-sm">
            {t('systemSourceCentre')}: {preview.package.source?.centreSlug ?? '—'} ·
            {t('systemSourceLicense')}: {preview.package.source?.license ?? '—'}
          </p>
          <p className="text-sm">{t('systemMediaCount', { count: preview.package.media?.length ?? 0 })}</p>
          <h5 className="font-medium">{t('systemAnswerPreview')}</h5>
          <ul className="list-inside list-disc text-sm">
            {preview.package.answers.map((answer, i) => (
              <li key={i}>{systemBankPlainText(answer.answer)} {answer.isCorrect ? t('systemCorrectAnswer') : ''}</li>
            ))}
          </ul>
          <Button variant="ghost" disabled={busy} onClick={() => { setSelected(null); setPreview(null); }}>
            {t('systemReviewClose')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
