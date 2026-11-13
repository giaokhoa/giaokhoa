import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@giaokhoa/ui/components/sheet';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { apiFetch } from '#lib/api';
import { currentMonthRangeIso } from '../utils/calendar';
import { useCalendarEvents, useCalendarExportToken, useCalendarSubscriptions, useCreateCalendarEvent, useCreateCalendarExportToken, useCreateCalendarSubscription, useDeleteCalendarEvent, useImportCalendarSubscription, useRemindCalendarEvent, useRevokeCalendarExportToken } from '../queries/calendar';
import type { CalendarEventView as EventView, CalendarExportTokenView, CalendarSubscriptionView } from '../types/calendar';
import { formatTime, formatWithOptions } from '#utils/date-format';
import { queryKeys } from '#lib/query-keys';
import { queryKeys as calendarQueryKeys } from '../queries/keys';
import { buildSsrLoaderData, serverQueryFn, type SsrLoaderData } from '#lib/ssr-data';

const TYPES = ['all', 'site', 'category', 'course', 'group', 'user'] as const;
const EVENT_TYPES = ['user', 'site', 'category', 'course', 'group'] as const;

export async function loader({ request }: { request: Request }): Promise<SsrLoaderData> {
  const range = currentMonthRangeIso();
  return buildSsrLoaderData(request, async (queryClient, req) => {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: queryKeys.calendarEvents(range.from, range.to),
        queryFn: serverQueryFn<EventView[]>(req, `/api/v1/calendar/events?from=${range.from}&to=${range.to}`),
      }),
      queryClient.prefetchQuery({
        queryKey: calendarQueryKeys.calendarSubscriptions,
        queryFn: serverQueryFn<CalendarSubscriptionView[]>(req, '/api/v1/calendar/subscriptions'),
      }),
      queryClient.prefetchQuery({
        queryKey: calendarQueryKeys.calendarExportToken,
        queryFn: serverQueryFn<CalendarExportTokenView | null>(req, '/api/v1/calendar/export-token'),
      }),
    ]);
  });
}

export function CalendarPage() {
  const { t, i18n } = useTranslation('app');
  const [typeFilter, setTypeFilter] = useState<(typeof TYPES)[number]>('all');
  const [message, setMessage] = useState<string | null>(null);
  const [eventSheetOpen, setEventSheetOpen] = useState(false);
  const [evName, setEvName] = useState('');
  const [evDescription, setEvDescription] = useState('');
  const [evType, setEvType] = useState<(typeof EVENT_TYPES)[number]>('user');
  const [evStart, setEvStart] = useState('');
  const [evDuration, setEvDuration] = useState('3600');
  const [evLocation, setEvLocation] = useState('');
  const [evCourseId, setEvCourseId] = useState('');
  const [evGroupId, setEvGroupId] = useState('');
  const [evCategoryId, setEvCategoryId] = useState('');
  const [subName, setSubName] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [now] = useState(() => new Date());
  const range = useMemo(() => currentMonthRangeIso(), []);

  const eventsQuery = useCalendarEvents(range.from, range.to);
  const subscriptionsQuery = useCalendarSubscriptions();
  const exportTokenQuery = useCalendarExportToken();
  const createEventMutation = useCreateCalendarEvent();
  const deleteEventMutation = useDeleteCalendarEvent();
  const remindMutation = useRemindCalendarEvent();
  const createSubscriptionMutation = useCreateCalendarSubscription();
  const importSubscriptionMutation = useImportCalendarSubscription();
  const createTokenMutation = useCreateCalendarExportToken();
  const revokeTokenMutation = useRevokeCalendarExportToken();

  const events = eventsQuery.data ?? [];
  const subscriptions = subscriptionsQuery.data ?? [];
  const exportToken = exportTokenQuery.data ?? null;
  const loading = eventsQuery.isPending;
  const loadFailed = eventsQuery.isError;

  function createEvent(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    createEventMutation.mutate(
      {
        name: evName,
        ...(evDescription ? { description: evDescription } : {}),
        eventType: evType,
        timeStart: new Date(evStart).toISOString(),
        ...(evDuration ? { timeDuration: Number(evDuration) } : {}),
        ...(evLocation ? { location: evLocation } : {}),
        ...(evType === 'course' || evType === 'group' ? { courseId: evCourseId } : {}),
        ...(evType === 'group' ? { groupId: evGroupId } : {}),
        ...(evType === 'category' ? { categoryId: evCategoryId } : {}),
      },
      {
        onSuccess: () => {
          setEvName('');
          setEvDescription('');
          setEvLocation('');
          setMessage(t('eventCreated'));
          setEventSheetOpen(false);
        },
        onError: () => setMessage(t('eventCreateFailed')),
      },
    );
  }

  function deleteEvent(id: string) {
    setMessage(null);
    deleteEventMutation.mutate(id, {
      onSuccess: () => setMessage(t('eventDeleted')),
      onError: () => setMessage(t('eventDeleteFailed')),
    });
  }

  function remind(id: string) {
    setMessage(null);
    remindMutation.mutate(id, {
      onSuccess: () => setMessage(t('reminderSet')),
      onError: () => setMessage(t('reminderFailed')),
    });
  }

  function createSubscription(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    createSubscriptionMutation.mutate(
      { name: subName, url: subUrl },
      {
        onSuccess: () => {
          setSubName('');
          setSubUrl('');
          setMessage(t('subscriptionCreated'));
        },
        onError: () => setMessage(t('subscriptionCreateFailed')),
      },
    );
  }

  function importSubscription(id: string) {
    setMessage(null);
    importSubscriptionMutation.mutate(id, {
      onSuccess: () => setMessage(t('importQueued')),
      onError: () => setMessage(t('importFailed')),
    });
  }

  async function downloadIcs() {
    setMessage(null);
    try {
      const response = await apiFetch('/api/v1/calendar/exports?format=ics');
      if (!response.ok) throw new Error('export failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'calendar.ics';
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setMessage(t('downloadIcsFailed'));
    }
  }

  function createExportToken() {
    setMessage(null);
    createTokenMutation.mutate(undefined, {
      onSuccess: () => setMessage(t('exportTokenCreated')),
      onError: () => setMessage(t('exportTokenCreateFailed')),
    });
  }

  function revokeExportToken() {
    setMessage(null);
    revokeTokenMutation.mutate(undefined, {
      onSuccess: () => setMessage(t('exportTokenRevoked')),
      onError: () => setMessage(t('exportTokenRevokeFailed')),
    });
  }

  const visible = events.filter((e) => typeFilter === 'all' || e.eventType === typeFilter);
  const byDay = new Map<string, { date: Date; events: EventView[] }>();
  for (const e of visible) {
    const start = new Date(e.timeStart);
    const key = `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
    const group = byDay.get(key) ?? { date: start, events: [] };
    group.events.push(e);
    byDay.set(key, group);
  }

  return (
    <PageShell width="full">
      <PageHeader
        title={t('calendarTitle', { month: formatWithOptions(now, i18n.language, { month: 'long', year: 'numeric' }) })}
        actions={
          <Sheet open={eventSheetOpen} onOpenChange={setEventSheetOpen}>
            <SheetTrigger render={<Button type="button" />}>{t('newEvent')}</SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{t('createEventTitle')}</SheetTitle>
              </SheetHeader>
              <form onSubmit={(e) => createEvent(e)} className="px-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="ev-name">{t('eventName')}</FieldLabel>
                    <Input id="ev-name" value={evName} onChange={(e) => setEvName(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ev-description">{t('eventDescription')}</FieldLabel>
                    <Input
                      id="ev-description"
                      value={evDescription}
                      onChange={(e) => setEvDescription(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel id="ev-type-label">{t('eventType')}</FieldLabel>
                    <Select
                      items={Object.fromEntries(
                        EVENT_TYPES.map((type) => [type, t(`eventType${type[0]!.toUpperCase()}${type.slice(1)}`)]),
                      )}
                      value={evType}
                      onValueChange={(v) => setEvType((v ?? 'user') as (typeof EVENT_TYPES)[number])}
                    >
                      <SelectTrigger aria-labelledby="ev-type-label" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`eventType${type[0]!.toUpperCase()}${type.slice(1)}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ev-start">{t('eventStart')}</FieldLabel>
                    <Input
                      id="ev-start"
                      type="datetime-local"
                      value={evStart}
                      onChange={(e) => setEvStart(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ev-duration">{t('eventDurationSeconds')}</FieldLabel>
                    <Input
                      id="ev-duration"
                      type="number"
                      value={evDuration}
                      onChange={(e) => setEvDuration(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ev-location">{t('eventLocation')}</FieldLabel>
                    <Input id="ev-location" value={evLocation} onChange={(e) => setEvLocation(e.target.value)} />
                  </Field>
                  {evType === 'course' || evType === 'group' ? (
                    <Field>
                      <FieldLabel htmlFor="ev-course">{t('eventCourseId')}</FieldLabel>
                      <Input id="ev-course" value={evCourseId} onChange={(e) => setEvCourseId(e.target.value)} />
                    </Field>
                  ) : null}
                  {evType === 'group' ? (
                    <Field>
                      <FieldLabel htmlFor="ev-group">{t('eventGroupId')}</FieldLabel>
                      <Input id="ev-group" value={evGroupId} onChange={(e) => setEvGroupId(e.target.value)} />
                    </Field>
                  ) : null}
                  {evType === 'category' ? (
                    <Field>
                      <FieldLabel htmlFor="ev-category">{t('eventCategoryId')}</FieldLabel>
                      <Input
                        id="ev-category"
                        value={evCategoryId}
                        onChange={(e) => setEvCategoryId(e.target.value)}
                      />
                    </Field>
                  ) : null}
                  <div className="flex justify-end">
                    <Button type="submit">{t('createEvent')}</Button>
                  </div>
                </FieldGroup>
              </form>
            </SheetContent>
          </Sheet>
        }
      />
      {loadFailed ? (
        <>
          <ErrorAlert variant="destructive">
            {t('calendarLoadFailed')}
          </ErrorAlert>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void eventsQuery.refetch();
                void subscriptionsQuery.refetch();
                void exportTokenQuery.refetch();
              }}
            >
              {t('retry')}
            </Button>
          </div>
        </>
      ) : null}
      {message ? (
        <ErrorAlert>
          {message}
        </ErrorAlert>
      ) : null}
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <Field>
              <FieldLabel id="type-filter-label">{t('eventType')}</FieldLabel>
              <Select
                items={Object.fromEntries(
                  TYPES.map((type) => [type, t(`eventType${type[0]!.toUpperCase()}${type.slice(1)}`)]),
                )}
                value={typeFilter}
                onValueChange={(v) => setTypeFilter((v ?? 'all') as (typeof TYPES)[number])}
              >
                <SelectTrigger aria-labelledby="type-filter-label" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`eventType${type[0]!.toUpperCase()}${type.slice(1)}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {loading ? (
            <PageSkeleton label={t('loading')} rows={['h-16 w-full', 'h-16 w-full']} />
          ) : (
            <>
              {[...byDay.entries()].map(([key, group]) => (
                <section key={key} aria-label={formatWithOptions(group.date, i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
                  <h3 className="font-medium">{formatWithOptions(group.date, i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>
                  <ul className="space-y-1">
                    {group.events.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 rounded border p-2 text-sm">
                        <span className="font-medium">{e.name}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {e.eventType} · {formatTime(e.timeStart, i18n.language)}
                        </span>
                        {e.isException ? <span> {t('adjustedOccurrence')}</span> : null}
                        <Button type="button" variant="outline" onClick={() => remind(e.id)}>
                          {t('remindOneHour')}
                        </Button>
                        {e.eventType === 'user' ? (
                          <Button type="button" variant="outline" onClick={() => deleteEvent(e.id)}>
                            {t('deleteEvent')}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {visible.length === 0 ? (
                <Empty className="p-6">
                  <EmptyHeader>
                    <EmptyTitle>{t('noEventsThisMonth')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('calendarExportTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('calendarExportDescription')}</p>
          <Button type="button" variant="outline" onClick={() => void downloadIcs()}>
            {t('downloadIcs')}
          </Button>
          <Field>
            <FieldLabel htmlFor="export-token-url">{t('exportToken')}</FieldLabel>
            {exportToken ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input id="export-token-url" readOnly value={exportToken.url} className="max-w-xl" />
                <Button type="button" variant="destructive" onClick={() => revokeExportToken()}>
                  {t('revokeExportToken')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted-foreground">{t('noExportToken')}</p>
                <Button type="button" onClick={() => createExportToken()}>
                  {t('createExportToken')}
                </Button>
              </div>
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('subscriptionsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {subscriptions.map((s) => (
              <li key={s.id} data-testid={`subscription-${s.id}`} className="flex items-center gap-3">
                <span>{s.name}</span>
                <span className="text-sm text-muted-foreground">{s.url ?? ''}</span>
                <Button type="button" variant="outline" onClick={() => importSubscription(s.id)}>
                  {t('importSubscription')}
                </Button>
              </li>
            ))}
          </ul>
          {subscriptions.length === 0 ? (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyTitle>{t('noSubscriptions')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : null}
          <form onSubmit={(e) => createSubscription(e)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="sub-name">{t('subscriptionName')}</FieldLabel>
                <Input id="sub-name" value={subName} onChange={(e) => setSubName(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="sub-url">{t('subscriptionUrl')}</FieldLabel>
                <Input id="sub-url" value={subUrl} onChange={(e) => setSubUrl(e.target.value)} />
              </Field>
              <div className="flex justify-end">
                <Button type="submit">{t('addSubscription')}</Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default CalendarPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navCalendar');
}
