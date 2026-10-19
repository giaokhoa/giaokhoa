import type { Subject } from '@giaokhoa/shared/curriculum';
import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
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

type UpdateSubjectActionData = { subject: Subject } | { error: string };

export function SubjectEditSheet({ subject, onClose }: { subject: Subject; onClose: () => void }) {
  const fetcher = useFetcher<UpdateSubjectActionData>();
  const saving = fetcher.state !== 'idle';

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
          <SheetTitle>Sửa môn học</SheetTitle>
          <SheetDescription>Cập nhật tên, slug và số thứ tự hiển thị.</SheetDescription>
        </SheetHeader>

        <fetcher.Form method="post" className="grid gap-5">
          <div className="grid gap-5 px-4">
            <input type="hidden" name="id" value={subject.id} />

            <div className="grid gap-2">
              <Label htmlFor="subject-name">Tên môn học</Label>
              <Input id="subject-name" name="name" defaultValue={subject.name} required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="subject-slug">Slug</Label>
              <Input id="subject-slug" name="slug" defaultValue={subject.slug} required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="subject-position">STT</Label>
              <Input
                id="subject-position"
                name="position"
                type="number"
                min={1}
                max={2_147_483_647}
                step={1}
                defaultValue={subject.position}
                required
              />
            </div>

            {fetcher.data && 'error' in fetcher.data && (
              <p className="text-sm text-destructive" role="alert">
                {fetcher.data.error}
              </p>
            )}
          </div>

          <SheetFooter>
            <Button type="submit" disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
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
