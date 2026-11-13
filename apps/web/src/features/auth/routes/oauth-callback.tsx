import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { PageShell } from '#components/page-shell';
import { useAuth } from '#lib/auth';

export function OAuthCallbackPage() {
  const { t } = useTranslation('app');
  const { user, reload } = useAuth();
  const navigate = useNavigate();
  const [settled, setSettled] = useState(false);
  const startedRef = useRef(false);
  const [searchParams] = useSearchParams();
  const mfaPending = searchParams.get('twoFactorRedirect') === 'true';

  useEffect(() => {
    if (mfaPending) {
      navigate('/login?twoFactorRedirect=true', { replace: true });
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    let alive = true;
    void reload().finally(() => {
      if (alive) setSettled(true);
    });
    return () => {
      alive = false;
    };
  }, [reload, navigate, mfaPending]);

  useEffect(() => {
    if (settled && user) navigate('/profile', { replace: true });
  }, [settled, user, navigate]);

  const failed = settled && !user;

  return (
    <PageShell width="narrow" contentClassName="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{t('oauthCallbackTitle')}</CardTitle>
          <CardDescription>{t('oauthCallbackDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!failed && (
            <div className="flex justify-center py-2">
              <Spinner className="size-6" />
            </div>
          )}
          {failed && (
            <>
              <ErrorAlert variant="destructive">
                {t('oauthCallbackFailed')}
              </ErrorAlert>
              <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/login')}>
                {t('backToLogin')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default OAuthCallbackPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('signIn');
}
