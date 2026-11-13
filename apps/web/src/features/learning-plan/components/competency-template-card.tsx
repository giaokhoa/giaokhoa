/**
 * Thẻ mẫu kế hoạch của khu quản trị competency (`competency-admin.tsx`): một trong ba thẻ của trang kế hoạch học tập khi người dùng có quyền quản trị.
 *
 * Luồng hiển thị: danh sách mẫu kế hoạch (mẫu đang chọn gắn huy hiệu, mẫu khác có nút xem), form tạo mẫu mới, và — khi đã chọn mẫu — form gắn năng lực, form gắn cohort và nút sinh kế hoạch cho mọi thành viên cohort đã gắn. Mọi dữ liệu và thao tác ghi đều do component cha `CompetencyAdmin` giữ (query/mutation/thông báo); thẻ này chỉ giữ việc hiển thị và gọi lại qua props. Mẫu đầu tiên được chọn sẵn theo logic của component cha.
 */
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import type { TemplateView } from '../types/types';

/** Nháp form tạo mẫu kế hoạch (đóng gói thành `createLearningPlanTemplateSchema` khi gửi). */
export interface TemplateDraft {
  shortName: string;
  description: string;
  dueDate: string;
}

/** Props của thẻ mẫu kế hoạch (dữ liệu và thao tác do `CompetencyAdmin` giữ). */
export interface CompetencyTemplateCardProps {
  templates: TemplateView[];
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
  templateDraft: TemplateDraft;
  onTemplateDraftChange: (draft: TemplateDraft) => void;
  templateCompetencyId: string;
  onTemplateCompetencyIdChange: (value: string) => void;
  templateCohortId: string;
  onTemplateCohortIdChange: (value: string) => void;
  onCreateTemplate: (event: FormEvent) => void;
  onAddTemplateCompetency: (event: FormEvent) => void;
  onAddTemplateCohort: (event: FormEvent) => void;
  onCreatePlansFromTemplate: () => void;
}

/**
 * Thẻ mẫu kế hoạch: liệt kê mẫu, tạo mẫu mới, gắn năng lực/cohort vào mẫu đang chọn và sinh kế hoạch từ mẫu.
 *
 * @param props - Danh sách mẫu, mẫu đang chọn, nháp các form và các hàm gửi của component cha.
 * @returns Thẻ mẫu kế hoạch.
 */
export function CompetencyTemplateCard({
  templates,
  selectedTemplateId,
  onSelectTemplate,
  templateDraft,
  onTemplateDraftChange,
  templateCompetencyId,
  onTemplateCompetencyIdChange,
  templateCohortId,
  onTemplateCohortIdChange,
  onCreateTemplate,
  onAddTemplateCompetency,
  onAddTemplateCohort,
  onCreatePlansFromTemplate,
}: CompetencyTemplateCardProps) {
  const { t } = useTranslation('app');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('compTemplatesTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1" aria-label={t('compTemplatesTitle')}>
          {templates.map((tpl) => (
            <li key={tpl.id} className="flex items-center gap-3 text-sm">
              <span className="font-medium">{tpl.shortName}</span>
              {tpl.id === selectedTemplateId ? (
                <Badge>{t('compSelectTemplate')}</Badge>
              ) : (
                <Button type="button" variant="outline" onClick={() => onSelectTemplate(tpl.id)}>
                  {t('view')}
                </Button>
              )}
            </li>
          ))}
          {templates.length === 0 ? <li className="text-sm">{t('compNoTemplates')}</li> : null}
        </ul>
        <form onSubmit={(e) => void onCreateTemplate(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="tpl-shortname">{t('compTemplateShortname')}</FieldLabel>
              <Input
                id="tpl-shortname"
                value={templateDraft.shortName}
                onChange={(e) => onTemplateDraftChange({ ...templateDraft, shortName: e.target.value })}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tpl-description">{t('compTemplateDescription')}</FieldLabel>
              <Input
                id="tpl-description"
                value={templateDraft.description}
                onChange={(e) => onTemplateDraftChange({ ...templateDraft, description: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tpl-duedate">{t('compTemplateDuedate')}</FieldLabel>
              <Input
                id="tpl-duedate"
                type="date"
                value={templateDraft.dueDate}
                onChange={(e) => onTemplateDraftChange({ ...templateDraft, dueDate: e.target.value })}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit">{t('compCreateTemplate')}</Button>
            </div>
          </FieldGroup>
        </form>
        {selectedTemplateId ? (
          <div className="space-y-3">
            <form onSubmit={(e) => void onAddTemplateCompetency(e)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="tpl-competency-id">{t('compTemplateCompetencyId')}</FieldLabel>
                  <Input
                    id="tpl-competency-id"
                    value={templateCompetencyId}
                    onChange={(e) => onTemplateCompetencyIdChange(e.target.value)}
                    required
                  />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" variant="outline">
                    {t('compAddTemplateCompetency')}
                  </Button>
                </div>
              </FieldGroup>
            </form>
            <form onSubmit={(e) => void onAddTemplateCohort(e)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="tpl-cohort-id">{t('compTemplateCohortId')}</FieldLabel>
                  <Input
                    id="tpl-cohort-id"
                    value={templateCohortId}
                    onChange={(e) => onTemplateCohortIdChange(e.target.value)}
                    required
                  />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" variant="outline">
                    {t('compAddTemplateCohort')}
                  </Button>
                </div>
              </FieldGroup>
            </form>
            <Button type="button" onClick={() => void onCreatePlansFromTemplate()}>
              {t('compCreatePlansFromTemplate')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
