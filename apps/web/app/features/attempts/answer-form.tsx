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
import { useEffect, useId, useRef, useState } from 'react';
import { useFetcher, useRevalidator } from 'react-router';
import { parseAnswer, parseQuestionContent, textToDocument } from './attempt-data';
import { RichDocument } from './attempt-ui';
import {
  autosaveDelay,
  clearDraft,
  draftConflicts,
  readDraft,
  shouldClearDraft,
  shouldRestoreDraft,
  writeDraft,
  type AnswerDraft,
} from './draft-storage';

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
  attemptId,
  item,
  saved,
  serverVersion,
  finished,
  onDirty,
  readOnly = false,
}: {
  attemptId: string;
  item: StudentAssignment['questions'][number];
  saved?: AttemptAnswer;
  serverVersion: string | null;
  finished: boolean;
  onDirty: (position: number, dirty: boolean) => void;
  readOnly?: boolean;
}) {
  const fetcher = useFetcher<{ error?: string; success?: string; conflict?: boolean }>();
  const revalidator = useRevalidator();
  const prefix = useId();
  const storageKey = 'giaokhoa:attempt:' + attemptId + ':question:' + item.position;
  const restoredKey = useRef<string | null>(null);
  const baseVersion = useRef(serverVersion);
  const observedVersion = useRef(serverVersion);
  const submittedAnswer = useRef<string | null>(null);
  const handledResponse = useRef(fetcher.data);
  const [conflict, setConflict] = useState(false);
  const [failedAnswer, setFailedAnswer] = useState<string | null>(null);
  const [acknowledgedAnswer, setAcknowledgedAnswer] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [storageError, setStorageError] = useState(false);
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
      finished
    ) {
      setDraft(createAnswerDraft(saved));
      setEdited(false);
    }
  }
  const dirty = edited && draftVersion !== savedVersion && draftVersion !== acknowledgedAnswer;
  const answerToSave = parsed ? JSON.stringify(parsed) : null;

  useEffect(() => {
    if (restoredKey.current === storageKey) return;
    restoredKey.current = storageKey;
    if (shouldRestoreDraft(finished)) {
      const local = readDraft(window, storageKey);
      if (local && JSON.stringify(local.draft) !== JSON.stringify(createAnswerDraft(saved))) {
        baseVersion.current = local.serverVersion === undefined ? '' : local.serverVersion;
        setDraft(local.draft);
        setEdited(true);
        setRestored(true);
        setConflict(draftConflicts(local, serverVersion));
      }
    }
    setHydrated(true);
  }, [finished, saved, serverVersion, storageKey]);

  useEffect(() => {
    if (hydrated && shouldClearDraft(finished, dirty, conflict)) clearDraft(window, storageKey);
  }, [dirty, hydrated, conflict, finished, storageKey]);

  useEffect(() => {
    if (!hydrated || observedVersion.current === serverVersion) return;
    observedVersion.current = serverVersion;
    if (dirty && !conflict && JSON.stringify(saved) !== submittedAnswer.current) {
      setConflict(true);
    } else if (!conflict) {
      baseVersion.current = serverVersion;
      if (dirty) writeDraft(window, storageKey, draft, serverVersion);
    }
  }, [hydrated, serverVersion, saved, dirty, conflict, draft, storageKey]);

  useEffect(() => {
    if (
      fetcher.state !== 'idle' ||
      !fetcher.data ||
      fetcher.data === handledResponse.current ||
      !submittedAnswer.current
    )
      return;
    handledResponse.current = fetcher.data;
    if (fetcher.data.conflict) {
      setConflict(true);
      void revalidator.revalidate();
    } else if (fetcher.data.error) {
      const failed = submittedAnswer.current;
      setFailures((count) => (failedAnswer === failed ? count + 1 : 1));
      setFailedAnswer(failed);
    } else if (fetcher.data.success) {
      setAcknowledgedAnswer(submittedAnswer.current);
      setFailedAnswer(null);
      setFailures(0);
    }
  }, [fetcher.state, fetcher.data, failedAnswer, revalidator]);

  function submitAnswer(answer: string) {
    submittedAnswer.current = answer;
    void fetcher
      .submit(
        {
          intent: 'save',
          position: String(item.position),
          answer,
          expectedAnswer: JSON.stringify(saved ?? null),
        },
        { method: 'post' },
      )
      .catch(() => {
        setFailures((count) => (failedAnswer === answer ? count + 1 : 1));
        setFailedAnswer(answer);
      });
  }

  // Thử lại 3 lần với độ trễ tăng dần; chỉnh sửa mới luôn được phép thử lại.
  useEffect(() => {
    const delay = autosaveDelay(answerToSave, failedAnswer, failures);
    if (!hydrated || readOnly || conflict || !dirty || fetcher.state !== 'idle' || delay === null)
      return;
    const timer = setTimeout(() => submitAnswer(answerToSave!), delay);
    return () => clearTimeout(timer);
  }, [hydrated, readOnly, conflict, dirty, answerToSave, failedAnswer, failures, fetcher.state]);

  // Khi kết nối trở lại, thử tiếp kể cả sau khi hết số lần thử định kỳ.
  useEffect(() => {
    const retry = () => {
      if (failedAnswer) {
        setFailedAnswer(null);
        setFailures(0);
      }
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [failedAnswer]);

  function useServerAnswer() {
    clearDraft(window, storageKey);
    baseVersion.current = serverVersion;
    setDraft(createAnswerDraft(saved));
    setEdited(false);
    setAcknowledgedAnswer(null);
    setConflict(false);
    setRestored(false);
    setFailedAnswer(null);
    setFailures(0);
  }

  function useLocalAnswer() {
    baseVersion.current = serverVersion;
    setConflict(false);
    setAcknowledgedAnswer(null);
    setFailedAnswer(null);
    setFailures(0);
    setStorageError(!writeDraft(window, storageKey, draft, serverVersion));
  }

  useEffect(() => {
    onDirty(item.position, dirty);
    return () => onDirty(item.position, false);
  }, [dirty, item.position, onDirty]);

  function discardDraft() {
    if (!window.confirm('Bỏ phần đang nhập của câu này? Bản đã lưu trên máy chủ vẫn được giữ.'))
      return;
    clearDraft(window, storageKey);
    setDraft(createAnswerDraft(saved));
    setEdited(false);
    setAcknowledgedAnswer(null);
    setConflict(false);
    baseVersion.current = serverVersion;
    setRestored(false);
    setFailedAnswer(null);
    setFailures(0);
    setError(null);
  }

  function updateDraft(patch: Partial<AnswerDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    setEdited(true);
    setError(null);
    setStorageError(!writeDraft(window, storageKey, next, baseVersion.current));
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
              if (conflict) {
                setError('Hãy giải quyết xung đột giữa hai bản trước khi lưu.');
                return;
              }
              if (!parsed) {
                setError(
                  'Câu trả lời chưa hợp lệ. Hãy điền đủ nội dung; câu đúng/sai cần chọn đủ bốn mệnh đề.',
                );
                return;
              }
              submitAnswer(JSON.stringify(parsed));
            }}
          >
            <fieldset disabled={readOnly}>
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
                {conflict && (
                  <div role="alert" className="flex flex-col gap-2">
                    <p>
                      Bản trên máy chủ đã thay đổi kể từ khi tạo nháp này. Để tránh ghi đè bài làm
                      từ thiết bị khác, hệ thống đã dừng tự lưu.
                    </p>
                    {!readOnly && (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={useServerAnswer}>
                          Dùng đáp án trên máy chủ
                        </Button>
                        <Button type="button" variant="outline" onClick={useLocalAnswer}>
                          Giữ nháp này và cho phép ghi đè
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {(error || failedAnswer === answerToSave) && (
                  <FieldError>
                    {error ?? fetcher.data?.error ?? 'Không thể đồng bộ. Hệ thống sẽ thử lại.'}
                  </FieldError>
                )}
                {storageError && (
                  <FieldError>
                    Không thể lưu nháp trên thiết bị này; hãy lưu câu trả lời lên máy chủ.
                  </FieldError>
                )}
                {restored && dirty && (
                  <FieldDescription>
                    Đã khôi phục phần đang nhập từ trình duyệt này.
                  </FieldDescription>
                )}
                <p role="status">
                  {fetcher.state !== 'idle'
                    ? 'Đang đồng bộ câu trả lời…'
                    : conflict
                      ? 'Nháp xung đột với bản trên máy chủ; chưa tự đồng bộ.'
                      : failedAnswer === answerToSave
                        ? failures >= 4
                          ? 'Lưu thất bại sau 3 lần thử lại. Bấm Lưu để thử lại.'
                          : 'Lưu thất bại, đang chờ tự thử lại…'
                        : dirty
                          ? answerToSave
                            ? 'Đã giữ nháp trên thiết bị; chờ tự động lưu lên máy chủ…'
                            : 'Câu chưa hoàn chỉnh; đã giữ nháp trên thiết bị này.'
                          : saved
                            ? 'Đã lưu trên máy chủ.'
                            : 'Chưa trả lời.'}
                </p>
                {!readOnly && dirty && !parsed && (
                  <Button type="button" variant="outline" onClick={discardDraft}>
                    Bỏ nháp câu này để tiếp tục nộp bài
                  </Button>
                )}
                {!readOnly && (
                  <Button type="submit" disabled={conflict || !dirty || fetcher.state !== 'idle'}>
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
