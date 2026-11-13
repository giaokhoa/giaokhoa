import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { CourseActivityGrid, GradeItem } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@giaokhoa/ui/components/select';
import { ErrorAlert } from '#components/error-alert';

export interface GradeItemEdit {
  itemName: string;
  gradeMax: string;
}

export interface GradeItemsAdminCardProps {
  items: GradeItem[];
  publications: CourseActivityGrid['publications'];
  adminMessage: string | null;
  itemEdits: Record<string, GradeItemEdit>;
  onItemEditsChange: Dispatch<SetStateAction<Record<string, GradeItemEdit>>>;
  newItemName: string;
  onNewItemNameChange: (value: string) => void;
  newItemMax: string;
  onNewItemMaxChange: (value: string) => void;
  onCreateItem: (event: FormEvent) => Promise<void>;
  onSaveItemEdit: (item: GradeItem) => Promise<void>;
  onDeleteItem: (item: GradeItem) => Promise<void>;
  onSetPostingPolicy: (item: GradeItem, policy: 'auto' | 'manual') => Promise<void>;
  onSetPublished: (item: GradeItem, published: boolean) => Promise<void>;
}

export function GradeItemsAdminCard({
  items,
  publications,
  adminMessage,
  itemEdits,
  onItemEditsChange,
  newItemName,
  onNewItemNameChange,
  newItemMax,
  onNewItemMaxChange,
  onCreateItem,
  onSaveItemEdit,
  onDeleteItem,
  onSetPostingPolicy,
  onSetPublished,
}: GradeItemsAdminCardProps) {
  const { t } = useTranslation('app');
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t('gradeItemsAdminTitle')}</CardTitle>
        <CardDescription>{t('gradeAdminDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {adminMessage && (
          <ErrorAlert className="mb-4">
            {adminMessage}
          </ErrorAlert>
        )}
        <ul className="divide-y">
          {items.map((item) => {
            const publication = publications[item.id] ?? { policy: 'auto' as const, published: true };
            const edit = itemEdits[item.id] ?? { itemName: item.itemName, gradeMax: String(item.gradeMax) };
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-2 py-3">
                <Input
                  aria-label={t('gradeItemName')}
                  className="w-56"
                  value={edit.itemName}
                  onChange={(e) =>
                    onItemEditsChange((prev) => ({ ...prev, [item.id]: { ...edit, itemName: e.target.value } }))
                  }
                />
                <Input
                  aria-label={t('gradeItemMax')}
                  className="w-24"
                  type="number"
                  value={edit.gradeMax}
                  onChange={(e) =>
                    onItemEditsChange((prev) => ({ ...prev, [item.id]: { ...edit, gradeMax: e.target.value } }))
                  }
                />
                <span className="text-sm text-muted-foreground">{item.itemType}</span>
                <Select
                  value={publication.policy}
                  onValueChange={(value) => void onSetPostingPolicy(item, value as 'auto' | 'manual')}
                >
                  <SelectTrigger className="w-64" aria-label={t('gradesPostingPolicy')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('gradesPostingAuto')}</SelectItem>
                    <SelectItem value="manual">{t('gradesPostingManual')}</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => void onSaveItemEdit(item)}>
                  {t('saveGradeItem')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void onSetPublished(item, !publication.published)}>
                  {publication.published ? t('gradesUnpublish') : t('gradesPublish')}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void onDeleteItem(item)}>
                  {t('deleteGradeItem')}
                </Button>
              </li>
            );
          })}
        </ul>
        <form onSubmit={onCreateItem} className="mt-4 flex flex-wrap items-end gap-2">
          <Field>
            <FieldLabel>{t('gradeItemName')}</FieldLabel>
            <Input
              id="grade-item-name"
              value={newItemName}
              onChange={(e) => onNewItemNameChange(e.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel>{t('gradeItemMax')}</FieldLabel>
            <Input
              id="grade-item-max"
              type="number"
              className="w-24"
              value={newItemMax}
              onChange={(e) => onNewItemMaxChange(e.target.value)}
              required
            />
          </Field>
          <Button type="submit">{t('createGradeItem')}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
