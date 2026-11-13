/**
 * Trang tự báo danh vào lớp bằng mã: học sinh nhập mã tham gia (hoặc mở link chứa
 * ?code= để tự xem trước một lần) rồi xem trước tên lớp và chủ lớp trước khi xin vào.
 * Kết quả theo luật API — lớp trống vào thẳng, lớp đã có học sinh vào hàng chờ duyệt
 * trừ khi bật tự duyệt, đã là thành viên thì báo rõ — còn mã sai chỉ hiện một thông
 * điệp chung, không lộ lớp nào tồn tại.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, buttonVariants } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { useJoinClassByCode, usePreviewJoinClass } from '../queries/classes';
import type { ClassJoinPreview } from '../types/classes';

/**
 * Trang tự báo danh (CLASS-1, issue #184): học sinh có tài khoản nhập mã tham gia (hoặc mở link chứa ?code=) → xem trước lớp + chủ lớp → xin vào. Kết quả theo luật API: lớp trống vào thẳng; lớp đã có HS vào hàng chờ duyệt trừ khi chủ lớp bật tự duyệt; đã là thành viên thì báo rõ. Lỗi mã được dịch thành một thông điệp duy nhất, không lộ lớp nào tồn tại ngoài mã đúng.
 */
export function ClassJoinPage() {
  const { t } = useTranslation('app');
  const location = useLocation();
  const initialCode = new URLSearchParams(location.search).get('code') ?? '';
  const [code, setCode] = useState(initialCode);
  const [preview, setPreview] = useState<ClassJoinPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = usePreviewJoinClass();
  const joinMutation = useJoinClassByCode();

  async function runPreview(value: string) {
    try {
      const data = await previewMutation.mutateAsync(value);
      setPreview(data);
      setError(null);
    } catch {
      setPreview(null);
      setError(t('classJoinInvalid'));
    }
  }

  async function runJoin(value: string) {
    try {
      const result = await joinMutation.mutateAsync(value);
      setError(null);
      if (result.outcome === 'joined') setMessage(t('classJoinJoined', { name: result.class.name }));
      else if (result.outcome === 'pending') setMessage(t('classJoinPendingMsg', { name: result.class.name }));
      else setMessage(t('classJoinAlready', { name: result.class.name }));
    } catch {
      setError(t('classJoinInvalid'));
    }
  }

  // Tự xem trước cho mã có sẵn trong link: chỉ chạy đúng một lần lúc mở trang (gác bằng ref). `initialCode` là giá trị khởi tạo lấy từ URL lúc trang mở — không tự xem trước lại khi URL đổi trong lúc trang đang mở, khớp cách `code` được khởi tạo một lần bằng useState ở trên. Mảng phụ thuộc liệt kê đủ giá trị hiệu ứng đọc; ref gác làm các lần chạy thêm
  // (khi phụ thuộc đổi danh tính) thoát ngay, hành vi không đổi.
  const autoPreviewedRef = useRef(false);
  useEffect(() => {
    if (autoPreviewedRef.current) return;
    autoPreviewedRef.current = true;
    if (initialCode) void runPreview(initialCode);
  }, [initialCode, previewMutation]);

  function onPreview(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (code.trim()) void runPreview(code.trim());
  }

  return (
    <PageShell width="narrow">
      <PageHeader title={t('classJoinTitle')} description={t('classJoinDescription')} />
      {error ? (
        <ErrorAlert variant="destructive">
          {error}
        </ErrorAlert>
      ) : null}
      {message ? (
        <ErrorAlert>
          {message}
        </ErrorAlert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('classJoinCodeInput')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={onPreview}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="join-code">{t('classJoinCodeInput')}</FieldLabel>
                <Input id="join-code" value={code} onChange={(e) => setCode(e.target.value)} required />
              </Field>
              <Button type="submit" disabled={previewMutation.isPending || !code.trim()}>
                {t('classJoinSubmit')}
              </Button>
            </FieldGroup>
          </form>
          {preview ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-base font-medium">{preview.name}</p>
              <p className="text-muted-foreground">{t('classJoinPreviewOwner', { name: preview.ownerName })}</p>
              <div>
                <Button type="button" disabled={joinMutation.isPending} onClick={() => void runJoin(code.trim())}>
                  {t('classJoinSubmit')}
                </Button>
              </div>
            </div>
          ) : null}
          {message ? (
            <div>
              <Link className={buttonVariants({ variant: 'outline' })} to="/classes">
                {t('classJoinGoToClasses')}
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default ClassJoinPage;

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('classJoinTitle');
}
