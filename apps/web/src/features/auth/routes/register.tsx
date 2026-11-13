import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { ErrorAlert } from '#components/error-alert';
import { PageShell } from '#components/page-shell';
import { ApiError, apiJson } from '#lib/api';
import { useAuth } from '#lib/auth';
import '#config/i18n';

/**
 * Tài khoản được đăng ký tại chính host của khu học tập: API sẽ
 * đối chiếu host và kho riêng trước khi ghi. Web không gửi slug hay
 * tenant id do người dùng tự chọn (không có đường tạo chéo trung tâm).
 */
export function PublicRegistrationPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function register(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiJson('/api/v1/auth/public/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, firstName, lastName, password, role }),
      });
      // Đăng nhập tại CÙNG địa chỉ; phiên Better Auth được lưu trong
      // chính kho công cộng, không dùng token của kho vận hành.
      await login(username, password);
      navigate('/profile');
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : t('registrationFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell width="narrow" contentClassName="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{t('registrationTitle')}</CardTitle>
          <CardDescription>{t('registrationDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={register} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="register-username">{t('username')}</Label>
              <Input id="register-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={30} pattern="[a-zA-Z0-9_.]+" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="register-email">{t('registrationEmail')}</Label>
              <Input id="register-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="register-first-name">{t('registrationFirstName')}</Label>
              <Input id="register-first-name" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="register-last-name">{t('registrationLastName')}</Label>
              <Input id="register-last-name" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('registrationRole')}</legend>
              <label className="mr-4 inline-flex items-center gap-2">
                <input type="radio" checked={role === 'student'} onChange={() => setRole('student')} name="registration-role" />
                {t('registrationStudent')}
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={role === 'teacher'} onChange={() => setRole('teacher')} name="registration-role" />
                {t('registrationTeacher')}
              </label>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="register-password">{t('password')}</Label>
              <Input id="register-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <ErrorAlert variant="destructive">{error}</ErrorAlert>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t('registrationSubmitting') : t('registrationSubmit')}
            </Button>
            <p className="text-center text-sm">
              <Link to="/login" className="underline">{t('registrationBackToLogin')}</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default PublicRegistrationPage;
