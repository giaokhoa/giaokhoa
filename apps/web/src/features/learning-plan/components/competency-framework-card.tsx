/**
 * Thẻ framework + cây năng lực của khu quản trị competency (`competency-admin.tsx`): một trong ba thẻ của trang kế hoạch học tập khi người dùng có quyền quản trị.
 *
 * Luồng hiển thị: danh sách framework, cây năng lực của framework đang chọn, form tạo framework, form nhập framework từ file JSON đã xuất và form thêm năng lực vào framework đang chọn. Mọi dữ liệu và thao tác ghi đều do component cha `CompetencyAdmin` giữ (query/mutation/thông báo); thẻ này chỉ giữ việc hiển thị và gọi lại qua props.
 */
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Checkbox } from '@giaokhoa/ui/components/checkbox';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { ErrorAlert } from '#components/error-alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';
import { COMPETENCY_INDENT, type CompetencyView, type FrameworkView } from '../types/types';

/** Nháp form tạo framework (đóng gói thành `createCompetencyFrameworkSchema` khi gửi). */
export interface FrameworkDraft {
  shortName: string;
  idNumber: string;
  description: string;
  scaleValues: string;
  scaleProficient: string;
  visible: boolean;
}

/** Nháp form thêm năng lực vào framework đang chọn. */
export interface CompetencyDraft {
  shortName: string;
  idNumber: string;
  description: string;
  parentId: string;
}

/** Props của thẻ framework + cây năng lực (dữ liệu và thao tác do `CompetencyAdmin` giữ). */
export interface CompetencyFrameworkCardProps {
  frameworks: FrameworkView[];
  competencies: CompetencyView[];
  selectedFrameworkId: string;
  onSelectFramework: (frameworkId: string) => void;
  adminError: string | null;
  adminMessage: string | null;
  frameworkDraft: FrameworkDraft;
  onFrameworkDraftChange: (draft: FrameworkDraft) => void;
  competencyDraft: CompetencyDraft;
  onCompetencyDraftChange: (draft: CompetencyDraft) => void;
  importFile: File | null;
  onImportFileChange: (file: File | null) => void;
  importError: string | null;
  importInputKey: number;
  onCreateFramework: (event: FormEvent) => void;
  onExportFramework: (framework: FrameworkView) => void;
  onImportFramework: (event: FormEvent) => void;
  onCreateCompetency: (event: FormEvent) => void;
}

/**
 * Thẻ framework + cây năng lực: liệt kê framework (xem cây/xuất JSON), tạo framework mới, nhập framework từ file JSON và thêm năng lực vào framework đang chọn.
 *
 * @param props - Danh sách framework/cây năng lực, framework đang chọn, lỗi/thông báo của khu quản trị, nháp các form và các hàm gửi của component cha.
 * @returns Thẻ framework + cây năng lực.
 */
export function CompetencyFrameworkCard({
  frameworks,
  competencies,
  selectedFrameworkId,
  onSelectFramework,
  adminError,
  adminMessage,
  frameworkDraft,
  onFrameworkDraftChange,
  competencyDraft,
  onCompetencyDraftChange,
  importFile,
  onImportFileChange,
  importError,
  importInputKey,
  onCreateFramework,
  onExportFramework,
  onImportFramework,
  onCreateCompetency,
}: CompetencyFrameworkCardProps) {
  const { t } = useTranslation('app');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('compAdminTitle')}</CardTitle>
        <CardDescription>{t('compAdminDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {adminError ? (
          <ErrorAlert variant="destructive">
            {adminError}
          </ErrorAlert>
        ) : null}
        {adminMessage ? (
          <ErrorAlert>
            {adminMessage}
          </ErrorAlert>
        ) : null}
        <div className="space-y-3">
          <h3 className="font-medium">{t('compFrameworksTitle')}</h3>
          <ul className="space-y-1" aria-label={t('compFrameworksTitle')}>
            {frameworks.map((fw) => (
              <li key={fw.id} className="flex items-center gap-3 text-sm">
                <span className="font-medium">{fw.shortName}</span>
                {fw.scaleConfiguration?.values?.length ? (
                  <span>{fw.scaleConfiguration.values.join(', ')}</span>
                ) : null}
                <Button type="button" variant="outline" onClick={() => onSelectFramework(fw.id)}>
                  {t('compViewCompetencies')}
                </Button>
                <Button type="button" variant="outline" onClick={() => void onExportFramework(fw)}>
                  {t('compExportFramework')}
                </Button>
              </li>
            ))}
            {frameworks.length === 0 ? <li className="text-sm">{t('compNoFrameworks')}</li> : null}
          </ul>
          <form onSubmit={(e) => void onCreateFramework(e)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="fw-shortname">{t('compFrameworkShortname')}</FieldLabel>
                <Input
                  id="fw-shortname"
                  value={frameworkDraft.shortName}
                  onChange={(e) => onFrameworkDraftChange({ ...frameworkDraft, shortName: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="fw-idnumber">{t('compFrameworkIdnumber')}</FieldLabel>
                <Input
                  id="fw-idnumber"
                  value={frameworkDraft.idNumber}
                  onChange={(e) => onFrameworkDraftChange({ ...frameworkDraft, idNumber: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="fw-description">{t('compFrameworkDescription')}</FieldLabel>
                <Input
                  id="fw-description"
                  value={frameworkDraft.description}
                  onChange={(e) => onFrameworkDraftChange({ ...frameworkDraft, description: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="fw-scale-values">{t('compScaleValues')}</FieldLabel>
                <Input
                  id="fw-scale-values"
                  value={frameworkDraft.scaleValues}
                  onChange={(e) => onFrameworkDraftChange({ ...frameworkDraft, scaleValues: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="fw-scale-proficient">{t('compScaleProficient')}</FieldLabel>
                <Input
                  id="fw-scale-proficient"
                  value={frameworkDraft.scaleProficient}
                  onChange={(e) => onFrameworkDraftChange({ ...frameworkDraft, scaleProficient: e.target.value })}
                />
              </Field>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="fw-visible"
                  checked={frameworkDraft.visible}
                  onCheckedChange={(checked) =>
                    onFrameworkDraftChange({ ...frameworkDraft, visible: checked === true })
                  }
                />
                <Label htmlFor="fw-visible">{t('compFrameworkVisible')}</Label>
              </div>
              <div className="flex justify-end">
                <Button type="submit">{t('compCreateFramework')}</Button>
              </div>
            </FieldGroup>
          </form>
          <form onSubmit={(e) => void onImportFramework(e)}>
            <FieldGroup>
              <h4 className="font-medium">{t('compImportTitle')}</h4>
              <Field>
                <FieldLabel htmlFor="fw-import-file">{t('compImportFile')}</FieldLabel>
                <Input
                  key={importInputKey}
                  id="fw-import-file"
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => onImportFileChange(e.target.files?.[0] ?? null)}
                />
              </Field>
              {importError ? (
                <ErrorAlert variant="destructive">
                  {importError}
                </ErrorAlert>
              ) : null}
              <div className="flex justify-end">
                <Button type="submit" variant="outline" disabled={!importFile}>
                  {t('compImportAction')}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </div>

        <div className="space-y-3">
          <h3 className="font-medium">{t('compCompetenciesTitle')}</h3>
          {selectedFrameworkId ? (
            <>
              <ul className="space-y-1" aria-label={t('compCompetenciesTitle')}>
                {competencies.map((c) => (
                  <li
                    key={c.id}
                    className={`text-sm ${COMPETENCY_INDENT[Math.min(Math.max(0, (c.depth ?? 1) - 1), 5)]}`}
                  >
                    <span className="font-medium">{c.shortName}</span>
                    {c.description ? <span> — {c.description}</span> : null}
                  </li>
                ))}
                {competencies.length === 0 ? <li className="text-sm">{t('compNoCompetencies')}</li> : null}
              </ul>
              <form onSubmit={(e) => void onCreateCompetency(e)}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="comp-shortname">{t('compCompetencyShortname')}</FieldLabel>
                    <Input
                      id="comp-shortname"
                      value={competencyDraft.shortName}
                      onChange={(e) => onCompetencyDraftChange({ ...competencyDraft, shortName: e.target.value })}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="comp-idnumber">{t('compCompetencyIdnumber')}</FieldLabel>
                    <Input
                      id="comp-idnumber"
                      value={competencyDraft.idNumber}
                      onChange={(e) => onCompetencyDraftChange({ ...competencyDraft, idNumber: e.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="comp-description">{t('compCompetencyDescription')}</FieldLabel>
                    <Input
                      id="comp-description"
                      value={competencyDraft.description}
                      onChange={(e) => onCompetencyDraftChange({ ...competencyDraft, description: e.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel id="comp-parent-label">{t('compCompetencyParent')}</FieldLabel>
                    <Select
                      items={Object.fromEntries([
                        ['none', t('compNoParent')],
                        ...competencies.map((c) => [c.id, c.shortName] as [string, string]),
                      ])}
                      value={competencyDraft.parentId === '' ? 'none' : competencyDraft.parentId}
                      onValueChange={(v) =>
                        onCompetencyDraftChange({
                          ...competencyDraft,
                          parentId: v === 'none' || v === null ? '' : v,
                        })
                      }
                    >
                      <SelectTrigger aria-labelledby="comp-parent-label" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('compNoParent')}</SelectItem>
                        {competencies.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.shortName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="flex justify-end">
                    <Button type="submit">{t('compAddCompetency')}</Button>
                  </div>
                </FieldGroup>
              </form>
            </>
          ) : (
            <p className="text-sm">{t('compSelectFramework')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
