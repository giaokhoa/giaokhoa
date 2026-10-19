import { Button, buttonVariants } from '@giaokhoa/ui/components/button';
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
} from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { authClient } from '../api/auth-client';
import { AuthOtpInput } from './otp-input';

function readField(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

export function PasswordRecoveryForm() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const requestOtp = useCallback(async (targetEmail: string) => {
    const result = await authClient.emailOtp.requestPasswordReset({ email: targetEmail });

    if (result.error) {
      setError(result.error.message ?? 'Không thể gửi mã OTP.');
      return false;
    }

    return true;
  }, []);

  const request = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(undefined);
      setSubmitting(true);

      const targetEmail = readField(new FormData(event.currentTarget), 'email').trim();

      try {
        if (await requestOtp(targetEmail)) {
          setEmail(targetEmail);
          setOtp('');
          setOtpSent(true);
        }
      } catch {
        setError('Không thể kết nối tới máy chủ.');
      } finally {
        setSubmitting(false);
      }
    },
    [requestOtp],
  );

  const resend = useCallback(async () => {
    if (!email) return;

    setError(undefined);
    setSubmitting(true);
    try {
      if (await requestOtp(email)) setOtp('');
    } catch {
      setError('Không thể kết nối tới máy chủ.');
    } finally {
      setSubmitting(false);
    }
  }, [email, requestOtp]);

  const reset = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(undefined);

      const data = new FormData(event.currentTarget);
      const password = readField(data, 'password');
      const confirmPassword = readField(data, 'confirmPassword');

      if (password !== confirmPassword) {
        setError('Mật khẩu xác nhận không khớp.');
        return;
      }

      setSubmitting(true);
      try {
        const result = await authClient.emailOtp.resetPassword({
          email,
          otp,
          password,
        });

        if (result.error) {
          setError(result.error.message ?? 'Mã OTP không hợp lệ hoặc đã hết hạn.');
          return;
        }

        setSuccess(true);
      } catch {
        setError('Không thể kết nối tới máy chủ.');
      } finally {
        setSubmitting(false);
      }
    },
    [email, otp],
  );

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle size="lg">Quên mật khẩu</CardTitle>
        {!success && (
          <CardDescription>
            {otpSent
              ? 'Nhập mã xác minh đã gửi tới email của bạn'
              : 'Nhập email đã đăng ký để đặt lại mật khẩu.'}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {success ? (
          <FieldGroup>
            <FieldDescription>
              Mật khẩu đã được cập nhật. Bạn có thể đăng nhập lại bằng mật khẩu mới.
            </FieldDescription>
            <Link to="/login" className={buttonVariants()}>
              Về trang đăng nhập
            </Link>
          </FieldGroup>
        ) : (
          <form onSubmit={otpSent ? reset : request}>
            <FieldGroup>
              {!otpSent ? (
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="name@example.com"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={submitting}
                    required
                  />
                </Field>
              ) : (
                <>
                  <Field>
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel htmlFor="otp">Mã OTP</FieldLabel>
                      <button
                        type="button"
                        className="text-sm underline-offset-4 hover:underline disabled:opacity-50"
                        disabled={submitting}
                        onClick={resend}
                      >
                        Gửi lại mã
                      </button>
                    </div>
                    <AuthOtpInput value={otp} onChange={setOtp} disabled={submitting} />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="password">Mật khẩu mới</FieldLabel>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      placeholder="********"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      disabled={submitting}
                      required
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="confirmPassword">Xác nhận mật khẩu</FieldLabel>
                    <Input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      placeholder="********"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      disabled={submitting}
                      required
                    />
                  </Field>
                </>
              )}

              {error && (
                <Field data-invalid>
                  <FieldError>{error}</FieldError>
                </Field>
              )}

              <Field>
                <Button
                  type="submit"
                  disabled={
                    submitting || (!otpSent && !email.trim()) || (otpSent && otp.length !== 6)
                  }
                >
                  {submitting ? 'Đang xử lý…' : otpSent ? 'Đặt lại mật khẩu' : 'Gửi mã OTP'}
                </Button>
                <FieldDescription>
                  <Link to="/login">Quay lại đăng nhập</Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
