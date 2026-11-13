import { useTranslation } from 'react-i18next';

import type { CourseActivityGrid } from '@giaokhoa/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';

import { scoreLabel } from '../utils/gradebook-helpers';

export interface ClassGradesGridCardProps {
  report: CourseActivityGrid;
  locale: string;
}

export function ClassGradesGridCard({ report, locale }: ClassGradesGridCardProps) {
  const { t } = useTranslation('app');
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t('gradesGridTitle')}</CardTitle>
        <CardDescription>{t('gradesGridDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{t('gradesStudentColumn')}</th>
                {report.items.map((item) => (
                  <th key={item.id} className="py-2 pr-4 font-medium">
                    {item.itemName}
                    <span className="block text-xs font-normal">
                      {report.publications[item.id]?.published ? t('gradesPublished') : t('gradesUnpublished')}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.userId} className="border-t">
                  <td className="py-2 pr-4">{row.displayName}</td>
                  {report.items.map((item) => (
                    <td key={item.id} className="py-2 pr-4">
                      {row.grades[item.id] !== null && row.grades[item.id] !== undefined
                        ? scoreLabel(row.grades[item.id]!, locale)
                        : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
