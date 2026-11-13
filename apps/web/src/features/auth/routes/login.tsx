import type { Route } from './+types/login';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLoaderData, useNavigate, useSearchParams } from 'react-router';
import type { OAuthProvidersResponse } from '@giaokhoa/contracts';
import { fetchApiJson } from '#lib/server-api';
import type { OAuthIssuer } from '@giaokhoa/contracts';
import { oauthProvidersResponseSchema } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { ErrorAlert } from '#components/error-alert';
import { PageShell } from '#components/page-shell';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { ApiError, apiJson, TwoFactorRedirectError } from '#lib/api';
import { useAuth } from '#lib/auth';
import { queryKeys } from '#lib/query-keys';

const OAUTH_ERROR_KEYS: Record<string, string> = {
  'auth.account_inactive': 'oauthErrorAccountInactive',
  'auth.oauth_email_unverified': 'oauthErrorEmailUnverified',
  'auth.oauth_email_missing': 'oauthErrorEmailMissing',
};

const OAUTH_BUTTON_KEYS: Record<OAuthIssuer, string> = {
  google: 'signInWithGoogle',
  facebook: 'signInWithFacebook',
};




export async function loader(_args?: Route.LoaderArgs): Promise<{ providers: OAuthProvidersResponse | null }> {
  const body = await fetchApiJson('/api/v1/auth/oauth/providers');
  const parsed = oauthProvidersResponseSchema.safeParse(body);
  return { providers: parsed.success ? parsed.data : null };
}

type LoginStep = 'password' | 'mfa' | 'otp-email' | 'otp-code';

export function LoginPage({ initialProviders }: { initialProviders?: OAuthProvidersResponse | null } = {}) {
  const { t } = useTranslation('app');
  const { login, completeMfaLogin, requestEmailOtp, loginWithEmailOtp, loginWithSocial } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<LoginStep>(() =>
    searchParams.get('twoFactorRedirect') === 'true' ? 'mfa' : 'password',
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);

  const providersQuery = useQuery({
    queryKey: queryKeys.oauthProviders,
    queryFn: async () => oauthProvidersResponseSchema.parse(await apiJson('/api/v1/auth/oauth/providers')),
    initialData: initialProviders ?? undefined,
  });
  const enabledIssuers = (providersQuery.data?.providers ?? []).filter((p) => p.enabled).map((p) => p.issuer);

  const oauthErrorCode = searchParams.get('oauthError');
  const oauthError = oauthErrorCode
    ? t(OAUTH_ERROR_KEYS[oauthErrorCode] ?? 'oauthFailedGeneric')
    :
      searchParams.get('error')
      ? t('oauthFailedGeneric')
      : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      navigate('/profile');
    } catch (err) {
      if (err instanceof TwoFactorRedirectError) {
        setMfaCode('');
        setMfaError(null);
        setStep('mfa');
      } else {
        setError(err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : t('loginFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onMfaSubmit(event: FormEvent) {
    event.preventDefault();
    setMfaBusy(true);
    setMfaError(null);
    try {
      await completeMfaLogin(mfaCode);
      navigate('/profile');
    } catch (err) {
      setMfaError(err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : t('mfaFailed'));
    } finally {
      setMfaBusy(false);
    }
  }

  async function onOtpRequestSubmit(event: FormEvent) {
    event.preventDefault();
    setOtpBusy(true);
    setOtpError(null);
    try {
      await requestEmailOtp(otpEmail);
      setOtpCode('');
      setStep('otp-code');
    } catch {
      setOtpError(t('emailOtpSendFailed'));
    } finally {
      setOtpBusy(false);
    }
  }

  async function onOtpVerifySubmit(event: FormEvent) {
    event.preventDefault();
    setOtpBusy(true);
    setOtpError(null);
    try {
      await loginWithEmailOtp(otpEmail, otpCode);
      navigate('/profile');
    } catch (err) {
      if (err instanceof TwoFactorRedirectError) {
        setMfaCode('');
        setMfaError(null);
        setStep('mfa');
      } else {
        setOtpError(t('emailOtpInvalidCode'));
      }
    } finally {
      setOtpBusy(false);
    }
  }

  async function startOAuth(issuer: OAuthIssuer) {
    setError(null);
    try {
      await loginWithSocial(issuer);
    } catch {
      setError(t('oauthFailedGeneric'));
    }
  }

  if (step === 'mfa') {
    return (
      <PageShell width="narrow" contentClassName="mx-auto w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{t('mfaTitle')}</CardTitle>
            <CardDescription>{t('mfaDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onMfaSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mfa-code">{t('mfaCode')}</Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  required
                />
              </div>
              {mfaError && (
                <ErrorAlert variant="destructive">
                  {mfaError}
                </ErrorAlert>
              )}
              <Button type="submit" disabled={mfaBusy} className="w-full">
                {mfaBusy ? t('mfaVerifying') : t('mfaVerify')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setStep('password');
                  setMfaError(null);
                }}
              >
                {t('mfaBack')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (step === 'otp-email' || step === 'otp-code') {
    return (
      <PageShell width="narrow" contentClassName="mx-auto w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{t('signInWithEmailOtp')}</CardTitle>
            <CardDescription>{t('emailOtpDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {step === 'otp-email' ? (
              <form onSubmit={onOtpRequestSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp-email">{t('email')}</Label>
                  <Input
                    id="otp-email"
                    type="email"
                    autoComplete="email"
                    value={otpEmail}
                    onChange={(e) => setOtpEmail(e.target.value)}
                    required
                  />
                </div>
                {otpError && (
                  <ErrorAlert variant="destructive">
                    {otpError}
                  </ErrorAlert>
                )}
                <Button type="submit" disabled={otpBusy} className="w-full">
                  {otpBusy ? t('emailOtpSending') : t('emailOtpSend')}
                </Button>
              </form>
            ) : (
              <form onSubmit={onOtpVerifySubmit} className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('emailOtpSentNotice', { email: otpEmail })}</p>
                <div className="space-y-2">
                  <Label htmlFor="otp-code">{t('emailOtpCodeLabel')}</Label>
                  <Input
                    id="otp-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    required
                  />
                </div>
                {otpError && (
                  <ErrorAlert variant="destructive">
                    {otpError}
                  </ErrorAlert>
                )}
                <Button type="submit" disabled={otpBusy} className="w-full">
                  {otpBusy ? t('emailOtpVerifying') : t('emailOtpVerify')}
                </Button>
              </form>
            )}
            <Button
              type="button"
              variant="outline"
              className="mt-4 w-full"
              onClick={() => {
                setStep('password');
                setOtpError(null);
              }}
            >
              {t('emailOtpBack')}
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell width="narrow" contentClassName="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{t('loginTitle')}</CardTitle>
          <CardDescription>{t('loginDescription')}</CardDescription>
          <CardDescription>
            <Link to="/register" className="underline">{t('registrationLink')}</Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('username')}</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {oauthError && (
              <ErrorAlert variant="destructive">
                {oauthError}
              </ErrorAlert>
            )}
            {error && (
              <ErrorAlert variant="destructive">
                {error}
              </ErrorAlert>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t('signingIn') : t('signIn')}
            </Button>
          </form>
          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full"
            onClick={() => {
              setOtpError(null);
              setStep('otp-email');
            }}
          >
            {t('signInWithEmailOtp')}
          </Button>
          {enabledIssuers.length > 0 && (
            <div className="mt-6 space-y-3">
              <p className="text-center text-sm text-muted-foreground">{t('oauthOrContinueWith')}</p>
              {enabledIssuers.map((issuer) => (
                <Button
                  key={issuer}
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void startOAuth(issuer)}
                >
                  {t(OAUTH_BUTTON_KEYS[issuer])}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default function LoginRoute() {
  const loaderData = useLoaderData<typeof loader>();
  return <LoginPage initialProviders={loaderData?.providers ?? null} />;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('signIn');
}
