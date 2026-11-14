import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { acknowledgeSystemQuestionEvent, fetchSystemQuestionEvents, type SystemQuestionEvent } from '#lib/system-resource-events';

export function SystemSourceNotices({ resourceKind }: { resourceKind: 'exam' | 'material' | 'programme' }) {
  const { t } = useTranslation('app');
  const [events, setEvents] = useState<SystemQuestionEvent[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchSystemQuestionEvents().then((pending) => {
      if (live) { setEvents(pending.filter((event) => event.resourceKind === resourceKind)); setError(false); }
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [resourceKind]);

  async function acknowledge(eventId: string) {
    setBusy(eventId);
    try {
      await acknowledgeSystemQuestionEvent(eventId);
      setEvents((items) => items.filter((item) => item.id !== eventId));
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  if (!events.length && !error) return null;
  return <section className="space-y-2" aria-label={t('systemEventsTitle')}>
    <h4 className="font-semibold">{t('systemEventsTitle')}</h4>
    {error ? <p role="alert" className="text-sm">{t('systemEventsLoadFailed')}</p> : null}
    {events.map((event) => <div key={event.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
      <span>{t(event.type.endsWith('_withdrawn') ? 'systemResourceWithdrawn' : 'systemResourceUpdated')}</span>
      <code className="break-all">{event.resourceKey}</code>
      {event.payload.versionNumber || event.payload.version ? <span>· v{event.payload.versionNumber ?? event.payload.version}</span> : null}
      {event.payload.reason ? <span>· {event.payload.reason}</span> : null}
      <Button size="sm" variant="outline" disabled={busy !== null}
        onClick={() => void acknowledge(event.id)}>{t('systemEventAcknowledge')}</Button>
    </div>)}
  </section>;
}
