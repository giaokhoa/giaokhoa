import { Button } from '@giaokhoa/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Form } from 'react-router';

export function OnboardingForm({ error, submitting }: { error?: string; submitting: boolean }) {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle size="lg">Hoàn tất đăng ký</CardTitle>
        <CardDescription>
          Chỉ còn một bước: bổ sung tên hiển thị và tạo mật khẩu để hoàn tất tài khoản Giáo khoa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post">
          <FieldGroup>
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

            <Field>
              <FieldLabel htmlFor="password">Mật khẩu</FieldLabel>
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

            {error && (
              <Field data-invalid>
                <FieldError>{error}</FieldError>
              </Field>
            )}

            <Field>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Đang tạo…' : 'Tiếp tục'}
              </Button>
            </Field>
          </FieldGroup>
        </Form>
      </CardContent>
    </Card>
  );
}
