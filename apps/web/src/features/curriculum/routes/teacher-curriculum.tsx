import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { Label } from '@giaokhoa/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@giaokhoa/ui/components/select';
import { ErrorAlert } from '#components/error-alert';
import { PageHeader, PageShell } from '#components/page-shell';
import { ProgramGroupTable } from '#features/admin-curriculum/components/program-group-table';
import { buildProgramGroups, PROGRAM_PAGE_SIZE } from '#features/admin-curriculum/components/tree-page';
import { ApiError } from '#lib/api';
import { useAccessContexts } from '#lib/access';
import { useCourseList } from '#features/courses/queries/course-new';
import {
  useCurriculumCurriculaScoped,
  useCurriculumSubjectsScoped,
  useCurriculumTreeScoped,
  type CurriculumTree,
} from '#lib/curriculum';
import '#config/i18n';


type ProgramGroup = ReturnType<typeof buildProgramGroups>[number];

function pageNumberItems(total: number, current: number): (number | 'gap')[] {
  if (total <= 12) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
  const nums = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let prev = 0;
  for (const n of nums) {
    if (prev > 0 && n - prev > 1) out.push('gap');
    out.push(n);
    prev = n;
  }
  return out;
}

export function TeacherCurriculumPage() {
  const { t } = useTranslation('app');
  const coursesQuery = useCourseList();
  const courses = coursesQuery.data ?? null;
  const [courseSelection, setCourseSelection] = useState<string | null>(null);
  const courseId =
    courses === null
      ? (courseSelection ?? '')
      : courseSelection && courses.some((c) => c.id === courseSelection)
        ? courseSelection
        : (courses[0]?.id ?? '');
  const course = courses?.find((c) => c.id === courseId);

  const contextsQuery = useAccessContexts();
  const systemContextId = contextsQuery.data?.find((c) => c.contextLevel === 10)?.id ?? null;
  const subjectsQuery = useCurriculumSubjectsScoped(
    systemContextId,
    courseId || undefined,
    courses !== null,
  );
  const subjectsLoaded =
    subjectsQuery.data !== undefined ||
    subjectsQuery.isError ||
    (contextsQuery.data !== undefined && systemContextId === null);
  const subjects = subjectsQuery.data ?? (subjectsLoaded ? [] : null);
  const [subjectSelection, setSubjectSelection] = useState<string | null>(null);
  const subjectId =
    subjects === null
      ? (subjectSelection ?? '')
      : course?.subjectId && subjects.some((s) => s.id === course.subjectId)
        ? course.subjectId
        : subjectSelection && subjects.some((s) => s.id === subjectSelection)
          ? subjectSelection
          : (subjects[0]?.id ?? '');

  const curriculaQuery = useCurriculumCurriculaScoped(
    subjectId,
    courseId || undefined,
    subjects !== null,
  );
  const curriculaLoaded = curriculaQuery.data !== undefined || curriculaQuery.isError;
  const curricula = curriculaQuery.data
    ? [...curriculaQuery.data].sort((a, b) => a.grade - b.grade)
    : curriculaLoaded
      ? []
      : null;
  const [curriculumSelection, setCurriculumSelection] = useState<string | null>(null);
  const preferredCurriculum =
    course?.subjectId === subjectId && course?.grade != null
      ? curricula?.find((c) => c.grade === course.grade)
      : undefined;
  const curriculumId =
    curricula === null
      ? (curriculumSelection ?? '')
      : (preferredCurriculum?.id ??
        (curriculumSelection && curricula.some((c) => c.id === curriculumSelection)
          ? curriculumSelection
          : (curricula[0]?.id ?? '')));

  const treeQuery = useCurriculumTreeScoped(curriculumId, courseId || undefined, curricula !== null);
  const tree: CurriculumTree | null = treeQuery.data ?? null;

  const isForbiddenError = (error: unknown) =>
    error instanceof ApiError && error.problem.status === 403;
  const forbidden = [
    subjectsQuery.error,
    curriculaQuery.error,
    treeQuery.error,
  ].some((error) => error != null && isForbiddenError(error));

  const [page, setPage] = useState(1);
  const groupsTopRef = useRef<HTMLDivElement | null>(null);

  const pageScope = curriculumId + ':' + courseId;
  const [previousPageScope, setPreviousPageScope] = useState(pageScope);
  if (pageScope !== previousPageScope) {
    setPreviousPageScope(pageScope);
    setPage(1);
  }

  const groups: ProgramGroup[] = tree ? buildProgramGroups(tree) : [];
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / PROGRAM_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PROGRAM_PAGE_SIZE;
  const pageEnd = pageStart + PROGRAM_PAGE_SIZE;
  const segments: { group: ProgramGroup; rows: ProgramGroup['rows']; continued: boolean }[] = [];
  if (tree) {
    let cursor = 0;
    for (const group of groups) {
      const start = cursor;
      const end = start + group.rows.length;
      cursor = end;
      if (group.rows.length === 0) {
        const attachIndex = Math.min(start, Math.max(totalRows - 1, 0));
        if (Math.floor(attachIndex / PROGRAM_PAGE_SIZE) + 1 === currentPage) {
          segments.push({ group, rows: [], continued: false });
        }
        continue;
      }
      const from = Math.max(start, pageStart);
      const to = Math.min(end, pageEnd);
      if (from < to) {
        segments.push({ group, rows: group.rows.slice(from - start, to - start), continued: start < pageStart });
      }
    }
  }

  function goToPage(next: number) {
    setPage(Math.max(1, Math.min(next, totalPages)));
    groupsTopRef.current?.scrollIntoView?.({ block: 'start' });
  }

  const hasCourses = courses !== null && courses.length > 0;

  return (
    <PageShell>
      <PageHeader title={t('teacherProgrammeTitle')} description={t('teacherProgrammeDescription')} />
      {forbidden ? (
        <ErrorAlert variant="destructive">
          {hasCourses ? t('teacherProgrammeForbidden') : t('teacherProgrammeNoCourse')}
        </ErrorAlert>
      ) : null}
      {!forbidden && courses !== null && !hasCourses && subjects !== null && subjects.length === 0 ? (
        <ErrorAlert>
          {t('teacherProgrammeNoCourse')}
        </ErrorAlert>
      ) : null}
      <div className="flex flex-wrap items-end gap-4">
        {hasCourses ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="teacher-programme-course">{t('teacherProgrammeCourseLabel')}</Label>
            <Select value={courseId} onValueChange={(value) => setCourseSelection(value ?? '')}>
              <SelectTrigger id="teacher-programme-course" className="w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {subjects !== null && subjects.length > 0 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="teacher-programme-subject">{t('teacherProgrammeSubjectLabel')}</Label>
            <Select value={subjectId} onValueChange={(value) => setSubjectSelection(value ?? '')}>
              <SelectTrigger id="teacher-programme-subject" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {curricula !== null && curricula.length > 0 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="teacher-programme-grade">{t('teacherProgrammeGradeLabel')}</Label>
            <Select value={curriculumId} onValueChange={(value) => setCurriculumSelection(value ?? '')}>
              <SelectTrigger id="teacher-programme-grade" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {curricula.map((curriculum) => (
                  <SelectItem key={curriculum.id} value={curriculum.id}>
                    {t('curriculumGradeLabel', { grade: curriculum.grade })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      {tree ? (
        <>
          <h2 className="text-lg font-semibold">
            {t('curriculumTreeTitle', { subject: tree.subject.name, grade: tree.curriculum.grade })}
          </h2>
          <div className="flex flex-col gap-4" ref={groupsTopRef}>
            {segments.map(({ group, rows, continued }) => (
              <ProgramGroupTable
                key={`${group.key}-${continued ? 'cont' : 'start'}`}
                title={group.title}
                groupNode={group.groupNode}
                rows={rows}
                curriculumId={tree.curriculum.id}
                continued={continued}
                readOnly
              />
            ))}
          </div>
          {totalPages > 1 ? (
            <nav aria-label={t('curriculumPaginationLabel')} className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>
                {t('curriculumPagePrevious')}
              </Button>
              {pageNumberItems(totalPages, currentPage).map((item, i) =>
                item === 'gap' ? (
                  <span key={`gap-${i}`} className="text-sm text-muted-foreground">
                    …
                  </span>
                ) : (
                  <Button
                    key={item}
                    type="button"
                    variant={item === currentPage ? 'default' : 'outline'}
                    size="sm"
                    aria-current={item === currentPage ? 'page' : undefined}
                    onClick={() => goToPage(item)}
                  >
                    {item}
                  </Button>
                ),
              )}
              <Button type="button" variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)}>
                {t('curriculumPageNext')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('curriculumPageStatus', { current: currentPage, total: totalPages })}
              </span>
            </nav>
          ) : null}
        </>
      ) : !forbidden ? (
        <p className="text-sm text-muted-foreground">{t('curriculumLoading')}</p>
      ) : null}
    </PageShell>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('teacherProgrammeTitle');
}

export default TeacherCurriculumPage;
