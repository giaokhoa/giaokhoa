/**
 * Màn tạo lớp riêng: chỉ tên lớp là bắt buộc, mã/năm học/mô tả đều tuỳ chọn theo
 * quyết định lớp tạo trước tối giản. Tạo thành công qua POST /classes thì đi thẳng
 * tới trang chi tiết lớp để nạp roster ngay.
 */

import { useState, type FormEvent } from 'react';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Textarea } from '@giaokhoa/ui/components/textarea';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { useCreateClass } from '../queries/classes';

/**
 * Màn tạo lớp riêng (CLASS-1, issue #184) — chuẩn giao diện: tạo mới là màn riêng, không phải hộp thoại. Chỉ TÊN lớp là bắt buộc (quyết định lớp tạo trước tối giản); mã/năm học/mô tả đều tuỳ chọn. Tạo xong đi thẳng tới chi tiết lớp để nạp roster ngay.
 */
export function ClassNewPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [schoolYear, setSchoolYear] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const createMutation = useCreateClass();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      const cls = await createMutation.mutateAsync({
        name: name.trim(),
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(schoolYear.trim() ? { schoolYear: schoolYear.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      void navigate(`/classes/${cls.id}`);
    } catch {
      setMessage(t('classCreateFailed'));
    }
  }

  return (
    <PageShell width="narrow">
      <PageHeader title={t('classCreateTitle')} description={t('classCreateDescription')} />
      {message ? (
        <ErrorAlert variant="destructive">
          {message}
        </ErrorAlert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('className')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="class-name">{t('className')}</FieldLabel>
                <Input id="class-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="class-code">{t('classCode')}</FieldLabel>
                <Input id="class-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="class-year">{t('classSchoolYear')}</FieldLabel>
                <Input id="class-year" value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} placeholder="2026-2027" />
              </Field>
              <Field>
                <FieldLabel htmlFor="class-description">{t('classDescriptionLabel')}</FieldLabel>
                <Textarea id="class-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </Field>
              <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
                {t('classCreateSubmit')}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default ClassNewPage;

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('classCreateTitle');
}
