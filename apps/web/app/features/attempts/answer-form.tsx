import type { AttemptAnswer } from '@giaokhoa/shared/attempts';
import type { StudentAssignment } from '@giaokhoa/shared/assignments';
import { SHORT_ANSWER_MAX_LENGTH } from '@giaokhoa/shared/questions';
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
  FieldLegend,
  FieldSet,
} from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Textarea } from '@giaokhoa/ui/components/textarea';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import { useEffect, useId, useState } from 'react';
import { useFetcher } from 'react-router';
import { parseAnswer, parseQuestionContent, textToDocument } from './attempt-data';
import { RichDocument } from './attempt-ui';

function documentText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('content' in value) || !Array.isArray(value.content))
    return null;
  const lines: string[] = [];
  for (const node of value.content) {
    if (node.type !== 'paragraph' || node.attrs) return null;
    if (node.content?.some((child: { type: string }) => child.type !== 'text')) return null;
    lines.push(node.content?.map((child: { text: string }) => child.text).join('') ?? '');
  }
  return lines.join('\n');
}

function EssayAnswerInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const text = value === undefined ? '' : documentText(value);
  return (
    <Field>
      <FieldLabel htmlFor={id}>Câu trả lời tự luận</FieldLabel>
      <FieldDescription>Nhập câu trả lời bằng văn bản, có thể xuống dòng.</FieldDescription>
      {text === null ? (
        <>
          <RichDocument value={value} />
          <FieldDescription>
            Bản đã lưu có định dạng phong phú. Thay bằng văn bản sẽ thay thế toàn bộ nội dung này.
          </FieldDescription>
          <Button type="button" variant="outline" onClick={() => onChange(textToDocument(''))}>
            Thay bằng văn bản mới
          </Button>
        </>
      ) : (
        <Textarea
          id={id}
          rows={6}
          value={text}
          onChange={(event) => onChange(textToDocument(event.target.value))}
        />
      )}
    </Field>
  );
}

type AnswerDraft = {
  choiceId: string;
  statements: Record<string, boolean | undefined>;
  answer: string;
  essay: unknown;
  parts: Record<string, unknown>;
};

function createAnswerDraft(saved?: AttemptAnswer): AnswerDraft {
  return {
    choiceId: saved?.type === 'multiple_choice' ? saved.choiceId : '',
    statements:
      saved?.type === 'true_false'
        ? Object.fromEntries(saved.answers.map((item) => [item.statementId, item.value]))
        : {},
    answer: saved?.type === 'short_answer' ? saved.answer : '',
    essay: saved?.type === 'essay' && 'answer' in saved ? saved.answer : undefined,
    parts:
      saved?.type === 'essay' && 'answers' in saved
        ? Object.fromEntries(saved.answers.map((part) => [part.partId, part.content]))
        : {},
  };
}

export function AnswerForm({
  item,
  saved,
  onDirty,
  readOnly = false,
}: {
  item: StudentAssignment['questions'][number];
  saved?: AttemptAnswer;
  onDirty: (position: number, dirty: boolean) => void;
  readOnly?: boolean;
}) {
  const fetcher = useFetcher<{ error?: string; success?: string }>();
  const prefix = useId();
  const [draft, setDraft] = useState(() => createAnswerDraft(saved));
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const content = parseQuestionContent(item.question.type, item.question.content);
  const last = content?.content?.at(-1);
  const hasChildren =
    last &&
    (last.type === 'choiceList' || last.type === 'statementList' || last.type === 'partList');
  const children = hasChildren ? last.content : [];
  const stem = content
    ? { type: 'doc', content: hasChildren ? content.content?.slice(0, -1) : content.content }
    : null;
  const ids = children.map((child) => String(child.attrs?.id));
  const candidate =
    item.question.type === 'multiple_choice'
      ? { type: 'multiple_choice', choiceId: draft.choiceId }
      : item.question.type === 'true_false'
        ? {
            type: 'true_false',
            answers: ids.map((statementId) => ({
              statementId,
              value: draft.statements[statementId],
            })),
          }
        : item.question.type === 'short_answer'
          ? { type: 'short_answer', answer: draft.answer }
          : ids.length
            ? {
                type: 'essay',
                answers: ids.map((partId) => ({ partId, content: draft.parts[partId] })),
              }
            : { type: 'essay', answer: draft.essay };
  const parsed = parseAnswer(candidate);
  const draftVersion = JSON.stringify(parsed ?? candidate);
  const savedVersion = JSON.stringify(saved);
  const [previousSavedVersion, setPreviousSavedVersion] = useState(savedVersion);
  if (savedVersion !== previousSavedVersion) {
    setPreviousSavedVersion(savedVersion);
    if (
      !edited ||
      draftVersion === previousSavedVersion ||
      draftVersion === savedVersion ||
      readOnly
    ) {
      setDraft(createAnswerDraft(saved));
      setEdited(false);
    }
  }
  const dirty = edited && draftVersion !== savedVersion;

  useEffect(() => {
    onDirty(item.position, dirty);
    return () => onDirty(item.position, false);
  }, [dirty, item.position, onDirty]);

  function updateDraft(patch: Partial<AnswerDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setEdited(true);
    setError(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Câu {item.position}</CardTitle>
        <CardDescription>
          {saved ? 'Đã có câu trả lời trên máy chủ.' : 'Chưa lưu câu trả lời.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!content ? (
          <p role="alert">Không thể đọc cấu trúc câu hỏi. Vui lòng tải lại đề.</p>
        ) : (
          <fetcher.Form
            method="post"
            onSubmit={(event) => {
              event.preventDefault();
              if (!parsed) {
                setError(
                  'Câu trả lời chưa hợp lệ. Hãy điền đủ nội dung; câu đúng/sai cần chọn đủ bốn mệnh đề.',
                );
                return;
              }
              void fetcher.submit(
                { intent: 'save', position: String(item.position), answer: JSON.stringify(parsed) },
                { method: 'post' },
              );
            }}
          >
            <fieldset disabled={readOnly || fetcher.state !== 'idle'}>
              <FieldGroup>
                {item.question.stimulus && <RichDocument value={item.question.stimulus.content} />}
                <RichDocument value={stem} />
                {item.question.type === 'multiple_choice' && (
                  <FieldSet>
                    <FieldLegend>Chọn một phương án</FieldLegend>
                    <FieldGroup>
                      {children.map((choice, index) => {
                        const id = String(choice.attrs?.id);
                        return (
                          <Field key={id} orientation="horizontal">
                            <input
                              id={`${prefix}-${id}`}
                              name="choiceId"
                              type="radio"
                              value={id}
                              required
                              aria-describedby={`${prefix}-${id}-content`}
                              checked={draft.choiceId === id}
                              onChange={() => updateDraft({ choiceId: id })}
                            />
                            <FieldLabel htmlFor={`${prefix}-${id}`}>
                              {String.fromCharCode(65 + index)}
                            </FieldLabel>
                            <div id={`${prefix}-${id}-content`}>
                              <RichDocument value={{ type: 'doc', content: choice.content }} />
                            </div>
                          </Field>
                        );
                      })}
                    </FieldGroup>
                  </FieldSet>
                )}
                {item.question.type === 'true_false' &&
                  children.map((statement, index) => {
                    const id = String(statement.attrs?.id);
                    return (
                      <FieldSet key={id}>
                        <FieldLegend>Mệnh đề {index + 1}</FieldLegend>
                        <RichDocument value={{ type: 'doc', content: statement.content }} />
                        <FieldGroup>
                          {[true, false].map((value) => (
                            <Field key={String(value)} orientation="horizontal">
                              <input
                                id={`${prefix}-${id}-${value}`}
                                type="radio"
                                name={id}
                                required
                                checked={draft.statements[id] === value}
                                onChange={() =>
                                  updateDraft({ statements: { ...draft.statements, [id]: value } })
                                }
                              />
                              <FieldLabel htmlFor={`${prefix}-${id}-${value}`}>
                                {value ? 'Đúng' : 'Sai'}
                              </FieldLabel>
                            </Field>
                          ))}
                        </FieldGroup>
                      </FieldSet>
                    );
                  })}
                {item.question.type === 'short_answer' && (
                  <Field data-invalid={!!error}>
                    <FieldLabel htmlFor={`${prefix}-answer`}>Câu trả lời ngắn</FieldLabel>
                    <Input
                      id={`${prefix}-answer`}
                      required
                      maxLength={SHORT_ANSWER_MAX_LENGTH}
                      value={draft.answer}
                      aria-invalid={!!error}
                      onChange={(event) => updateDraft({ answer: event.target.value })}
                    />
                    <FieldDescription>
                      Chỉ dùng chữ, số, dấu phẩy, dấu + hoặc - theo quy tắc của đề.
                    </FieldDescription>
                  </Field>
                )}
                {item.question.type === 'essay' &&
                  (ids.length ? (
                    children.map((part, index) => {
                      const id = String(part.attrs?.id);
                      return (
                        <FieldSet key={id}>
                          <FieldLegend>Phần {index + 1}</FieldLegend>
                          <RichDocument value={{ type: 'doc', content: part.content }} />
                          <EssayAnswerInput
                            id={`${prefix}-${id}`}
                            value={draft.parts[id]}
                            onChange={(value) =>
                              updateDraft({ parts: { ...draft.parts, [id]: value } })
                            }
                          />
                        </FieldSet>
                      );
                    })
                  ) : (
                    <EssayAnswerInput
                      id={`${prefix}-essay`}
                      value={draft.essay}
                      onChange={(essay) => updateDraft({ essay })}
                    />
                  ))}
                {(error || fetcher.data?.error) && (
                  <FieldError>{error ?? fetcher.data?.error}</FieldError>
                )}
                <p role="status">
                  {dirty ? 'Có thay đổi chưa lưu.' : saved ? 'Câu trả lời đã lưu.' : ''}
                </p>
                {!readOnly && (
                  <Button type="submit" disabled={!dirty || fetcher.state !== 'idle'}>
                    {fetcher.state !== 'idle' && (
                      <Spinner aria-label="Đang lưu" data-icon="inline-start" />
                    )}
                    {fetcher.state === 'idle' ? 'Lưu câu trả lời' : 'Đang lưu…'}
                  </Button>
                )}
              </FieldGroup>
            </fieldset>
          </fetcher.Form>
        )}
      </CardContent>
    </Card>
  );
}
