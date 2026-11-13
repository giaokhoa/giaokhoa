import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AssignmentForUserView } from '@giaokhoa/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { ManagePanel } from '../components/manage-panel';
import { RubricView } from '../components/rubric-view';
import { dateLabel } from '../utils/shared';
import { StudentPanel } from '../components/student-panel';
import { TeacherPanel } from '../components/teacher-panel';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { assignmentQueryOptions, useAssignment } from '../queries/assignment';
import { queryClient } from '#lib/query-client';

export function AssignmentPage() {
  const { t } = useTranslation('app');
  const { id: courseId, assignmentId } = useParams();
  const assignmentQuery = useAssignment(assignmentId);
  const data: AssignmentForUserView | null = assignmentQuery.data ?? null;
  const queryClientInstance = useQueryClient();

  const reload = useCallback(async () => {
    await queryClientInstance.fetchQuery(assignmentQueryOptions(assignmentId ?? ''));
  }, [queryClientInstance, assignmentId]);

  if (assignmentQuery.isError && !data) {
    return (
      <PageShell width="wide">
        <ErrorAlert variant="destructive">
          {t('assignLoadFailed')}
        </ErrorAlert>
        <p className="mt-3 text-sm">
          <Link to={`/courses/${courseId}`} className="underline">
            {t('assignBackToCourse')}
          </Link>
        </p>
      </PageShell>
    );
  }
  if (assignmentQuery.isPending || !data) {
    return (
      <PageShell width="wide">
        <PageSkeleton className="space-y-3" label={t('assignLoading')} rows={['h-8 w-72', 'h-28 w-full', 'h-28 w-full']} />
      </PageShell>
    );
  }

  const { assignment, rubric } = data;
  return (
    <PageShell width="wide">
      <PageHeader
        title={assignment.name}
        description={
          assignment.dueDate
            ? `${t('assignDueLine', { date: dateLabel(assignment.dueDate) })} · ${t('assignGradeScaleLine', { grade: assignment.grade })} · ${t(`assignResultMode_${assignment.resultMode}`)}`
            : `${t('assignNoDue')} · ${t('assignGradeScaleLine', { grade: assignment.grade })} · ${t(`assignResultMode_${assignment.resultMode}`)}`
        }
      />
      <p className="text-sm">
        <Link to={`/courses/${courseId}`} className="underline">
          {t('assignBackToCourse')}
        </Link>
      </p>
      {assignment.intro ? (
        <Card>
          <CardContent className="whitespace-pre-wrap text-sm">{assignment.intro}</CardContent>
        </Card>
      ) : null}
      {rubric && rubric.criteria.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{rubric.title ?? t('assignRubricTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RubricView criteria={rubric.criteria} />
          </CardContent>
        </Card>
      ) : null}
      {data.canSubmit ? <StudentPanel data={data} reload={reload} /> : null}
      {data.canViewAllSubmissions || data.canGrade ? <TeacherPanel data={data} /> : null}
      {data.canManage ? <ManagePanel data={data} courseId={courseId!} reload={reload} /> : null}
    </PageShell>
  );
}

export default AssignmentPage;

export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.assignmentId) {
    await queryClient.prefetchQuery(assignmentQueryOptions(params.assignmentId));
  }
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('contentType_mod_assign');
}
