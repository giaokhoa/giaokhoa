import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  extractRichTextPlainText,
  getTrueFalseStatements,
  type RichTextDocument,
} from '@giaokhoa/contracts';
import { RichTextView } from '@giaokhoa/editor';
import 'katex/dist/katex.min.css';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { Spinner } from '@giaokhoa/ui/components/spinner';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { quizAttemptPageClientLoader, useQuizAttempt, useSaveQuizResponse, useSubmitQuizAttempt } from '../queries/quiz';
import type { AttemptQuestion } from '../types/quiz';

function plainText(doc: RichTextDocument | null | undefined): string {
  return doc ? extractRichTextPlainText(doc) : '';
}

function hasRichTextContent(doc: RichTextDocument | null | undefined): boolean {
  if (!doc) return false;
  const visit = (node: { type: string; text?: string; content?: unknown[] }): boolean => {
    if (typeof node.text === 'string' && node.text.trim() !== '') return true;
    if (node.type === 'image' || node.type === 'inlineMath' || node.type === 'blockMath') return true;
    return (node.content ?? []).some((child) =>
      visit(child as { type: string; text?: string; content?: unknown[] }),
    );
  };
  return visit(doc as { type: string; text?: string; content?: unknown[] });
}

function solutionCorrectAnswerId(q: AttemptQuestion): string | null {
  return q.solution && 'correctAnswerId' in q.solution ? q.solution.correctAnswerId : null;
}

function solutionAcceptedAnswers(q: AttemptQuestion): string[] | null {
  return q.solution && 'acceptedAnswers' in q.solution ? q.solution.acceptedAnswers : null;
}

function solutionModelAnswer(q: AttemptQuestion): RichTextDocument | null {
  return q.solution && 'answer' in q.solution ? q.solution.answer : null;
}

function solutionTrueFalseStatements(
  q: AttemptQuestion,
): { statementId: string; value: boolean }[] | null {
  return q.solution && 'statements' in q.solution ? q.solution.statements : null;
}

function parseTrueFalseResponse(value: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function shuffled<T>(items: T[], seedText: string): T[] {
  let seed = 0;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function QuizAttemptPage() {
  const { t } = useTranslation('app');
  const { attemptId } = useParams();
  const attemptQuery = useQuizAttempt(attemptId);
  const view = attemptQuery.data ?? null;
  const error = attemptQuery.isError && !attemptQuery.data ? t('quizAttemptLoadFailed') : null;
  const saveResponseMutation = useSaveQuizResponse();
  const submitMutation = useSubmitQuizAttempt();
  const [actionError, setActionError] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [previousAttemptData, setPreviousAttemptData] = useState<typeof attemptQuery.data>(undefined);
  if (previousAttemptData !== attemptQuery.data) {
    setPreviousAttemptData(attemptQuery.data);
    const fresh = attemptQuery.data;
    if (fresh) {
      setResponses((prev) => {
        const next = { ...prev };
        for (const q of fresh.questions) {
          if (next[q.questionAttemptId] === undefined && q.response !== null) next[q.questionAttemptId] = q.response;
        }
        return next;
      });
    }
  }

  const inProgress = view?.attempt.state === 'inprogress';
  const deadline = useMemo(() => {
    if (!view?.quiz.timeLimitSeconds || !inProgress) return null;
    return new Date(view.attempt.timeStart).getTime() + view.quiz.timeLimitSeconds * 1000;
  }, [view, inProgress]);

  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const remainingSeconds = deadline ? Math.max(0, Math.floor((deadline - nowTick) / 1000)) : null;
  const refetchRef = useRef(attemptQuery.refetch);
  useEffect(() => { refetchRef.current = attemptQuery.refetch; }, [attemptQuery.refetch]);
  useEffect(() => {
    if (remainingSeconds === 0 && inProgress) void refetchRef.current().catch(() => undefined);
  }, [remainingSeconds, inProgress]);

  const pages = useMemo(() => {
    if (!view) return [1];
    return [...new Set(view.questions.map((q) => q.page))].sort((a, b) => a - b);
  }, [view]);
  const currentPage = pages.includes(page) ? page : (pages[0] ?? 1);

  async function act(run: () => Promise<unknown>) {
    setActionError(null);
    setBusy(true);
    try {
      await run();
    } catch {
      setActionError(t('quizAttemptActionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function saveResponse(q: AttemptQuestion) {
    if (!attemptId) return;
    await act(() =>
      saveResponseMutation.mutateAsync({
        attemptId,
        questionAttemptId: q.questionAttemptId,
        response: (responses[q.questionAttemptId] ?? '').trim() ? responses[q.questionAttemptId]! : null,
      }),
    );
  }

  async function submitAll() {
    if (!attemptId) return;
    await act(() => submitMutation.mutateAsync(attemptId));
  }

  if (error)
    return (
      <PageShell width="narrow">
        <ErrorAlert variant="destructive">
          {error}
        </ErrorAlert>
      </PageShell>
    );
  if (!view)
    return (
      <PageShell width="narrow">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t('quizAttemptLoading')}
        </div>
      </PageShell>
    );

  const { quiz, attempt } = view;
  const submitted = attempt.state !== 'inprogress';
  const pageQuestions = view.questions.filter((q) => q.page === currentPage);

  return (
    <PageShell width="narrow">
      <PageHeader
        title={quiz.name}
        description={
          <>
            {t('quizAttemptHeaderLine', { number: attempt.attemptNumber, state: t(`quizAttemptState_${attempt.state}`) })}
            {attempt.preview ? ` (${t('quizPreviewBadge')})` : ''}
          </>
        }
      />
      <Card>
        <CardContent className="space-y-3">
          {remainingSeconds !== null ? (
            <p className="text-sm font-medium" data-testid="quiz-countdown">
              {t('quizTimeRemaining', { minutes: Math.floor(remainingSeconds / 60), seconds: remainingSeconds % 60 })}
            </p>
          ) : null}
          {view.closedDueToTimeLimit ? (
            <ErrorAlert variant="destructive">
              {t('quizClosedByTimeLimit')}
            </ErrorAlert>
          ) : null}
          {submitted ? (
            <div className="text-sm">
              <p>
                {t('quizResultSummary', {
                  sum: attempt.sumGrades ?? 0,
                  total: view.totalMax,
                  grade: attempt.grade ?? 0,
                  max: quiz.grade,
                })}
              </p>
              {attempt.state === 'needsgrading' ? <p>{t('quizWaitingManualGrade', { count: view.pendingManualCount })}</p> : null}
              {view.overallFeedback ? (
                <p className="whitespace-pre-wrap">{t('quizOverallFeedback', { text: view.overallFeedback })}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('quizAttemptInstructions')}</p>
          )}
          {actionError ? (
            <ErrorAlert variant="destructive">
              {actionError}
            </ErrorAlert>
          ) : null}
          {pages.length > 1 ? (
            <div className="flex gap-2">
              {pages.map((p) => (
                <Button key={p} type="button" variant={p === currentPage ? 'default' : 'outline'} size="sm" onClick={() => setPage(p)}>
                  {t('quizPageLabel', { page: p })}
                </Button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {pageQuestions.map((q) => (
        <Card key={q.questionAttemptId} data-testid={`quiz-question-${q.slot}`}>
          <CardHeader>
            <CardTitle className="text-base">{t('quizQuestionLine', { slot: q.slot, max: q.maxMark })}</CardTitle>
            <CardDescription>{q.questionExcerpt}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {q.stimulus ? (
              <div className="rounded-md border p-3">
                <h4 className="text-sm font-medium">{t('stimulusHeading')}</h4>
                <p className="text-sm whitespace-pre-wrap">{plainText(q.stimulus.content)}</p>
              </div>
            ) : null}
            {q.qtype === 'truefalse' ? (
              <RichTextView
                value={
                  {
                    type: 'doc',
                    content: (q.questionText.content ?? []).slice(0, -1),
                  } as RichTextDocument
                }
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{plainText(q.questionText)}</p>
            )}
            {hasRichTextContent(q.guidance) ? (
              <div className="rounded-md border p-3" data-testid={`quiz-guidance-${q.slot}`}>
                <h4 className="text-sm font-medium">{t('guidanceHeading')}</h4>
                <RichTextView value={q.guidance} />
              </div>
            ) : null}
            <QuestionAnswerInput
              q={q}
              quizShuffle={quiz.shuffleAnswers}
              disabled={!inProgress || busy}
              value={responses[q.questionAttemptId] ?? q.response ?? ''}
              onChange={(value) => setResponses((prev) => ({ ...prev, [q.questionAttemptId]: value }))}
              correctAnswerId={submitted ? solutionCorrectAnswerId(q) : null}
              tfSolution={submitted ? solutionTrueFalseStatements(q) : null}
            />
            {inProgress ? (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void saveResponse(q)}>
                {t('quizSaveAnswer')}
              </Button>
            ) : null}
            {submitted ? (
              <div className="text-sm space-y-2">
                <p>
                  {q.state === 'needsgrading'
                    ? t('quizQuestionWaitingGrade')
                    : t('quizQuestionMark', { mark: q.mark ?? 0, max: q.maxMark })}
                </p>
                {q.solution || q.rightAnswer || q.feedback || q.generalFeedback ? (
                  <div className="rounded-md border p-3 space-y-2" data-testid={`quiz-solution-${q.slot}`}>
                    <h4 className="text-sm font-medium">{t('quizSolutionHeading')}</h4>
                    {q.rightAnswer ? <p>{t('quizRightAnswer', { answer: q.rightAnswer })}</p> : null}
                    {solutionAcceptedAnswers(q) ? (
                      <p>{t('quizAcceptedAnswers', { answers: solutionAcceptedAnswers(q)!.join(', ') })}</p>
                    ) : null}
                    {solutionModelAnswer(q) ? (
                      <div>
                        <h5 className="text-sm font-medium">{t('modelAnswerHeading')}</h5>
                        <RichTextView value={solutionModelAnswer(q)} />
                      </div>
                    ) : null}
                    {q.feedback ? (
                      <p className="whitespace-pre-wrap">{t('quizAnswerFeedback', { text: plainText(q.feedback) })}</p>
                    ) : null}
                    {q.generalFeedback ? (
                      <p className="whitespace-pre-wrap">{plainText(q.generalFeedback)}</p>
                    ) : null}
                  </div>
                ) : null}
                {q.manualComment ? (
                  <p className="whitespace-pre-wrap">{t('quizManualComment', { text: q.manualComment })}</p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}

      {inProgress ? (
        <div>
          <Button type="button" disabled={busy} onClick={() => void submitAll()}>
            {t('quizSubmitAttempt')}
          </Button>
        </div>
      ) : null}
      <p className="text-sm">
        <Link to={`/courses/${quiz.courseId}/exams/${quiz.id}`}>{t('quizBackToQuiz')}</Link>
      </p>
    </PageShell>
  );
}

function QuestionAnswerInput(props: {
  q: AttemptQuestion;
  quizShuffle: boolean;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  correctAnswerId: string | null;
  tfSolution: { statementId: string; value: boolean }[] | null;
}) {
  const { t } = useTranslation('app');
  const { q, disabled, value, onChange, correctAnswerId, tfSolution } = props;
  const optionShuffle = q.options?.shuffleAnswers === true;
  const answers = useMemo(
    () => (props.quizShuffle || optionShuffle ? shuffled(q.answers, q.questionAttemptId) : q.answers),
    [props.quizShuffle, optionShuffle, q.answers, q.questionAttemptId],
  );

  if (q.qtype === 'multichoice') {
    return (
      <div className="space-y-2">
        {answers.map((a) => {
          const label = plainText(a.text);
          const isCorrect = correctAnswerId !== null && correctAnswerId === a.id;
          return (
            <label
              key={a.id}
              className="flex items-center gap-2 text-sm"
              data-correct={isCorrect ? 'true' : undefined}
            >
              <input
                type="radio"
                name={`q-${q.questionAttemptId}`}
                checked={value === a.id}
                disabled={disabled}
                onChange={() => onChange(a.id)}
              />
              {label}
              {isCorrect ? (
                <span className="text-xs font-medium text-emerald-700">{t('quizCorrectAnswerBadge')}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    );
  }
  if (q.qtype === 'truefalse') {
    const statements = getTrueFalseStatements(q.questionText) ?? [];
    const chosen = parseTrueFalseResponse(value);
    const correctById = new Map((tfSolution ?? []).map((s) => [s.statementId, s.value]));
    return (
      <div className="space-y-3">
        {statements.map((statement, index) => {
          const correct = correctById.get(statement.id);
          const picked = chosen[statement.id];
          const verdict =
            correct === undefined
              ? undefined
              : picked === undefined
                ? 'unanswered'
                : picked === correct
                  ? 'correct'
                  : 'incorrect';
          return (
            <div
              key={statement.id}
              className="space-y-1"
              data-testid={`quiz-tf-statement-${q.slot}-${index}`}
              data-verdict={verdict}
            >
              <div className="flex items-start gap-2 text-sm">
                <span className="font-medium">{`${'abcd'[index] ?? index + 1})`}</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{statement.text}</span>
              </div>
              <div className="flex gap-4">
                {([true, false] as const).map((side) => {
                  const isCorrectSide = correct !== undefined && correct === side;
                  return (
                    <label
                      key={String(side)}
                      className="flex items-center gap-2 text-sm"
                      data-correct={isCorrectSide ? 'true' : undefined}
                    >
                      <input
                        type="radio"
                        name={`q-${q.questionAttemptId}-${statement.id}`}
                        checked={picked === side}
                        disabled={disabled}
                        onChange={() =>
                          onChange(JSON.stringify({ ...chosen, [statement.id]: side }))
                        }
                      />
                      {side ? t('quizTrueLabel') : t('quizFalseLabel')}
                      {isCorrectSide ? (
                        <span className="text-xs font-medium text-emerald-700">
                          {t('quizCorrectAnswerBadge')}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  if (q.qtype === 'essay') {
    return (
      <div className="space-y-2">
        <Label htmlFor={`answer-${q.questionAttemptId}`}>{t('quizEssayLabel')}</Label>
        <textarea
          id={`answer-${q.questionAttemptId}`}
          className="w-full rounded-md border p-2 text-sm"
          rows={Number(q.options?.responseFieldLines ?? 10)}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Label htmlFor={`answer-${q.questionAttemptId}`}>{t('quizShortAnswerLabel')}</Label>
      <Input
        id={`answer-${q.questionAttemptId}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function QuizAttemptRoute() {
  return <QuizAttemptPage />;
}

export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.attemptId) {
    await quizAttemptPageClientLoader(params.attemptId);
  }
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Làm bài kiểm tra');
}
