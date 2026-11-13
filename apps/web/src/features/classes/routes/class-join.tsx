import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, buttonVariants } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { ErrorAlert } from '#components/error-alert';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { joinClassByCode, previewJoinClass } from '../api/classes';
import type { ClassJoinPreview } from '../types/classes';

export function ClassJoinPage() {
  const { t } = useTranslation('app');
  const location = useLocation();
  const initialCode = new URLSearchParams(location.search).get('code') ?? '';
  const [code, setCode] = useState(initialCode);
  const [preview, setPreview] = useState<ClassJoinPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: (value: string) => previewJoinClass(value),
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: () => {
      setPreview(null);
      setError(t('classJoinInvalid'));
    },
  });

  const joinMutation = useMutation({
    mutationFn: (value: string) => joinClassByCode(value),
    onSuccess: (result) => {
      setError(null);
      if (result.outcome === 'joined') setMessage(t('classJoinJoined', { name: result.class.name }));
      else if (result.outcome === 'pending') setMessage(t('classJoinPendingMsg', { name: result.class.name }));
      else setMessage(t('classJoinAlready', { name: result.class.name }));
    },
    onError: () => setError(t('classJoinInvalid')),
  });

  const autoPreviewedRef = useRef(false);
  useEffect(() => {
    if (autoPreviewedRef.current) return;
    autoPreviewedRef.current = true;
    if (initialCode) previewMutation.mutate(initialCode);
  }, [initialCode, previewMutation]);

  function onPreview(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (code.trim()) previewMutation.mutate(code.trim());
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
                <Button type="button" disabled={joinMutation.isPending} onClick={() => joinMutation.mutate(code.trim())}>
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

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('classJoinTitle');
}
