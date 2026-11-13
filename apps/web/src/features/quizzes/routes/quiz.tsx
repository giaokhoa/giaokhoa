import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { type PinRegradeLogEntry, type PinRegradeResult, type PinVersionUpdatePreview } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, PageShell } from '#components/page-shell';
import { AttemptsPanel } from '../components/attempts-panel';
import { OverridesPanel } from '../components/overrides-panel';
import { PinPanel } from '../components/pin-panel';
import { RegradePanel } from '../components/regrade-panel';
import { SettingsForm } from '../components/settings-form';
import { toLocalInput } from '../utils/utils';
import '#config/i18n';
import { ApiError } from '#lib/api';
import { examPinQueryOptions, examPinVersionUpdateQueryOptions, regradeQuestionVersionsQueryOptions, useApplyExamPinVersionUpdate, useCourseRoster, useExamPin, useExamPinMyRegrades, useExamPinOverrides, useExamPinRegrades, useExamSource, useRunExamPinRegrade, useStartExamPinAttempt, useUpdateExamPinSettings } from '../queries/quiz';
import { courseGroupsQueryOptions } from '#features/progress-report/queries/progress-report';
import { queryClient } from '#lib/query-client';

export function QuizPage() {
  const { t } = useTranslation('app');
  const { id: courseId, pinId: quizId } = useParams();
  const navigate = useNavigate();
  const pinQuery = useExamPin(quizId ?? '');
  const data = pinQuery.data?.view ?? null;
  const slotNames = pinQuery.data?.slotNames ?? {};
  const { refetch } = pinQuery;
  const error = pinQuery.isError ? t('quizLoadFailed') : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [intro, setIntro] = useState('');
  const [timeOpen, setTimeOpen] = useState('');
  const [timeClose, setTimeClose] = useState('');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState('');
  const [attemptsAllowed, setAttemptsAllowed] = useState('0');
  const [gradeMethod, setGradeMethod] = useState('highest');
  const [grade, setGrade] = useState('10');
  const [shuffleAnswers, setShuffleAnswers] = useState(false);
  const [versionMode, setVersionMode] = useState<'pinned' | 'float_latest_ready'>('pinned');

  const [updatePreview, setUpdatePreview] = useState<PinVersionUpdatePreview | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [regradeQuestionId, setRegradeQuestionId] = useState('');
  const [regradeVersions, setRegradeVersions] = useState<{ id: string; version: number; status: string }[]>([]);
  const [regradeVersionId, setRegradeVersionId] = useState('');
  const [regradePreview, setRegradePreview] = useState<PinRegradeResult | null>(null);
  const [regradeError, setRegradeError] = useState<string | null>(null);

  const myRegradesQuery = useExamPinMyRegrades(quizId ?? '');
  const myRegrades = myRegradesQuery.data ?? [];

  const regradeLogQuery = useExamPinRegrades(quizId ?? '', !!data?.permissions.grade);
  const regradeLog: PinRegradeLogEntry[] | null = regradeLogQuery.isError ? [] : (regradeLogQuery.data ?? null);

  const examInfo = useExamSource(data?.quiz.examId, !!data?.permissions.manage).data ?? null;

  const overridesQuery = useExamPinOverrides(quizId ?? '', !!data?.permissions.manageOverrides);
  const overrides = overridesQuery.data ?? [];
  const overridesLoaded = overridesQuery.isSuccess || overridesQuery.isError;
  const roster =
    useCourseRoster(courseId ?? '', !!(data?.permissions.manageOverrides || data?.permissions.grade)).data ?? [];
  const groups =
    useQuery({
      ...courseGroupsQueryOptions(courseId ?? ''),
      enabled: !!courseId && !!(data?.permissions.manage || data?.permissions.manageOverrides),
    }).data ?? [];

  const [previousQuizData, setPreviousQuizData] = useState<typeof data | undefined>(undefined);
  if (previousQuizData !== data) {
    setPreviousQuizData(data);
    if (data) {
      setName(data.quiz.name);
      setIntro(data.quiz.intro);
      setTimeOpen(toLocalInput(data.quiz.timeOpen));
      setTimeClose(toLocalInput(data.quiz.timeClose));
      setTimeLimitMinutes(data.quiz.timeLimitSeconds ? String(Math.round(data.quiz.timeLimitSeconds / 60)) : '');
      setAttemptsAllowed(String(data.quiz.attemptsAllowed));
      setGradeMethod(data.quiz.gradeMethod);
      setGrade(String(data.quiz.grade));
      setShuffleAnswers(data.quiz.shuffleAnswers);
      setVersionMode(data.quiz.versionMode);
    }
  }

  const reload = useCallback(async () => {
    const result = await refetch();
    if (result.error) throw result.error;
  }, [refetch]);

  const settingsMutation = useUpdateExamPinSettings(quizId ?? '');
  const versionUpdateMutation = useApplyExamPinVersionUpdate(quizId ?? '');
  const regradeMutation = useRunExamPinRegrade(quizId ?? '');
  const startAttemptMutation = useStartExamPinAttempt(quizId ?? '');

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    setBusy(true);
    try {
      await settingsMutation.mutateAsync({
        name: name.trim(),
        intro,
        timeOpen: timeOpen ? new Date(timeOpen).toISOString() : null,
        timeClose: timeClose ? new Date(timeClose).toISOString() : null,
        timeLimitSeconds: timeLimitMinutes.trim() ? Math.max(1, Math.round(Number(timeLimitMinutes))) * 60 : null,
        attemptsAllowed: Math.max(0, Math.trunc(Number(attemptsAllowed) || 0)),
        gradeMethod,
        grade: Number(grade) || 10,
        shuffleAnswers,
        versionMode,
      });
      await reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.problem.code === 'exam.version_mode_not_allowed'
          ? t('pinVersionModeNotAllowed')
          : t('quizActionFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadUpdatePreview() {
    setUpdateError(null);
    setBusy(true);
    try {
      setUpdatePreview(await queryClient.fetchQuery(examPinVersionUpdateQueryOptions(quizId ?? '')));
    } catch {
      setUpdateError(t('pinVersionUpdateFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function applyUpdate() {
    if (!updatePreview?.toExamVersionId) return;
    setUpdateError(null);
    setBusy(true);
    try {
      await versionUpdateMutation.mutateAsync(updatePreview.toExamVersionId);
      setUpdatePreview(null);
      await reload();
    } catch (err) {
      setUpdateError(
        err instanceof ApiError && err.problem.code === 'exam.pin_locked'
          ? t('pinVersionLocked')
          : t('pinVersionUpdateFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadRegradeVersions(questionId: string) {
    setRegradePreview(null);
    setRegradeError(null);
    if (!questionId) {
      setRegradeVersions([]);
      setRegradeVersionId('');
      return;
    }
    try {
      const versions = await queryClient.fetchQuery(regradeQuestionVersionsQueryOptions(questionId));
      setRegradeVersions(versions);
      const ready = versions.filter((v) => v.status === 'ready');
      setRegradeVersionId((ready.length ? ready[ready.length - 1]! : versions[versions.length - 1])?.id ?? '');
    } catch {
      setRegradeVersions([]);
      setRegradeVersionId('');
      setRegradeError(t('regradeFailed'));
    }
  }

  function handleRegradeQuestionChange(v: string | null) {
    setRegradeQuestionId(v ?? '');
    void loadRegradeVersions(v ?? '');
  }

  async function runRegrade(dryRun: boolean) {
    if (!regradeQuestionId || !regradeVersionId) return;
    setRegradeError(null);
    setBusy(true);
    try {
      const result = await regradeMutation.mutateAsync({
        questionId: regradeQuestionId,
        toVersionId: regradeVersionId,
        dryRun,
      });
      setRegradePreview(result);
      if (!dryRun) {
        await regradeLogQuery.refetch();
        await reload();
        void myRegradesQuery.refetch();
      }
    } catch {
      setRegradeError(t('regradeFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function startAttempt(preview: boolean) {
    setActionError(null);
    try {
      const view = await startAttemptMutation.mutateAsync(preview);
      await navigate(`/quiz-attempts/${view.attempt.id}`);
    } catch {
      setActionError(t('quizActionFailed'));
    }
  }

  if (error)
    return (
      <PageShell width="medium">
        <PageHeader title={t('quizHeading')} />
        <ErrorAlert variant="destructive">
          {error}
        </ErrorAlert>
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void reload().catch(() => undefined);
            }}
          >
            {t('retry')}
          </Button>
        </div>
      </PageShell>
    );
  if (!data)
    return (
      <PageShell width="medium">
        <PageHeader title={t('quizHeading')} />
        <PageSkeleton label={t('quizLoading')} rows={['h-4 w-56', 'h-4 w-80', 'h-4 w-64']} />
      </PageShell>
    );

  const { quiz, permissions } = data;
  return (
    <PageShell width="medium">
      <PageHeader title={quiz.name} description={t('quizIntroLine', { total: quiz.sumGrades, grade: quiz.grade })} />
      <AttemptsPanel
        courseId={courseId}
        quizId={quizId}
        data={data}
        myRegrades={myRegrades}
        actionError={actionError}
        startAttempt={startAttempt}
      />

      {permissions.manage ? (
        <>
          <PinPanel
            quiz={quiz}
            slotNames={slotNames}
            examInfo={examInfo}
            groups={groups}
            updatePreview={updatePreview}
            updateError={updateError}
            busy={busy}
            loadUpdatePreview={loadUpdatePreview}
            applyUpdate={applyUpdate}
            setUpdatePreview={setUpdatePreview}
          />
          <SettingsForm
            name={name}
            intro={intro}
            timeOpen={timeOpen}
            timeClose={timeClose}
            timeLimitMinutes={timeLimitMinutes}
            attemptsAllowed={attemptsAllowed}
            gradeMethod={gradeMethod}
            grade={grade}
            shuffleAnswers={shuffleAnswers}
            versionMode={versionMode}
            busy={busy}
            saveSettings={saveSettings}
            setName={setName}
            setIntro={setIntro}
            setTimeOpen={setTimeOpen}
            setTimeClose={setTimeClose}
            setTimeLimitMinutes={setTimeLimitMinutes}
            setAttemptsAllowed={setAttemptsAllowed}
            setGradeMethod={setGradeMethod}
            setGrade={setGrade}
            setShuffleAnswers={setShuffleAnswers}
            setVersionMode={setVersionMode}
          />
        </>
      ) : null}

      {permissions.grade ? (
        <RegradePanel
          quiz={quiz}
          slotNames={slotNames}
          roster={roster}
          regradeError={regradeError}
          regradeQuestionId={regradeQuestionId}
          regradeVersions={regradeVersions}
          regradeVersionId={regradeVersionId}
          regradePreview={regradePreview}
          regradeLog={regradeLog}
          busy={busy}
          onRegradeQuestionChange={handleRegradeQuestionChange}
          setRegradeVersionId={setRegradeVersionId}
          runRegrade={runRegrade}
        />
      ) : null}

      {permissions.manageOverrides ? (
        <OverridesPanel
          pinId={quizId ?? ''}
          overrides={overrides}
          overridesLoaded={overridesLoaded}
          overridesIsError={overridesQuery.isError}
          roster={roster}
          groups={groups}
          busy={busy}
          setBusy={setBusy}
        />
      ) : null}

      <p className="text-sm">
        <Link to={`/courses/${courseId}`}>{t('quizBackToCourse')}</Link>
      </p>
    </PageShell>
  );
}

export default function QuizRoute() {
  return <QuizPage />;
}

export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.pinId) {
    await queryClient.prefetchQuery(examPinQueryOptions(params.pinId));
  }
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Bài kiểm tra');
}
