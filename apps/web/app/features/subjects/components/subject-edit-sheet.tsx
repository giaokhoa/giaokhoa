import type { Subject } from '@giaokhoa/shared/curriculum';
import { Alert, AlertDescription } from '@giaokhoa/ui/components/alert';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@giaokhoa/ui/components/sheet';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';

type SubjectActionData =
  | { subject: Subject }
  | { error: string; fieldErrors?: Record<string, string> };

export function SubjectFormSheet({ subject, onClose }: { subject?: Subject; onClose: () => void }) {
  const fetcher = useFetcher<SubjectActionData>();
  const saving = fetcher.state !== 'idle';
  const error = fetcher.data && 'error' in fetcher.data ? fetcher.data : undefined;
  const fieldErrors = error?.fieldErrors;

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data && 'subject' in fetcher.data) onClose();
  }, [fetcher.data, fetcher.state, onClose]);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <SheetContent showCloseButton={!saving} className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{subject ? 'Sửa môn học' : 'Thêm môn học'}</SheetTitle>
          <SheetDescription>Nhập tên, mã đường dẫn và thứ tự hiển thị.</SheetDescription>
        </SheetHeader>

        <fetcher.Form method="post" className="flex flex-col gap-5" aria-busy={saving}>
          <FieldGroup className="mx-4">
            <input type="hidden" name="intent" value={subject ? 'update' : 'create'} />
            {subject && <input type="hidden" name="id" value={subject.id} />}

            <Field data-invalid={!!fieldErrors?.name} data-disabled={saving}>
              <FieldLabel htmlFor="subject-name">Tên môn học</FieldLabel>
              <Input
                id="subject-name"
                name="name"
                defaultValue={subject?.name}
                disabled={saving}
                aria-invalid={!!fieldErrors?.name}
                aria-describedby={fieldErrors?.name ? 'subject-name-error' : undefined}
                required
              />
              {fieldErrors?.name && (
                <FieldError id="subject-name-error">{fieldErrors.name}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!fieldErrors?.slug} data-disabled={saving}>
              <FieldLabel htmlFor="subject-slug">Mã đường dẫn</FieldLabel>
              <Input
                id="subject-slug"
                name="slug"
                defaultValue={subject?.slug}
                disabled={saving}
                aria-invalid={!!fieldErrors?.slug}
                aria-describedby="subject-slug-description subject-slug-error"
                required
              />
              <FieldDescription id="subject-slug-description">
                Ví dụ: toan-hoc. Chỉ dùng chữ thường không dấu, chữ số và dấu gạch nối giữa các từ.
              </FieldDescription>
              {fieldErrors?.slug && (
                <FieldError id="subject-slug-error">{fieldErrors.slug}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!fieldErrors?.position} data-disabled={saving}>
              <FieldLabel htmlFor="subject-position">Thứ tự hiển thị</FieldLabel>
              <Input
                id="subject-position"
                name="position"
                type="number"
                min={1}
                max={2_147_483_647}
                step={1}
                defaultValue={subject?.position}
                disabled={saving}
                aria-invalid={!!fieldErrors?.position}
                aria-describedby="subject-position-description subject-position-error"
                required={!!subject}
              />
              {!subject && (
                <FieldDescription id="subject-position-description">
                  Để trống để hệ thống tự sắp xếp.
                </FieldDescription>
              )}
              {fieldErrors?.position && (
                <FieldError id="subject-position-error">{fieldErrors.position}</FieldError>
              )}
            </Field>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error.error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>

          <SheetFooter>
            <Button type="submit" disabled={saving}>
              {saving ? 'Đang lưu…' : subject ? 'Lưu thay đổi' : 'Tạo môn học'}
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Huỷ
            </Button>
          </SheetFooter>
        </fetcher.Form>
      </SheetContent>
    </Sheet>
  );
}
