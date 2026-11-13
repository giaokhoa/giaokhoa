import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from '#components/collapsible-section';
import { SettingsShell } from '../components/settings-shell';
import '#config/i18n';
import { preferenceKey } from '#features/notifications/utils/notifications';
import { useMessagePreferences, useNotificationCourseOverrides, useSetMessagePreference, useSetNotificationCourseOverride } from '#features/notifications/queries/notifications';
import type { EmailFrequency, NotificationCourseOverrideView, NotificationGroupFilter, NotificationPreferenceView } from '#features/notifications/types/notifications';

const GROUP_ORDER: NotificationGroupFilter[] = ['learning', 'people', 'system'];

interface GroupSummary {
  group: NotificationGroupFilter;
  rows: NotificationPreferenceView[];
  changeable: NotificationPreferenceView[];
  popupState: boolean | 'mixed' | null;
  emailState: EmailFrequency | 'mixed' | null;
  hasMandatory: boolean;
  customized: boolean;
}

function summarizeGroup(group: NotificationGroupFilter, rows: NotificationPreferenceView[]): GroupSummary {
  const changeable = rows.filter((r) => r.siteEnabled);
  const popupValues = new Set(changeable.map((r) => r.popupEnabled));
  const popupState: GroupSummary['popupState'] =
    changeable.length === 0 ? null : popupValues.size > 1 ? 'mixed' : changeable[0]!.popupEnabled;
  const emailValues = new Set(
    changeable.filter((r) => r.emailFrequency !== null).map((r) => r.emailFrequency as EmailFrequency),
  );
  const emailState: GroupSummary['emailState'] =
    emailValues.size === 0 ? null : emailValues.size > 1 ? 'mixed' : [...emailValues][0]!;
  return {
    group,
    rows,
    changeable,
    popupState,
    emailState,
    hasMandatory: rows.some((r) => r.mandatoryInApp),
    customized: popupState === 'mixed' || emailState === 'mixed',
  };
}

export function SettingsNotificationsPage() {
  const { t, i18n } = useTranslation('app');
  const [savingPrefs, setSavingPrefs] = useState<ReadonlySet<string>>(new Set());
  const [savingGroups, setSavingGroups] = useState<ReadonlySet<string>>(new Set());
  const [savingOverrides, setSavingOverrides] = useState<ReadonlySet<string>>(new Set());
  const [prefError, setPrefError] = useState<string | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const prefsQuery = useMessagePreferences();
  const overridesQuery = useNotificationCourseOverrides();
  const preferenceMutation = useSetMessagePreference();
  const overrideMutation = useSetNotificationCourseOverride();

  const prefs = prefsQuery.data ?? [];
  const overrideCourses = overridesQuery.data ?? [];
  const loadError = prefsQuery.isError || overridesQuery.isError ? t('notificationsLoadFailed') : null;

  const groupLabel: Record<NotificationGroupFilter, string> = {
    learning: t('notificationsGroupLearning'),
    people: t('notificationsGroupPeople'),
    system: t('notificationsGroupSystem'),
  };
  const localized = (row: NotificationPreferenceView) =>
    i18n.language?.startsWith('en')
      ? { label: row.label.en, description: row.description.en }
      : { label: row.label.vi, description: row.description.vi };

  const summaries = GROUP_ORDER.map((group) => summarizeGroup(group, prefs.filter((p) => p.group === group))).filter(
    (s) => s.rows.length > 0,
  );
  const prefSections = GROUP_ORDER.map((group) => ({
    group,
    rows: prefs.filter((p) => p.group === group),
  })).filter((section) => section.rows.length > 0);

  function savePreference(row: NotificationPreferenceView, field: 'popup' | 'email', patch: { popupEnabled?: boolean; emailFrequency?: EmailFrequency }) {
    const key = `${preferenceKey(row)}|${field}`;
    if (savingPrefs.has(key)) return;
    setPrefError(null);
    setSavingPrefs((prev) => new Set(prev).add(key));
    preferenceMutation.mutate(
      { provider: row.provider, patch },
      {
        onError: () => setPrefError(t('preferenceSaveFailed')),
        onSettled: () =>
          setSavingPrefs((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          }),
      },
    );
  }

  function togglePopup(row: NotificationPreferenceView) {
    savePreference(row, 'popup', { popupEnabled: !row.popupEnabled });
  }

  function changeEmailFrequency(row: NotificationPreferenceView, frequency: EmailFrequency) {
    savePreference(row, 'email', { emailFrequency: frequency });
  }

  async function saveGroup(summary: GroupSummary, field: 'popup' | 'email', target: boolean | EmailFrequency) {
    if (savingGroups.has(summary.group)) return;
    setPrefError(null);
    setSavingGroups((prev) => new Set(prev).add(summary.group));
    try {
      for (const row of summary.changeable) {
        if (field === 'popup') {
          const targetPopup = target as boolean;
          if (row.popupEnabled === targetPopup) continue;
          if (!targetPopup && row.mandatoryInApp) continue;
          await preferenceMutation.mutateAsync({ provider: row.provider, patch: { popupEnabled: targetPopup } });
        } else {
          const targetFrequency = target as EmailFrequency;
          if (row.emailFrequency === null || row.emailFrequency === targetFrequency) continue;
          await preferenceMutation.mutateAsync({ provider: row.provider, patch: { emailFrequency: targetFrequency } });
        }
      }
    } catch {
      setPrefError(t('preferenceSaveFailed'));
    } finally {
      setSavingGroups((prev) => {
        const next = new Set(prev);
        next.delete(summary.group);
        return next;
      });
    }
  }

  function toggleCourseMute(course: NotificationCourseOverrideView) {
    if (savingOverrides.has(course.courseId)) return;
    setOverrideError(null);
    setSavingOverrides((prev) => new Set(prev).add(course.courseId));
    overrideMutation.mutate(
      { courseId: course.courseId, mode: course.mode === 'mute' ? 'all' : 'mute' },
      {
        onError: () => setOverrideError(t('courseOverrideSaveFailed')),
        onSettled: () =>
          setSavingOverrides((prev) => {
            const next = new Set(prev);
            next.delete(course.courseId);
            return next;
          }),
      },
    );
  }

  return (
    <SettingsShell>
      {loadError ? (
        <ErrorAlert variant="destructive">
          {loadError}
        </ErrorAlert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('notificationPreferences')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {prefError ? (
            <ErrorAlert variant="destructive">
              {prefError}
            </ErrorAlert>
          ) : null}
          {prefsQuery.isSuccess && prefs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('prefMinimalNote')}</p>
          ) : null}
          {summaries.map((summary) => {
            const emailSaving = savingGroups.has(summary.group);
            return (
              <section key={summary.group} aria-label={groupLabel[summary.group]} className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h3 className="min-w-32 flex-1 text-sm font-semibold">{groupLabel[summary.group]}</h3>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      aria-label={`${groupLabel[summary.group]} — ${t('prefInApp')}`}
                      type="checkbox"
                      checked={summary.popupState === true}
                      disabled={summary.popupState === null || emailSaving}
                      ref={(el) => {
                        if (el) el.indeterminate = summary.popupState === 'mixed';
                      }}
                      onChange={(e) => void saveGroup(summary, 'popup', e.target.checked)}
                    />
                    {t('prefInApp')}
                  </label>
                  {summary.emailState !== null ? (
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{t('prefEmail')}</span>
                      <select
                        aria-label={`${groupLabel[summary.group]} — ${t('prefEmail')}`}
                        value={summary.emailState}
                        disabled={emailSaving}
                        onChange={(e) => void saveGroup(summary, 'email', e.target.value as EmailFrequency)}
                      >
                        {summary.emailState === 'mixed' ? (
                          <option value="mixed" disabled>
                            {t('prefGroupCustomized')}
                          </option>
                        ) : null}
                        <option value="immediate">{t('prefEmailImmediate')}</option>
                        <option value="daily">{t('prefEmailDaily')}</option>
                        <option value="off">{t('prefEmailOff')}</option>
                      </select>
                    </label>
                  ) : null}
                </div>
                {summary.customized ? (
                  <p className="text-xs text-muted-foreground">{t('prefGroupCustomizedNote')}</p>
                ) : null}
                {summary.hasMandatory ? (
                  <p className="text-xs text-muted-foreground">{t('prefGroupMandatoryNote')}</p>
                ) : null}
              </section>
            );
          })}
        </CardContent>
      </Card>
      {prefs.length > 0 ? (
        <CollapsibleSection
          title={t('prefCustomizeTitle')}
          description={t('prefCustomizeDescription')}
          open={customizeOpen}
          onOpenChange={setCustomizeOpen}
          contentClassName="space-y-6"
        >
          {prefSections.map((section) => (
            <section key={section.group} aria-label={groupLabel[section.group]} className="space-y-3">
              <h3 className="text-sm font-semibold">{groupLabel[section.group]}</h3>
              <div className="grid grid-cols-[1fr_auto_auto] items-start gap-x-4 gap-y-1 text-sm">
                <span className="text-xs font-medium uppercase text-muted-foreground">{t('prefType')}</span>
                <span className="text-xs font-medium uppercase text-muted-foreground">{t('prefInApp')}</span>
                <span className="text-xs font-medium uppercase text-muted-foreground">{t('prefEmail')}</span>
                {section.rows.map((row) => {
                  const text = localized(row);
                  const emailSaving = savingPrefs.has(`${preferenceKey(row)}|email`);
                  return [
                    <div key={`${row.provider}-label`} className="min-w-0 border-t pt-2">
                      <p className="font-medium">
                        {text.label}
                        {row.teacherOnly ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{t('prefTeacherOnly')}</span>
                        ) : null}
                        {row.mandatoryInApp ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{t('prefMandatory')}</span>
                        ) : null}
                        {!row.siteEnabled ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{t('prefAdminDisabled')}</span>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground">{text.description}</p>
                      {row.mandatoryInApp ? <p className="text-xs text-muted-foreground">{t('prefMandatoryNote')}</p> : null}
                      {!row.siteEnabled ? <p className="text-xs text-muted-foreground">{t('prefAdminDisabledNote')}</p> : null}
                    </div>,
                    <div key={`${row.provider}-popup`} className="border-t pt-2">
                      <input
                        aria-label={`${text.label} — ${t('prefInApp')}`}
                        type="checkbox"
                        checked={row.popupEnabled}
                        disabled={row.mandatoryInApp || !row.siteEnabled || savingPrefs.has(`${preferenceKey(row)}|popup`)}
                        onChange={() => togglePopup(row)}
                      />
                    </div>,
                    <div key={`${row.provider}-email`} className="border-t pt-2">
                      {row.emailFrequency !== null ? (
                        <>
                          <select
                            aria-label={`${text.label} — ${t('prefEmail')}`}
                            value={row.emailFrequency}
                            disabled={!row.siteEnabled || emailSaving}
                            onChange={(e) => changeEmailFrequency(row, e.target.value as EmailFrequency)}
                          >
                            <option value="immediate">{t('prefEmailImmediate')}</option>
                            <option value="daily">{t('prefEmailDaily')}</option>
                            <option value="off">{t('prefEmailOff')}</option>
                          </select>
                          {!row.emailAvailable ? (
                            <p className="mt-1 max-w-56 text-xs text-muted-foreground">{t('prefChannelUnavailable')}</p>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>,
                  ];
                })}
              </div>
            </section>
          ))}
        </CollapsibleSection>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('courseExceptionsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('courseExceptionsDescription')}</p>
          {overrideError ? (
            <ErrorAlert variant="destructive">
              {overrideError}
            </ErrorAlert>
          ) : null}
          {overrideCourses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('courseExceptionsEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {overrideCourses.map((course) => (
                <li key={course.courseId} className="flex items-center gap-3 border-t pt-2 text-sm">
                  <span className="min-w-0 flex-1 font-medium">
                    {course.courseName}
                    {course.mode === 'mute' ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{t('courseMutedBadge')}</span>
                    ) : null}
                  </span>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`${t('courseMuteLabel')}: ${course.courseName}`}
                      checked={course.mode === 'mute'}
                      disabled={savingOverrides.has(course.courseId)}
                      onChange={() => toggleCourseMute(course)}
                    />
                    {t('courseMuteLabel')}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </SettingsShell>
  );
}

export default SettingsNotificationsPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('settingsNotifications');
}
