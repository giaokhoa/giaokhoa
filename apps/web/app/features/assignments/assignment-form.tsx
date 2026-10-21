import type { Assignment } from '@giaokhoa/shared/assignments';
import { Button } from '@giaokhoa/ui/components/button';
import { Alert, AlertDescription } from '@giaokhoa/ui/components/alert';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { useEffect, useState, type FormEvent } from 'react';
import { Form, isRouteErrorResponse, useNavigation, useRouteError, useSubmit } from 'react-router';
import { localDateTimeToIso, scheduleFields, toLocalDateTime } from './assignment-data.js';

export function AssignmentForm({
  assignment,
  classId = '',
  examRevisionId = '',
  error,
  fieldErrors = {},
}: {
  assignment?: Assignment;
  classId?: string;
  examRevisionId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const [initialAssignment] = useState(assignment);
  const [dateValues, setDateValues] = useState<Record<string, string>>({});
  const [timeZone, setTimeZone] = useState('');
  const [audienceMode, setAudienceMode] = useState(assignment?.audienceMode ?? 'ALL_CLASS');
  const pending = navigation.state !== 'idle';
  const intent = navigation.formData?.get('intent');
  const saving = pending && (intent === 'create' || intent === 'update');

  useEffect(() => {
    setDateValues(
      Object.fromEntries(
        scheduleFields.map(({ name }) => [
          name,
          initialAssignment?.[name] ? toLocalDateTime(initialAssignment[name]) : '',
        ]),
      ),
    );
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [initialAssignment]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set('intent', assignment ? 'update' : 'create');
    for (const { name } of scheduleFields) {
      const entry = form.get(name);
      const value = typeof entry === 'string' ? entry : '';
      form.set(name, value ? (localDateTimeToIso(value) ?? value) : '');
    }
    void submit(form, { method: 'post' });
  }

  function fieldError(name: string) {
    return fieldErrors[name] ? (
      <FieldError id={`${name}-error`}>{fieldErrors[name]}</FieldError>
    ) : null;
  }

  return (
    <Form method="post" onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{assignment ? 'Sửa bản nháp' : 'Tạo bài giao'}</CardTitle>
          <CardDescription>
            {assignment
              ? 'Lớp và phiên bản đề được giữ cố định sau khi tạo.'
              : 'Nhập mã lớp và mã phiên bản đề đã tạo để giao bài.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldSet disabled={pending || !timeZone}>
            <FieldGroup>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {!assignment && (
                <>
                  <Field data-invalid={Boolean(fieldErrors.classId)}>
                    <FieldLabel htmlFor="classId">Mã lớp</FieldLabel>
                    <Input
                      id="classId"
                      name="classId"
                      defaultValue={classId}
                      required
                      aria-invalid={Boolean(fieldErrors.classId)}
                      aria-describedby={fieldErrors.classId ? 'classId-error' : undefined}
                    />
                    {fieldError('classId')}
                  </Field>
                  <Field data-invalid={Boolean(fieldErrors.examRevisionId)}>
                    <FieldLabel htmlFor="examRevisionId">Mã phiên bản đề</FieldLabel>
                    <Input
                      id="examRevisionId"
                      name="examRevisionId"
                      defaultValue={examRevisionId}
                      required
                      aria-invalid={Boolean(fieldErrors.examRevisionId)}
                      aria-describedby={
                        fieldErrors.examRevisionId ? 'examRevisionId-error' : undefined
                      }
                    />
                    {fieldError('examRevisionId')}
                  </Field>
                </>
              )}
              <FieldSet
                aria-describedby={fieldErrors.audienceMode ? 'audienceMode-error' : undefined}
              >
                <FieldLegend>Người nhận</FieldLegend>
                <FieldGroup>
                  <Field orientation="horizontal" data-invalid={Boolean(fieldErrors.audienceMode)}>
                    <input
                      id="all-class"
                      type="radio"
                      name="audienceMode"
                      value="ALL_CLASS"
                      checked={audienceMode === 'ALL_CLASS'}
                      onChange={() => setAudienceMode('ALL_CLASS')}
                      aria-invalid={Boolean(fieldErrors.audienceMode)}
                    />
                    <FieldLabel htmlFor="all-class">Cả lớp</FieldLabel>
                  </Field>
                  <Field orientation="horizontal" data-invalid={Boolean(fieldErrors.audienceMode)}>
                    <input
                      id="selected-users"
                      type="radio"
                      name="audienceMode"
                      value="SELECTED_USERS"
                      checked={audienceMode === 'SELECTED_USERS'}
                      onChange={() => setAudienceMode('SELECTED_USERS')}
                      aria-invalid={Boolean(fieldErrors.audienceMode)}
                    />
                    <FieldLabel htmlFor="selected-users">Học sinh cụ thể</FieldLabel>
                  </Field>
                  {fieldError('audienceMode')}
                  <Field
                    data-disabled={audienceMode !== 'SELECTED_USERS'}
                    data-invalid={Boolean(fieldErrors.selectedUserIds)}
                  >
                    <FieldLabel htmlFor="selectedUserIds">Mã học sinh được chọn</FieldLabel>
                    <Input
                      id="selectedUserIds"
                      name="selectedUserIds"
                      defaultValue={assignment?.selectedUserIds.join(', ') ?? ''}
                      disabled={audienceMode !== 'SELECTED_USERS'}
                      required={audienceMode === 'SELECTED_USERS'}
                      aria-invalid={Boolean(fieldErrors.selectedUserIds)}
                      aria-describedby="selected-users-description selectedUserIds-error"
                    />
                    <FieldDescription id="selected-users-description">
                      Phân cách các mã bằng dấu phẩy hoặc khoảng trắng; tối đa 5.000 mã, không lặp.
                    </FieldDescription>
                    {fieldError('selectedUserIds')}
                  </Field>
                </FieldGroup>
              </FieldSet>
              <FieldSet>
                <FieldLegend>Lịch giao và công bố</FieldLegend>
                <FieldDescription>
                  Giờ nhập theo {timeZone || 'múi giờ trình duyệt'}, được chuyển sang UTC khi lưu.
                  Để trống lịch công bố để chưa cho xem nội dung đó.
                </FieldDescription>
                <FieldGroup>
                  {scheduleFields.map(({ name, label, required }) => (
                    <Field key={name} data-invalid={Boolean(fieldErrors[name])}>
                      <FieldLabel htmlFor={name}>{label}</FieldLabel>
                      <Input
                        id={name}
                        name={name}
                        type="datetime-local"
                        step="0.001"
                        required={required}
                        value={dateValues[name] ?? ''}
                        onChange={(event) =>
                          setDateValues({ ...dateValues, [name]: event.target.value })
                        }
                        aria-invalid={Boolean(fieldErrors[name])}
                        aria-describedby={fieldErrors[name] ? `${name}-error` : undefined}
                      />
                      {fieldError(name)}
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
              <Field data-invalid={Boolean(fieldErrors.maxAttempts)}>
                <FieldLabel htmlFor="maxAttempts">Số lượt làm tối đa</FieldLabel>
                <Input
                  id="maxAttempts"
                  name="maxAttempts"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  defaultValue={assignment?.maxAttempts ?? 1}
                  required
                  aria-invalid={Boolean(fieldErrors.maxAttempts)}
                  aria-describedby={fieldErrors.maxAttempts ? 'maxAttempts-error' : undefined}
                />
                {fieldError('maxAttempts')}
              </Field>
            </FieldGroup>
          </FieldSet>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending || !timeZone}>
            {saving && <Spinner data-icon="inline-start" aria-label="Đang lưu" />}
            {saving ? 'Đang lưu…' : assignment ? 'Lưu bản nháp' : 'Tạo bản nháp'}
          </Button>
        </CardFooter>
      </Card>
    </Form>
  );
}

export function AssignmentErrorBoundary() {
  const error = useRouteError();
  return (
    <main className="p-4 lg:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Không thể mở bài giao</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              {isRouteErrorResponse(error) && typeof error.data === 'string'
                ? error.data
                : 'Đã có lỗi xảy ra. Vui lòng thử lại.'}
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Tải lại
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
