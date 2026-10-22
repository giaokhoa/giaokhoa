import { useState } from 'react';
import type { Assignment } from '@giaokhoa/shared/assignments';
import type { ClassEnrolment } from '@giaokhoa/shared/classes';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@giaokhoa/ui/components/field';
import { NativeSelect, NativeSelectOption } from '@giaokhoa/ui/components/native-select';
import { InputField } from './ui.js';
import { toLocalDateTime } from '#lib/http/dates.js';
export function AssignmentFields({
  assignment,
  members,
}: {
  assignment?: Assignment;
  members: ClassEnrolment[];
}) {
  const [audience, setAudience] = useState(assignment?.audienceMode ?? 'ALL_CLASS');
  const recipients = [
    ...new Set([
      ...members.filter((member) => member.status === 'active').map((member) => member.userId),
      ...(assignment?.selectedUserIds ?? []),
    ]),
  ];
  return (
    <FieldGroup>
      <FieldDescription>Tất cả thời gian bên dưới theo giờ Việt Nam (UTC+7).</FieldDescription>
      <InputField
        name="openAt"
        label="Mở bài lúc"
        type="datetime-local"
        defaultValue={toLocalDateTime(assignment?.openAt ?? null)}
        required
      />
      <InputField
        name="closeAt"
        label="Đóng bài lúc"
        type="datetime-local"
        defaultValue={toLocalDateTime(assignment?.closeAt ?? null)}
        required
      />
      <InputField
        name="maxAttempts"
        label="Số lượt làm tối đa"
        type="number"
        min={1}
        max={100}
        defaultValue={assignment?.maxAttempts ?? 1}
        required
      />
      <Field>
        <FieldLabel htmlFor="audienceMode">Người nhận</FieldLabel>
        <NativeSelect
          name="audienceMode"
          id="audienceMode"
          value={audience}
          onChange={(event) => setAudience(event.target.value as 'ALL_CLASS' | 'SELECTED_USERS')}
        >
          <NativeSelectOption value="ALL_CLASS">Cả lớp</NativeSelectOption>
          <NativeSelectOption value="SELECTED_USERS">Chọn học sinh</NativeSelectOption>
        </NativeSelect>
      </Field>
      {audience === 'SELECTED_USERS' && (
        <FieldSet>
          <FieldLegend>Học sinh đang học trong lớp</FieldLegend>
          {recipients.length ? (
            recipients.map((userId) => (
              <Field key={userId} orientation="horizontal">
                <input
                  type="checkbox"
                  name="selectedUserIds"
                  value={userId}
                  id={`student-${userId}`}
                  defaultChecked={assignment?.selectedUserIds.includes(userId)}
                />
                <FieldLabel htmlFor={`student-${userId}`}>{userId}</FieldLabel>
              </Field>
            ))
          ) : (
            <FieldDescription>
              Không có danh sách thành viên khả dụng. Cần quyền quản lý thành viên để chọn học sinh.
            </FieldDescription>
          )}
        </FieldSet>
      )}
      <FieldSet>
        <FieldLegend>Lịch công bố kết quả</FieldLegend>
        <FieldDescription>
          Để trống nếu chưa công bố. Điểm, nhận xét và lời giải có lịch riêng.
        </FieldDescription>
        <FieldGroup>
          <InputField
            name="releaseScoreAt"
            label="Công bố điểm lúc"
            type="datetime-local"
            defaultValue={toLocalDateTime(assignment?.releaseScoreAt ?? null)}
          />
          <InputField
            name="releaseFeedbackAt"
            label="Công bố nhận xét lúc"
            type="datetime-local"
            defaultValue={toLocalDateTime(assignment?.releaseFeedbackAt ?? null)}
          />
          <InputField
            name="releaseSolutionsAt"
            label="Công bố lời giải lúc"
            type="datetime-local"
            defaultValue={toLocalDateTime(assignment?.releaseSolutionsAt ?? null)}
          />
        </FieldGroup>
      </FieldSet>
    </FieldGroup>
  );
}
