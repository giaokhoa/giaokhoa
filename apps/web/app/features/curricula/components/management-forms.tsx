import type {
  Curriculum,
  CurriculumNode,
  LearningOutcome,
  Subject,
} from '@giaokhoa/shared/curriculum';
import { Alert, AlertDescription, AlertTitle } from '@giaokhoa/ui/components/alert';
import { Button } from '@giaokhoa/ui/components/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { NativeSelect, NativeSelectOption } from '@giaokhoa/ui/components/native-select';
import { Textarea } from '@giaokhoa/ui/components/textarea';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import { useId, type ReactNode } from 'react';
import { isRouteErrorResponse, Link, useFetcher, useNavigation, useRouteError } from 'react-router';
import type { ManagementEntity, ManagementFeedback } from '../management';

function MutationForm({
  intent,
  id,
  nodeId,
  label,
  disabled = false,
  children,
}: {
  intent: string;
  id?: string;
  nodeId?: string;
  label: string;
  disabled?: boolean;
  children?: (fields: Record<string, string>, disabled: boolean) => ReactNode;
}) {
  const fetcher = useFetcher<ManagementFeedback>();
  const navigation = useNavigation();
  const pending = fetcher.state !== 'idle';
  const unavailable = disabled || pending || navigation.state !== 'idle';
  const deleting = intent.endsWith('-delete');
  return (
    <fetcher.Form
      method="post"
      aria-label={label}
      aria-busy={pending}
      onSubmit={(event) => {
        if (deleting && !window.confirm('Bạn có chắc muốn xóa? Thao tác này không thể hoàn tác.')) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="intent" value={intent} />
      {id && <input type="hidden" name="id" value={id} />}
      {nodeId && <input type="hidden" name="nodeId" value={nodeId} />}
      <FieldSet disabled={unavailable}>
        <FieldGroup>
          {children?.(fetcher.data?.fields ?? {}, unavailable)}
          {fetcher.data?.error && (
            <Alert variant="destructive">
              <AlertDescription>{fetcher.data.error}</AlertDescription>
            </Alert>
          )}
          {fetcher.data?.success && !pending && (
            <Alert role="status">
              <AlertDescription>{fetcher.data.success}</AlertDescription>
            </Alert>
          )}
          <Field data-disabled={unavailable || undefined}>
            <Button
              type="submit"
              disabled={unavailable}
              variant={deleting ? 'destructive' : 'default'}
            >
              {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {pending ? 'Đang xử lý…' : label}
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </fetcher.Form>
  );
}

function InputField({
  name,
  label,
  value,
  error,
  disabled,
  help,
  type = 'text',
  required,
  multiline,
}: {
  name: string;
  label: string;
  value?: string | number;
  error?: string;
  disabled: boolean;
  help?: string;
  type?: 'text' | 'number';
  required?: boolean;
  multiline?: boolean;
}) {
  const id = useId();
  const props = {
    id,
    name,
    defaultValue: value,
    required,
    disabled,
    'aria-invalid': !!error,
    'aria-describedby': `${id}-help ${id}-error`,
  };
  return (
    <Field data-invalid={!!error} data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea {...props} rows={3} />
      ) : (
        <Input
          {...props}
          type={type}
          min={type === 'number' ? 1 : undefined}
          max={name === 'grade' ? 12 : type === 'number' ? 2147483647 : undefined}
          step={type === 'number' ? 1 : undefined}
        />
      )}
      <FieldDescription id={`${id}-help`}>{help}</FieldDescription>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}

export function CurriculumForm({
  curriculum,
  subjects,
}: {
  curriculum?: Curriculum;
  subjects: Subject[];
}) {
  const subjectId = useId();
  return (
    <MutationForm
      intent={curriculum ? 'curriculum-update' : 'curriculum-create'}
      id={curriculum?.id}
      label={curriculum ? 'Lưu chương trình' : 'Tạo chương trình'}
      disabled={subjects.length === 0}
    >
      {(fields, disabled) => (
        <>
          <Field data-invalid={!!fields.subjectId} data-disabled={disabled || undefined}>
            <FieldLabel htmlFor={subjectId}>Môn học</FieldLabel>
            <NativeSelect
              id={subjectId}
              name="subjectId"
              defaultValue={curriculum?.subjectId ?? ''}
              required
              disabled={disabled}
              aria-invalid={!!fields.subjectId}
              aria-describedby={`${subjectId}-error`}
            >
              <NativeSelectOption value="" disabled>
                Chọn môn học
              </NativeSelectOption>
              {subjects.map((subject) => (
                <NativeSelectOption key={subject.id} value={subject.id}>
                  {subject.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError id={`${subjectId}-error`}>{fields.subjectId}</FieldError>
            {subjects.length === 0 && (
              <FieldDescription>Chưa có môn học để tạo chương trình.</FieldDescription>
            )}
          </Field>
          <InputField
            name="grade"
            label="Lớp"
            type="number"
            required
            value={curriculum?.grade}
            error={fields.grade}
            disabled={disabled}
            help="Từ lớp 1 đến lớp 12."
          />
        </>
      )}
    </MutationForm>
  );
}

export function NodeForm({ node }: { node?: CurriculumNode }) {
  return (
    <MutationForm
      intent={node ? 'node-update' : 'node-create'}
      id={node?.id}
      label={node ? 'Lưu nút' : 'Tạo nút'}
    >
      {(fields, disabled) => (
        <>
          <InputField
            name="title"
            label="Tiêu đề nút"
            required
            value={node?.title}
            error={fields.title}
            disabled={disabled}
          />
          <InputField
            name="parentId"
            label="Mã nút cha"
            value={node?.parentId ?? ''}
            error={fields.parentId}
            disabled={disabled}
            help="Nhập UUID v7 của nút cha trong chương trình này. Để trống để đặt làm nút gốc."
          />
          <InputField
            name="position"
            label="Vị trí"
            type="number"
            value={node?.position}
            error={fields.position}
            disabled={disabled}
            help="Số nguyên dương. Để trống để máy chủ tự xếp khi tạo hoặc giữ vị trí khi sửa."
          />
        </>
      )}
    </MutationForm>
  );
}

export function OutcomeForm({ nodeId, outcome }: { nodeId: string; outcome?: LearningOutcome }) {
  return (
    <MutationForm
      intent={outcome ? 'outcome-update' : 'outcome-create'}
      id={outcome?.id}
      nodeId={nodeId}
      label={outcome ? 'Lưu mục tiêu học tập' : 'Tạo mục tiêu học tập'}
    >
      {(fields, disabled) => (
        <>
          <InputField
            name="content"
            label="Nội dung mục tiêu học tập"
            required
            multiline
            value={outcome?.content}
            error={fields.content}
            disabled={disabled}
          />
          <InputField
            name="position"
            label="Vị trí"
            type="number"
            value={outcome?.position}
            error={fields.position}
            disabled={disabled}
            help="Số nguyên dương. Để trống để máy chủ tự xếp khi tạo hoặc giữ vị trí khi sửa."
          />
        </>
      )}
    </MutationForm>
  );
}

export function DeleteForm({
  entity,
  id,
  nodeId,
  label,
}: {
  entity: ManagementEntity;
  id: string;
  nodeId?: string;
  label: string;
}) {
  return <MutationForm intent={`${entity}-delete`} id={id} nodeId={nodeId} label={label} />;
}

export function ManagementEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function CurriculumErrorBoundary() {
  const error = useRouteError();
  return (
    <main className="flex flex-col gap-4 p-4 lg:p-6">
      <Alert variant="destructive">
        <AlertTitle>Không thể tải chương trình học</AlertTitle>
        <AlertDescription>
          {isRouteErrorResponse(error) && typeof error.data === 'string'
            ? error.data
            : 'Đã xảy ra lỗi. Vui lòng thử lại.'}
        </AlertDescription>
      </Alert>
      <Button variant="outline" render={<Link to="/curricula" />} nativeButton={false}>
        Về danh sách chương trình
      </Button>
    </main>
  );
}
