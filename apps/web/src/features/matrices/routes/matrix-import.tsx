import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Checkbox } from '@giaokhoa/ui/components/checkbox';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { DataTable, type DataColumn } from '#components/data-table';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { ApiError } from '#lib/api';
import { commitMatrixImport, downloadMatrixImportTemplate, previewMatrixImport } from '../api/matrix';
import { matrixBanksQueryOptions, useCurriculaBySubject } from '../queries/matrix';
import { curriculumSubjectsQueryOptions, useCurriculumSubjects } from '#lib/curriculum';
import { queryClient } from '#lib/query-client';
import { useCourseList } from '#features/courses/queries/course-new';
import { usePermissions } from '#lib/permissions';
import type { ExamMatrixView, MatrixImportIssue, MatrixImportPreview } from '@giaokhoa/contracts';
import { COGNITIVE_LEVELS, LEVEL_LABEL_KEYS, QTYPES, QTYPE_LABEL_KEYS, withApiReason } from '#features/questions/utils/shared';


const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs';

const STEP_KEYS = [
  'matrixImportStep1',
  'matrixImportStep2',
  'matrixImportStep3',
  'matrixImportStep4',
  'matrixImportStep5',
] as const;

function IssueTable({ issues }: { issues: MatrixImportIssue[] }) {
  const { t } = useTranslation('app');
  if (issues.length === 0) return null;
  const rows = issues.map((issue, index) => ({
    ...issue,
    rowKey: `${issue.code}-${issue.row ?? ''}-${issue.column ?? ''}-${index}`,
  }));
  type IssueRow = (typeof rows)[number];
  const columns: DataColumn<IssueRow>[] = [
    { id: 'sheet', header: t('matrixImportSheet'), cell: (issue) => issue.sheet ?? '—' },
    { id: 'row', header: t('matrixImportRow'), cell: (issue) => issue.row ?? '—' },
    { id: 'column', header: t('matrixImportColumn'), cell: (issue) => issue.column ?? '—' },
    { id: 'code', header: t('matrixImportCode'), cell: (issue) => issue.code },
    { id: 'message', header: t('matrixImportMessage'), cell: (issue) => issue.message },
  ];
  return (
    <div className="space-y-2">
      <h3 className="font-medium">{t('matrixImportErrors')}</h3>
      <DataTable
        data={rows}
        columns={columns}
        labels={{
          columns: t('dashboard:tableColumns'),
          previous: t('dashboard:tablePrevious'),
          next: t('dashboard:tableNext'),
          empty: t('dashboard:emptyTable'),
          pageInfo: (page, pages) => t('dashboard:tablePageInfo', { page, pages }),
        }}
        getRowId={(issue) => issue.rowKey}
        pageSize={100}
      />
    </div>
  );
}

export function MatrixImportPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const perms = usePermissions();

  const [step, setStep] = useState(1);
  const [subjectId, setSubjectId] = useState('');
  const [curriculumId, setCurriculumId] = useState('');
  const [includeAdvanced, setIncludeAdvanced] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MatrixImportPreview | null>(null);
  const [commitIssues, setCommitIssues] = useState<MatrixImportIssue[] | null>(null);
  const [committed, setCommitted] = useState<ExamMatrixView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);

  const coursesQuery = useCourseList();
  const forCourseId = coursesQuery.data?.[0]?.id;
  const subjectsQuery = useCurriculumSubjects(
    perms.ready && perms.canUseQuestionBank && coursesQuery.data !== undefined,
    forCourseId,
  );
  const subjects = subjectsQuery.data ?? [];
  const curriculaQuery = useCurriculaBySubject(subjectId, forCourseId);
  const curricula = curriculaQuery.data ?? [];
  const subjectsLoadFailed = subjectsQuery.isError || curriculaQuery.isError;

  const [previousCurriculumScope, setPreviousCurriculumScope] = useState({
    subjectId: '',
    curricula: undefined as typeof curriculaQuery.data,
  });
  if (previousCurriculumScope.subjectId !== subjectId || previousCurriculumScope.curricula !== curriculaQuery.data) {
    setPreviousCurriculumScope({ subjectId, curricula: curriculaQuery.data });
    if (!subjectId) {
      setCurriculumId('');
    } else if (curriculaQuery.data) {
      const rows = curriculaQuery.data;
      setCurriculumId((prev) => (rows.some((c) => c.id === prev) ? prev : (rows[0]?.id ?? '')));
    }
  }

  async function downloadTemplate() {
    if (!subjectId || !curriculumId) return;
    setTemplateBusy(true);
    try {
      await downloadMatrixImportTemplate({ subjectId, curriculumId, includeAdvanced });
      setMessage(null);
    } catch {
      setMessage(t('matrixImportTemplateFailed'));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function runPreview() {
    if (!file) {
      setMessage(t('matrixImportNoFile'));
      return;
    }
    setPreviewBusy(true);
    try {
      const result = await previewMatrixImport(file);
      setPreview(result);
      setCommitIssues(null);
      setMessage(null);
      setStep(3);
    } catch (err) {
      setMessage(withApiReason(t('matrixImportPreviewFailed'), err));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function runCommit() {
    if (!file || !preview?.valid) return;
    setCommitBusy(true);
    try {
      const result = await commitMatrixImport(file);
      setCommitted(result);
      setCommitIssues(null);
      setMessage(null);
      setStep(5);
    } catch (err) {
      if (err instanceof ApiError && err.problem.matrixImportIssues?.length) {
        setCommitIssues(err.problem.matrixImportIssues);
        setMessage(t('matrixImportCommitRejected'));
      } else {
        setMessage(withApiReason(t('matrixImportCommitFailed'), err));
      }
    } finally {
      setCommitBusy(false);
    }
  }

  function onFileChange(next: File | null) {
    setFile(next);
    setPreview(null);
    setCommitIssues(null);
  }

  if (!perms.ready) {
    return (
      <PageShell width="medium">
        <PageHeader title={t('matrixImport')} />
        <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full']} />
      </PageShell>
    );
  }
  if (!perms.canUseQuestionBank) {
    return (
      <PageShell width="medium">
        <PageHeader title={t('matrixImport')} />
        <Card>
          <CardHeader>
            <CardTitle>{t('myMatrixBank')}</CardTitle>
            <CardDescription>{t('matrixNoPersonalBank')}</CardDescription>
          </CardHeader>
        </Card>
        <p>
          <Link to="/matrices" className="text-sm underline">
            {t('backToQuestionBankList')}
          </Link>
        </p>
      </PageShell>
    );
  }

  const availabilityOf = (nodeId: string, level: string, qtype: string) =>
    preview?.availability.find(
      (a) => a.curriculumNodeId === nodeId && a.cognitiveLevel === level && a.qtype === qtype,
    );

  const previewCellRows = preview
    ? preview.rows.flatMap((row) =>
        preview.cells
          .filter((cell) => cell.curriculumNodeId === row.nodeId)
          .map((cell) => ({ row, cell })),
      )
    : [];
  type PreviewCellRow = (typeof previewCellRows)[number];
  const previewCellColumns: DataColumn<PreviewCellRow>[] = [
    { id: 'node', header: t('matrixCellNode'), cell: ({ row }) => `${row.topicTitle} · ${row.nodeTitle}` },
    {
      id: 'level',
      header: t('matrixCellLevel'),
      cell: ({ cell }) => t(LEVEL_LABEL_KEYS[cell.cognitiveLevel as (typeof COGNITIVE_LEVELS)[number]]),
    },
    {
      id: 'qtype',
      header: t('matrixCellQtype'),
      cell: ({ cell }) => t(QTYPE_LABEL_KEYS[cell.qtype as (typeof QTYPES)[number]]),
    },
    { id: 'count', header: t('matrixCellCount'), cell: ({ cell }) => cell.questionCount },
    { id: 'score', header: t('matrixCellScore'), cell: ({ cell }) => cell.cellScore },
    {
      id: 'availability',
      header: t('matrixImportAvailability'),
      cell: ({ cell }) => {
        const av = availabilityOf(cell.curriculumNodeId, cell.cognitiveLevel, cell.qtype);
        return av
          ? `${t('matrixAvailabilityRequired')}: ${av.required} · ${t('matrixAvailabilityAvailable')}: ${av.available} · ${t('matrixAvailabilityDeficit')}: ${av.deficit}`
          : '—';
      },
    },
  ];

  return (
    <PageShell width="medium">
      <PageHeader title={t('matrixImport')} />
      {message ? (
        <ErrorAlert>
          {message}
        </ErrorAlert>
      ) : null}
      <ol className="flex flex-wrap gap-2 text-sm">
        {STEP_KEYS.map((key, index) => (
          <li
            key={key}
            aria-current={step === index + 1 ? 'step' : undefined}
            className={step === index + 1 ? 'font-medium' : 'text-muted-foreground'}
          >
            {t(key)}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <Card>
          <CardContent className="pt-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="import-subject">{t('matrixSubject')}</FieldLabel>
                <select
                  id="import-subject"
                  className={SELECT_CLASS}
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  required
                >
                  <option value="">—</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="import-curriculum">{t('matrixCurriculum')}</FieldLabel>
                <select
                  id="import-curriculum"
                  className={SELECT_CLASS}
                  value={curriculumId}
                  onChange={(e) => setCurriculumId(e.target.value)}
                  required
                >
                  <option value="">—</option>
                  {curricula.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t('matrixGradeOption', { grade: c.grade })}
                    </option>
                  ))}
                </select>
              </Field>
              {subjectsLoadFailed ? (
                <ErrorAlert variant="destructive">
                  {t('matrixImportSubjectsFailed')}
                </ErrorAlert>
              ) : null}
              <p className="text-sm text-muted-foreground">{t('matrixCv7991Note')}</p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="import-advanced"
                  checked={includeAdvanced}
                  onCheckedChange={(v) => setIncludeAdvanced(v === true)}
                />
                <Label htmlFor="import-advanced">{t('matrixIncludeAdvanced')}</Label>
              </div>
              <p className="text-sm text-muted-foreground">{t('matrixImportTemplateHint')}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => void downloadTemplate()} disabled={!subjectId || !curriculumId || templateBusy}>
                  {t('matrixImportTemplateDownload')}
                </Button>
                <Button type="button" onClick={() => setStep(2)} disabled={!subjectId || !curriculumId}>
                  {t('matrixImportNext')}
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/matrices')}>
                  {t('backToQuestionBankList')}
                </Button>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardContent className="pt-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="import-file">{t('matrixImportFileLabel')}</FieldLabel>
                <Input
                  id="import-file"
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                />
              </Field>
              {file ? <p className="text-sm text-muted-foreground">{file.name}</p> : null}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>
                  {t('matrixImportBack')}
                </Button>
                <Button type="button" onClick={() => void runPreview()} disabled={!file || previewBusy}>
                  {t('matrixImportPreview')}
                </Button>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 && preview ? (
        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-1">
              <p className="font-medium">{preview.name ?? '—'}</p>
              <p className="text-sm text-muted-foreground">
                {t('matrixTotalScore')}: {preview.totalScore ?? '—'} ·{' '}
                {preview.levelSet === 'four' ? t('matrixImportLevelFour') : t('matrixImportLevelThree')}
              </p>
              <p className="text-sm font-medium">
                {t('matrixImportTotals', { count: preview.totals.totalQuestions, score: preview.totals.totalScore })}
              </p>
              {preview.totals.byForm.map((row) => (
                <p key={row.qtype} className="text-sm text-muted-foreground">
                  {t(QTYPE_LABEL_KEYS[row.qtype as (typeof QTYPES)[number]])}: {row.questionCount} · {row.score} ({row.percent}%)
                </p>
              ))}
            </div>
            {preview.warnings.length > 0 ? (
              <div className="space-y-1">
                <h3 className="font-medium">{t('matrixImportWarnings')}</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {preview.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <IssueTable issues={preview.errors} />
            {preview.valid ? (
              <div className="space-y-3">
                <h3 className="font-medium">{t('matrixImportCells')}</h3>
                <p className="text-sm text-muted-foreground">{t('matrixImportTruefalseNote')}</p>
                <DataTable
                  data={previewCellRows}
                  columns={previewCellColumns}
                  labels={{
                    columns: t('dashboard:tableColumns'),
                    previous: t('dashboard:tablePrevious'),
                    next: t('dashboard:tableNext'),
                    empty: t('dashboard:emptyTable'),
                    pageInfo: (page, pages) => t('dashboard:tablePageInfo', { page, pages }),
                  }}
                  getRowId={({ cell }) => `${cell.curriculumNodeId}-${cell.cognitiveLevel}-${cell.qtype}`}
                  pageSize={100}
                />
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                {t('matrixImportChooseOtherFile')}
              </Button>
              <Button type="button" onClick={() => setStep(4)} disabled={!preview.valid}>
                {t('matrixImportConfirm')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 && preview ? (
        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-1">
              <p className="font-medium">{preview.name ?? '—'}</p>
              <p className="text-sm font-medium">
                {t('matrixImportTotals', { count: preview.totals.totalQuestions, score: preview.totals.totalScore })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('matrixImportWarnings')}: {preview.warnings.length}
              </p>
            </div>
            {commitIssues ? <IssueTable issues={commitIssues} /> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                {t('matrixImportChooseOtherFile')}
              </Button>
              <Button type="button" onClick={() => void runCommit()} disabled={commitBusy}>
                {t('matrixImportCommit')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 5 && committed ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="font-medium">{t('matrixImportResult')}</p>
            <p className="text-sm text-muted-foreground">
              {committed.name} · {t('matrixTotalScore')}: {committed.totalScore} · {t('matrixCellsCount', { count: committed.cells.length })}
            </p>
            <div className="flex gap-2">
              <Button type="button" onClick={() => navigate(`/matrices/${committed.id}/edit`)}>
                {t('matrixImportOpenEdit')}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/matrices')}>
                {t('matrixImportBackToList')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}

export async function clientLoader() {
  await Promise.all([
    queryClient.prefetchQuery(matrixBanksQueryOptions()),
    queryClient.prefetchQuery(curriculumSubjectsQueryOptions()),
  ]);
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Nhập ma trận từ file');
}
export default MatrixImportPage;
