import { Button } from '@giaokhoa/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../api/auth-client';
import { AuthOtpInput } from './otp-input';

type AuthMode = 'login' | 'register';
type LoginMethod = 'otp' | 'password';
type AuthAction = 'google' | 'email';

function safeRedirectPath(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function onboardingPath(redirectTo: string) {
  return `/onboarding?redirect=${encodeURIComponent(redirectTo)}`;
}

function readField(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirectPath(searchParams.get('redirect'));
  const isRegister = mode === 'register';
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('otp');
  const [message, setMessage] = useState<string>();
  const [pendingAction, setPendingAction] = useState<AuthAction | null>(null);
  const submitting = pendingAction !== null;

  const redirectSuffix = redirectTo === '/' ? '' : `?redirect=${encodeURIComponent(redirectTo)}`;
  const alternateAuthPath = isRegister ? `/login${redirectSuffix}` : `/register${redirectSuffix}`;

  const signInWithGoogle = useCallback(async () => {
    setMessage(undefined);
    setPendingAction('google');

    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: new URL(redirectTo, window.location.origin).toString(),
      });
      if (result.error) setMessage(result.error.message ?? 'Không thể tiếp tục với Google.');
    } catch {
      setMessage('Google chưa được cấu hình hoặc máy chủ không khả dụng.');
    } finally {
      setPendingAction(null);
    }
  }, [redirectTo]);

  const requestLoginOtp = useCallback(async () => {
    if (!email) return false;

    const result = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: 'sign-in',
    });
    if (result.error) {
      setMessage(result.error.message ?? 'Không thể gửi mã OTP.');
      return false;
    }

    setOtp('');
    setOtpSent(true);
    return true;
  }, [email]);

  const resendLoginOtp = useCallback(async () => {
    setMessage(undefined);
    setPendingAction('email');
    try {
      if (await requestLoginOtp()) setMessage('Đã gửi lại mã OTP.');
    } catch {
      setMessage('Không thể kết nối tới máy chủ.');
    } finally {
      setPendingAction(null);
    }
  }, [requestLoginOtp]);

  const changeLoginMethod = useCallback(() => {
    setLoginMethod((current) => (current === 'otp' ? 'password' : 'otp'));
    setOtp('');
    setOtpSent(false);
    setMessage(undefined);
  }, []);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setMessage(undefined);
      setPendingAction('email');

      try {
        if (isRegister) {
          const firstName = readField(form, 'firstName');
          const lastName = readField(form, 'lastName');
          const result = await authClient.signUp.email({
            name: `${lastName} ${firstName}`.trim(),
            email,
            password: readField(form, 'password'),
            callbackURL: new URL(redirectTo, window.location.origin).toString(),
          });

          if (result.error) {
            setMessage(result.error.message ?? 'Không thể đăng ký.');
            return;
          }

          if (!result.data?.token) {
            const params = new URLSearchParams({ email, redirect: redirectTo });
            await navigate(`/verify-email?${params.toString()}`);
            return;
          }

          await navigate(redirectTo);
          return;
        }

        if (loginMethod === 'otp') {
          if (!otpSent) {
            await requestLoginOtp();
            return;
          }

          const result = await authClient.signIn.emailOtp({ email, otp });
          if (result.error) {
            setMessage(result.error.message ?? 'Mã OTP không hợp lệ hoặc đã hết hạn.');
            return;
          }

          await navigate(result.data?.user.name.trim() ? redirectTo : onboardingPath(redirectTo));
          return;
        }

        const result = await authClient.signIn.email({
          email,
          password: readField(form, 'password'),
        });
        if (result.error) {
          if (result.error.code === 'EMAIL_NOT_VERIFIED') {
            const params = new URLSearchParams({ email, redirect: redirectTo });
            await navigate(`/verify-email?${params.toString()}`);
            return;
          }

          setMessage(result.error.message ?? 'Email hoặc mật khẩu không đúng.');
          return;
        }

        await navigate(redirectTo);
      } catch {
        setMessage('Không thể kết nối tới máy chủ.');
      } finally {
        setPendingAction(null);
      }
    },
    [email, isRegister, loginMethod, navigate, otp, otpSent, redirectTo, requestLoginOtp],
  );

  const submitLabel =
    pendingAction === 'email'
      ? isRegister
        ? 'Đang tạo tài khoản…'
        : loginMethod === 'otp'
          ? otpSent
            ? 'Đang xác nhận…'
            : 'Đang gửi mã…'
          : 'Đang đăng nhập…'
      : isRegister
        ? 'Tạo tài khoản'
        : loginMethod === 'otp'
          ? otpSent
            ? 'Xác nhận mã OTP'
            : 'Gửi mã đăng nhập'
          : 'Đăng nhập';

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle size="lg">{isRegister ? 'Tạo tài khoản' : 'Chào mừng trở lại'}</CardTitle>
          <CardDescription>
            {isRegister
              ? 'Vui lòng cung cấp thông tin đăng ký'
              : 'Đăng nhập bằng tài khoản Google hoặc Email'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <FieldGroup>
            {!isRegister && (
              <>
                <Field>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    onClick={signInWithGoogle}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                      />
                    </svg>
                    {pendingAction === 'google' ? 'Đang chuyển đến Google…' : 'Tiếp tục với Google'}
                  </Button>
                </Field>

                <FieldSeparator>Hoặc tiếp tục với email</FieldSeparator>
              </>
            )}

            <form onSubmit={submit}>
              <FieldGroup>
                {isRegister && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel htmlFor="lastName">Họ</FieldLabel>
                      <Input
                        id="lastName"
                        name="lastName"
                        autoComplete="family-name"
                        placeholder="Nguyễn"
                        disabled={submitting}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="firstName">Tên</FieldLabel>
                      <Input
                        id="firstName"
                        name="firstName"
                        autoComplete="given-name"
                        placeholder="Văn A"
                        disabled={submitting}
                        required
                      />
                    </Field>
                  </div>
                )}

                <Field>
                  <div className="flex items-center justify-between gap-3">
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    {!isRegister && (
                      <button
                        type="button"
                        className="text-sm underline-offset-4 hover:underline disabled:opacity-50"
                        disabled={submitting}
                        onClick={changeLoginMethod}
                      >
                        {loginMethod === 'otp' ? 'Dùng mật khẩu' : 'Dùng mã OTP'}
                      </button>
                    )}
                  </div>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="name@example.com"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.currentTarget.value);
                      setOtp('');
                      setOtpSent(false);
                      setMessage(undefined);
                    }}
                    disabled={submitting}
                    required
                  />
                </Field>

                {!isRegister && loginMethod === 'otp' && otpSent && (
                  <Field>
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel htmlFor="otp">Mã OTP</FieldLabel>
                      <button
                        type="button"
                        className="text-sm underline-offset-4 hover:underline disabled:opacity-50"
                        disabled={submitting || !email}
                        onClick={resendLoginOtp}
                      >
                        Gửi lại mã
                      </button>
                    </div>
                    <AuthOtpInput value={otp} onChange={setOtp} disabled={submitting} />
                  </Field>
                )}

                {(isRegister || loginMethod === 'password') && (
                  <Field>
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel htmlFor="password">Mật khẩu</FieldLabel>
                      {!isRegister && (
                        <Link
                          to="/forgot-password"
                          className="text-sm underline-offset-4 hover:underline"
                        >
                          Quên mật khẩu?
                        </Link>
                      )}
                    </div>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      placeholder="********"
                      autoComplete={isRegister ? 'new-password' : 'current-password'}
                      minLength={8}
                      maxLength={128}
                      disabled={submitting}
                      required
                    />
                  </Field>
                )}

                {message && (
                  <Field data-invalid={!message.startsWith('Đã gửi')}>
                    {message.startsWith('Đã gửi') ? (
                      <FieldDescription>{message}</FieldDescription>
                    ) : (
                      <FieldError>{message}</FieldError>
                    )}
                  </Field>
                )}

                <Field>
                  <Button
                    type="submit"
                    disabled={
                      submitting ||
                      !email ||
                      (!isRegister && loginMethod === 'otp' && otpSent && otp.length !== 6)
                    }
                  >
                    {submitLabel}
                  </Button>
                  <FieldDescription className="text-center">
                    {isRegister ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? '}
                    <Link to={alternateAuthPath}>{isRegister ? 'Đăng nhập' : 'Đăng ký'}</Link>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="px-6">
        <FieldDescription className="text-center">
          Bằng việc tiếp tục, bạn đồng ý tuân thủ điều khoản sử dụng và chính sách quyền riêng tư
          của Giáo khoa.
        </FieldDescription>
      </div>
    </div>
  );
}
