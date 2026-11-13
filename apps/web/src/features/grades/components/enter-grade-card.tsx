import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { CourseActivityGrid, GradeItem } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@giaokhoa/ui/components/select';
import { ErrorAlert } from '#components/error-alert';

import { GradeHistoryView } from '../types/course-grade';

export interface EnterGradeCardProps {
  items: GradeItem[];
  rows: CourseActivityGrid['rows'];
  gradeItemId: string;
  onGradeItemIdChange: (value: string) => void;
  gradeUserId: string;
  onGradeUserIdChange: (value: string) => void;
  gradeValue: string;
  onGradeValueChange: (value: string) => void;
  gradeFeedback: string;
  onGradeFeedbackChange: (value: string) => void;
  onSubmitGrade: (event: FormEvent) => Promise<void>;
  historyItemId: string;
  onHistoryItemIdChange: (value: string) => void;
  historyUserId: string;
  onHistoryUserIdChange: (value: string) => void;
  historyRows: GradeHistoryView[] | null;
  historyError: string | null;
  onLoadHistory: (event: FormEvent) => Promise<void>;
}

export function EnterGradeCard({
  items,
  rows,
  gradeItemId,
  onGradeItemIdChange,
  gradeUserId,
  onGradeUserIdChange,
  gradeValue,
  onGradeValueChange,
  gradeFeedback,
  onGradeFeedbackChange,
  onSubmitGrade,
  historyItemId,
  onHistoryItemIdChange,
  historyUserId,
  onHistoryUserIdChange,
  historyRows,
  historyError,
  onLoadHistory,
}: EnterGradeCardProps) {
  const { t } = useTranslation('app');
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t('enterGradeTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmitGrade}>
          <FieldGroup>
            <Field>
              <FieldLabel>{t('gradeItem')}</FieldLabel>
              <Select value={gradeItemId} onValueChange={(value) => onGradeItemIdChange(value ?? '')}>
                <SelectTrigger aria-label={t('gradeItem')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.itemName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t('gradesStudentColumn')}</FieldLabel>
              <Select value={gradeUserId} onValueChange={(value) => onGradeUserIdChange(value ?? '')}>
                <SelectTrigger aria-label={t('gradesStudentColumn')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rows.map((row) => (
                    <SelectItem key={row.userId} value={row.userId}>
                      {row.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t('gradeValue')}</FieldLabel>
              <Input value={gradeValue} onChange={(e) => onGradeValueChange(e.target.value)} inputMode="decimal" />
            </Field>
            <Field>
              <FieldLabel>{t('gradesFeedback')}</FieldLabel>
              <Input value={gradeFeedback} onChange={(e) => onGradeFeedbackChange(e.target.value)} />
            </Field>
          </FieldGroup>
          <Button type="submit" className="mt-3" disabled={!gradeItemId || !gradeUserId}>
            {t('saveGrade')}
          </Button>
        </form>

        <h3 className="mt-8 font-medium">{t('gradeHistoryTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('gradeHistoryDescription')}</p>
        <form onSubmit={onLoadHistory} className="mt-3 flex flex-wrap items-end gap-2">
          <Field>
            <FieldLabel>{t('gradeItem')}</FieldLabel>
            <Select value={historyItemId} onValueChange={(value) => onHistoryItemIdChange(value ?? '')}>
              <SelectTrigger aria-label={t('gradeItem')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.itemName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t('gradesStudentColumn')}</FieldLabel>
            <Select value={historyUserId} onValueChange={(value) => onHistoryUserIdChange(value ?? '')}>
              <SelectTrigger aria-label={t('gradesStudentColumn')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rows.map((row) => (
                  <SelectItem key={row.userId} value={row.userId}>
                    {row.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button type="submit" variant="outline" disabled={!historyItemId || !historyUserId}>
            {t('viewHistory')}
          </Button>
        </form>
        {historyError && (
          <ErrorAlert variant="destructive" className="mt-3">
            {historyError}
          </ErrorAlert>
        )}
        {historyRows && (
          <ul className="mt-3 space-y-1 text-sm">
            {historyRows.map((row) => (
              <li key={row.id}>
                {row.updatedAt} · {row.finalGrade ?? '—'} · {row.source ?? ''}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
