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
} from '@giaokhoa/ui/components/field';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { safeRedirectPath } from '#lib/http/redirect.js';
import { authClient } from '../api/auth-client';
import { AuthOtpInput } from './otp-input';

export function VerifyEmailForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email')?.trim() ?? '';
  const redirectTo = safeRedirectPath(searchParams.get('redirect'));
  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const resend = useCallback(async () => {
    if (!email) return;

    setSubmitting(true);
    setMessage(undefined);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'email-verification',
      });
      if (result.error) {
        setMessage(result.error.message ?? 'Không thể gửi mã xác minh.');
        return;
      }
      setOtp('');
      setMessage('Đã gửi lại mã OTP.');
    } catch {
      setMessage('Không thể kết nối tới máy chủ.');
    } finally {
      setSubmitting(false);
    }
  }, [email]);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!email || otp.length !== 6) return;

      setSubmitting(true);
      setMessage(undefined);
      try {
        const result = await authClient.emailOtp.verifyEmail({ email, otp });
        if (result.error) {
          setMessage(result.error.message ?? 'Mã xác minh không hợp lệ hoặc đã hết hạn.');
          return;
        }

        window.location.replace(redirectTo);
      } catch {
        setMessage('Không thể kết nối tới máy chủ.');
      } finally {
        setSubmitting(false);
      }
    },
    [email, otp, redirectTo],
  );

  if (!email) {
    return (
      <Card>
        <CardContent>
          <FieldGroup>
            <Field data-invalid>
              <FieldError>Thiếu email cần xác minh.</FieldError>
            </Field>
            <Field>
              <Button type="button" onClick={() => void navigate('/register')}>
                Quay lại đăng ký
              </Button>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle size="lg">Xác minh email</CardTitle>
        <CardDescription>Nhập mã xác minh đã gửi tới email của bạn</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="otp">Mã OTP</FieldLabel>
                <button
                  type="button"
                  className="text-sm underline-offset-4 hover:underline disabled:opacity-50"
                  disabled={submitting || !email}
                  onClick={resend}
                >
                  Gửi lại mã
                </button>
              </div>
              <AuthOtpInput value={otp} onChange={setOtp} disabled={submitting} />
            </Field>

            {message &&
              (message.startsWith('Đã gửi') ? (
                <Field>
                  <FieldDescription>{message}</FieldDescription>
                </Field>
              ) : (
                <Field data-invalid>
                  <FieldError>{message}</FieldError>
                </Field>
              ))}

            <Field>
              <Button type="submit" disabled={submitting || otp.length !== 6}>
                {submitting ? 'Đang xác minh…' : 'Xác minh email'}
              </Button>
              <FieldDescription>
                <Link to="/login">Quay lại đăng nhập</Link>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
