import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { CourseActivityGrid, GradeItem } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@giaokhoa/ui/components/select';
import { ErrorAlert } from '#components/error-alert';

import { isVneduExportableItem, type VneduColumnKind } from '../utils/gradebook-helpers';

export interface VneduExportCardProps {
  items: GradeItem[];
  publications: CourseActivityGrid['publications'];
  vneduKinds: Record<string, VneduColumnKind>;
  onVneduKindsChange: Dispatch<SetStateAction<Record<string, VneduColumnKind>>>;
  vneduSemester: string;
  onVneduSemesterChange: (value: string) => void;
  vneduSchoolYear: string;
  onVneduSchoolYearChange: (value: string) => void;
  vneduSubject: string;
  onVneduSubjectChange: (value: string) => void;
  vneduClass: string;
  onVneduClassChange: (value: string) => void;
  vneduMessage: string | null;
  onDownload: (event: FormEvent) => Promise<void>;
}

export function VneduExportCard({
  items,
  publications,
  vneduKinds,
  onVneduKindsChange,
  vneduSemester,
  onVneduSemesterChange,
  vneduSchoolYear,
  onVneduSchoolYearChange,
  vneduSubject,
  onVneduSubjectChange,
  vneduClass,
  onVneduClassChange,
  vneduMessage,
  onDownload,
}: VneduExportCardProps) {
  const { t } = useTranslation('app');
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t('exportGradesVnedu')}</CardTitle>
        <CardDescription>{t('gradesVneduOnlyPublished')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onDownload}>
          <ul className="divide-y">
            {items.filter(isVneduExportableItem).map((item) => {
              const published = publications[item.id]?.published ?? false;
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-56">{item.itemName}</span>
                  <Select
                    value={vneduKinds[item.id] ?? 'none'}
                    onValueChange={(value) =>
                      onVneduKindsChange((prev) => ({ ...prev, [item.id]: value as VneduColumnKind }))
                    }
                    disabled={!published}
                  >
                    <SelectTrigger className="w-48" aria-label={item.itemName}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('vneduKindNone')}</SelectItem>
                      <SelectItem value="regular">{t('vneduKindRegular')}</SelectItem>
                      <SelectItem value="midterm">{t('vneduKindMidterm')}</SelectItem>
                      <SelectItem value="final">{t('vneduKindFinal')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {!published && <span className="text-sm text-muted-foreground">{t('gradesUnpublished')}</span>}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Field>
              <FieldLabel>{t('vneduSemester')}</FieldLabel>
              <Select value={vneduSemester} onValueChange={(value) => onVneduSemesterChange(value ?? '1')}>
                <SelectTrigger className="w-32" aria-label={t('vneduSemester')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t('vneduSchoolYear')}</FieldLabel>
              <Input value={vneduSchoolYear} onChange={(e) => onVneduSchoolYearChange(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>{t('vneduSubjectName')}</FieldLabel>
              <Input value={vneduSubject} onChange={(e) => onVneduSubjectChange(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>{t('vneduClassName')}</FieldLabel>
              <Input value={vneduClass} onChange={(e) => onVneduClassChange(e.target.value)} />
            </Field>
            <Button type="submit">{t('exportGradesVnedu')}</Button>
          </div>
          {vneduMessage && (
            <ErrorAlert className="mt-3">
              {vneduMessage}
            </ErrorAlert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
