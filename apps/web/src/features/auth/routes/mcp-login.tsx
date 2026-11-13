import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { ErrorAlert } from '#components/error-alert';

export default function McpLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/auth/get-session', { credentials: 'include' });
        const body = (await res.json().catch(() => null)) as { user?: unknown } | null;
        if (!cancelled && res.ok && body && typeof body === 'object' && body.user) {
          window.location.assign(`/api/v1/auth/oauth2/authorize${window.location.search}`);
          return;
        }
      } catch {
      }
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/sign-in/username', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        setError('Đăng nhập không thành công. Kiểm tra lại tên đăng nhập và mật khẩu.');
        setBusy(false);
        return;
      }
      const body = (await res.json().catch(() => null)) as { twoFactorRedirect?: unknown } | null;
      if (body && typeof body === 'object' && body.twoFactorRedirect) {
        setNeedsMfa(true);
        setBusy(false);
        return;
      }
      window.location.assign(`/api/v1/auth/oauth2/authorize${window.location.search}`);
    } catch {
      setError('Không kết nối được máy chủ. Thử lại sau ít phút.');
      setBusy(false);
    }
  }

  async function onMfaSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/two-factor/verify-totp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: mfaCode.trim() }),
      });
      if (!res.ok) {
        setError('Mã xác thực không đúng hoặc đã hết hạn. Đăng nhập lại để nhận thử thách mới nếu mã vẫn bị từ chối.');
        setBusy(false);
        return;
      }
      window.location.assign(`/api/v1/auth/oauth2/authorize${window.location.search}`);
    } catch {
      setError('Không kết nối được máy chủ. Thử lại sau ít phút.');
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Đăng nhập để uỷ quyền ứng dụng AI</CardTitle>
          <CardDescription>
            Một ứng dụng AI đang xin quyền truy cập ngân hàng câu hỏi thay bạn. Đăng nhập bằng tài khoản Giáo khoa
            của bạn để tiếp tục tới bước xác nhận quyền.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {checking ? (
            <p className="text-sm text-muted-foreground">Đang kiểm tra phiên đăng nhập…</p>
          ) : needsMfa ? (
            <form className="space-y-4" onSubmit={onMfaSubmit}>
              {error ? (
                <ErrorAlert variant="destructive">
                  {error}
                </ErrorAlert>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Tài khoản của bạn đã bật xác thực hai lớp. Nhập mã 6 số từ ứng dụng xác thực để tiếp tục.
              </p>
              <div className="space-y-2">
                <Label htmlFor="mcp-mfa-code">Mã xác thực</Label>
                <Input
                  id="mcp-mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Đang xác thực…' : 'Xác thực và tiếp tục'}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit}>
              {error ? (
                <ErrorAlert variant="destructive">
                  {error}
                </ErrorAlert>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="mcp-username">Tên đăng nhập</Label>
                <Input
                  id="mcp-username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-password">Mật khẩu</Label>
                <Input
                  id="mcp-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Đang đăng nhập…' : 'Đăng nhập và tiếp tục'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
