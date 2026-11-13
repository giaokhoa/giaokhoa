import { useTranslation } from 'react-i18next';

import type { ActivityGradeView } from '@giaokhoa/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';

import { DataTable, type DataColumn } from '#components/data-table';

import { scoreLabel } from '../utils/gradebook-helpers';

export interface StudentGradesCardProps {
  activities: ActivityGradeView[];
  locale: string;
}

export function StudentGradesCard({ activities, locale }: StudentGradesCardProps) {
  const { t } = useTranslation('app');
  const columns: DataColumn<ActivityGradeView>[] = [
    { id: 'item', header: t('gradeItem'), cell: ({ item }) => item.itemName },
    {
      id: 'grade',
      header: t('grade'),
      cell: ({ item, grade }) =>
        grade?.finalGrade !== null && grade?.finalGrade !== undefined
          ? `${scoreLabel(grade.finalGrade, locale)} / ${scoreLabel(item.gradeMax, locale)}`
          : '—',
    },
    { id: 'feedback', header: t('gradesFeedback'), cell: ({ grade }) => grade?.feedback ?? '' },
    {
      id: 'status',
      header: t('status'),
      cell: ({ publication }) => (publication.published ? t('gradesPublished') : t('gradesUnpublished')),
    },
  ];
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t('myGradesTitle')}</CardTitle>
        <CardDescription>{t('myGradesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('gradesNoActivities')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <DataTable
            data={activities}
            columns={columns}
            labels={{
              columns: t('dashboard:tableColumns'),
              previous: t('dashboard:tablePrevious'),
              next: t('dashboard:tableNext'),
              empty: t('dashboard:emptyTable'),
              pageInfo: (page, pages) => t('dashboard:tablePageInfo', { page, pages }),
            }}
            getRowId={({ item }) => item.id}
            pageSize={100}
          />
        )}
      </CardContent>
    </Card>
  );
}
