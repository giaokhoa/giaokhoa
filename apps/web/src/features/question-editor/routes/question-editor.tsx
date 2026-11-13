import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { QuestionCategory, QuestionView, StimulusView } from '@giaokhoa/contracts';
import { composeMultipleChoiceDocument, splitMultipleChoiceDocument } from '@giaokhoa/editor';
import '@giaokhoa/editor/editor.css';
import 'katex/dist/katex.min.css';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import { FieldGroup } from '@giaokhoa/ui/components/field';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import { AnswersSection } from '../components/answers-section';
import {
  editorFormContent,
  editorFormFromView,
  emptyEditorForm,
  entryStatus,
  type Doc,
  type QuestionEditorFormState,
} from '../types/form-model';
import { GeneralSection } from '../components/general-section';
import { ProgrammeLinks } from '../components/programme-links';
import { StudentPreview, formExcerpt } from '../components/student-preview';
import '#config/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { accessContextsQueryOptions } from '#lib/access';
import {
  curriculumOutcomeQueryOptions,
  curriculumSubjectsScopedQueryOptions,
  curriculumTreeScopedQueryOptions,
  type CurriculumTreeNode as LibCurriculumTreeNode,
} from '#lib/curriculum';
import { curriculaBySubjectQueryOptions } from '#features/matrices/queries/matrix';
import { categoryQuestionsQueryOptions, categoryStimuliQueryOptions, clearQuestionBankListCache, editorQuestionVersionsQueryOptions, questionCategoriesQueryOptions, questionCurriculumLinksQueryOptions, useAttachQuestionOutcome, useAttachQuestionSubject, useCreateQuestion, useDetachQuestionOutcome, useDetachQuestionSubject, useSetQuestionStatus, useUpdateQuestionContent, useUpdateQuestionOutcomeLink } from '#features/questions/queries/questions';
import { QTYPES, hasAllOptions, withApiReason } from '#features/questions/utils/shared';
import type { CurriculumLinksView, Qtype } from '#features/questions/utils/shared';

export { editorFormContent, editorFormFromView, emptyEditorForm, type QuestionEditorFormState };



export function QuestionEditorPage({ mode }: { mode: 'new' | 'edit' }) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const { questionId } = useParams();
  const [searchParams] = useSearchParams();
  const categoryParam = searchParams.get('category') ?? '';
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [categoryId, setCategoryId] = useState(categoryParam);
  const [editing, setEditing] = useState<QuestionView | null>(null);
  const [form, setForm] = useState<QuestionEditorFormState>(() => emptyEditorForm('multichoice'));
  const [stimuli, setStimuli] = useState<StimulusView[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'draft' | 'ready' | null>(null);
  const queryClient = useQueryClient();
  const editOptionsRequestRef = useRef(0);
  const [links, setLinks] = useState<CurriculumLinksView | null>(null);
  const [linkSubjects, setLinkSubjects] = useState<{ id: string; name: string }[]>([]);
  const [linkSubjectPick, setLinkSubjectPick] = useState('');
  const [linkOutcomeOptions, setLinkOutcomeOptions] = useState<{ id: string; label: string }[]>([]);
  const [linkOutcomePick, setLinkOutcomePick] = useState('');
  const [linkLevelPick, setLinkLevelPick] = useState<string>('biet');
  const [outcomeLabels, setOutcomeLabels] = useState<Record<string, string>>({});

  const patchForm = useCallback((patch: Partial<QuestionEditorFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const setStatusMutation = useSetQuestionStatus();
  const updateQuestionMutation = useUpdateQuestionContent();
  const createQuestionMutation = useCreateQuestion();
  const attachSubjectMutation = useAttachQuestionSubject();
  const detachSubjectMutation = useDetachQuestionSubject();
  const attachOutcomeMutation = useAttachQuestionOutcome();
  const updateOutcomeLinkMutation = useUpdateQuestionOutcomeLink();
  const detachOutcomeMutation = useDetachQuestionOutcome();

  const contextId = categories.find((c) => c.id === categoryId)?.contextId;

  const loadStimuli = useCallback(
    async (catId: string) => {
      const rows = await queryClient.fetchQuery(categoryStimuliQueryOptions(catId));
      setStimuli(rows);
    },
    [queryClient],
  );

  const loadCurriculumLinks = useCallback(
    async (qid: string) => {
      try {
        const view = await queryClient.fetchQuery(questionCurriculumLinksQueryOptions(qid));
        setLinks(view);
        const labelEntries = await Promise.all(
          view.outcomes.map(async (o) => {
            try {
              const oc = await queryClient.fetchQuery(curriculumOutcomeQueryOptions(o.outcomeId));
              return [oc.id, oc.content] as const;
            } catch {
              return null;
            }
          }),
        );
        const labels: Record<string, string> = Object.fromEntries(
          labelEntries.filter((entry) => entry !== null),
        );
        if (Object.keys(labels).length > 0) setOutcomeLabels((prev) => ({ ...prev, ...labels }));
      } catch {
        setLinks(null);
      }
    },
    [queryClient],
  );

  const loadLinkSubjects = useCallback(async () => {
    try {
      const contexts = await queryClient.fetchQuery(accessContextsQueryOptions());
      const system = contexts.find((c) => c.contextLevel === 10);
      if (!system) return;
      const rows = await queryClient.fetchQuery(curriculumSubjectsScopedQueryOptions(system.id));
      setLinkSubjects(rows);
    } catch {
    }
  }, [queryClient]);

  const startEdit = useCallback(
    async (view: QuestionView) => {
      const requestId = ++editOptionsRequestRef.current;
      setEditing(view);
      setForm(editorFormFromView(view));
      setLinks(null);
      setLinkSubjectPick('');
      setLinkOutcomePick('');
      setLinkOutcomeOptions([]);
      void loadCurriculumLinks(view.question.id);
      void loadLinkSubjects();

      const qtype = (QTYPES as readonly string[]).includes(view.question.qtype)
        ? (view.question.qtype as Qtype)
        : 'truefalse';
      if (hasAllOptions(qtype, view.options)) return;
      try {
        const versions = await queryClient.fetchQuery(editorQuestionVersionsQueryOptions(view.question.id));
        const latest =
          versions.find((version) => version.id === view.latestVersion.id) ??
          versions.find((version) => version.version === view.entry.latestVersion);
        if (latest?.options && editOptionsRequestRef.current === requestId) {
          setForm(editorFormFromView(view, latest.options));
        }
      } catch {
      }
    },
    [loadCurriculumLinks, loadLinkSubjects, queryClient],
  );

  const initStartedRef = useRef(false);

  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    void (async () => {
      try {
        const cats = await queryClient.fetchQuery(questionCategoriesQueryOptions());
        setCategories(cats);
        let catId = categoryParam;
        if (!catId) {
          if (!cats.length) {
            setLoadError(t('questionBankLoadFailed'));
            return;
          }
          catId = String(cats[0]!.id);
          setCategoryId(catId);
        }
        const [, rows] = await Promise.all([
          loadStimuli(catId).catch(() => setMessage(t('stimulusLoadFailed'))),
          mode === 'edit' && questionId
            ? queryClient.fetchQuery(categoryQuestionsQueryOptions(catId))
            : Promise.resolve(null),
        ]);
        if (mode === 'edit' && questionId) {
          const view = rows?.find((r) => r.question.id === questionId);
          if (!view) {
            setLoadError(t('questionBankLoadFailed'));
            return;
          }
          await startEdit(view);
        }
      } catch {
        setLoadError(t('questionBankLoadFailed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [categoryParam, loadStimuli, mode, queryClient, questionId, startEdit, t]);

  async function applyStatus(id: string, current: string | undefined, target: 'draft' | 'ready') {
    const needsCall =
      current === 'draft' || current === 'ready' ? current !== target : current === undefined && target === 'draft';
    if (!needsCall) return;
    await setStatusMutation.mutateAsync({ questionId: id, status: target });
  }

  async function submitWith(target: 'draft' | 'ready') {
    if (saving) return;
    setMessage(null);
    setSaving(target);
    try {
      const effective = form;
      if (editing) {
        const updated = await updateQuestionMutation.mutateAsync({
          questionId: editing.question.id,
          body: {
            ...editorFormContent(effective),
            stimulusId: form.stimulusId === '' ? null : form.stimulusId,
          },
        });
        await applyStatus(editing.question.id, entryStatus(updated) ?? entryStatus(editing), target);
        clearQuestionBankListCache(queryClient);
        navigate('/questions', {
          state: {
            notice:
              target === 'draft'
                ? t('questionSavedDraft')
                : t('questionSavedAsVersion', { version: updated.entry.latestVersion }),
          },
        });
        return;
      }
      const created = await createQuestionMutation.mutateAsync({
        categoryId,
        qtype: form.qtype,
        ...editorFormContent(effective),
        ...(form.stimulusId ? { stimulusId: form.stimulusId } : {}),
      });
      await applyStatus(created.question.id, entryStatus(created), target);
      navigate('/questions', {
        state: { notice: target === 'draft' ? t('questionSavedDraft') : t('questionCreated') },
      });
    } catch (err) {
      setMessage(withApiReason(editing ? t('questionEditFailed') : t('questionCreateFailed'), err));
    } finally {
      setSaving(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submitWith('ready');
  }

  function handleCategoryChange(v: string | null) {
    if (!v) return;
    setCategoryId(v);
    patchForm({ stimulusId: '' });
    void loadStimuli(v).catch(() => setMessage(t('stimulusLoadFailed')));
  }

  function handleQtypeChange(v: string | null) {
    const qtype = (v ?? 'multichoice') as Qtype;
    setForm((prev) => {
      const next = {
        ...emptyEditorForm(qtype),
        questionText: prev.questionText,
        generalFeedback: prev.generalFeedback,
        guidance: prev.guidance,
        stimulusId: prev.stimulusId,
      };
      if (prev.qtype === 'multichoice' && qtype !== 'multichoice') {
        next.questionText = splitMultipleChoiceDocument(prev.mcDocument).question as Doc;
      }
      if (qtype === 'multichoice' && prev.qtype !== 'multichoice') {
        next.mcDocument = composeMultipleChoiceDocument(prev.questionText, []);
      }
      return next;
    });
  }

  async function pickLinkSubject(subjectId: string) {
    setLinkSubjectPick(subjectId);
    setLinkOutcomePick('');
    setLinkOutcomeOptions([]);
    if (!subjectId) return;
    try {
      const curricula = await queryClient.fetchQuery(curriculaBySubjectQueryOptions(subjectId));
      const options: { id: string; label: string }[] = [];
      const labels: Record<string, string> = {};
      for (const curr of curricula) {
        const tree = await queryClient.fetchQuery(curriculumTreeScopedQueryOptions(curr.id, undefined));
        const walk = (nodes: LibCurriculumTreeNode[]): void => {
          for (const node of nodes) {
            for (const outcome of node.outcomes) {
              options.push({ id: outcome.id, label: `${curr.grade} · ${node.title} · ${outcome.content}` });
              labels[outcome.id] = outcome.content;
            }
            walk(node.children);
          }
        };
        walk(tree.nodes);
      }
      setLinkOutcomeOptions(options);
      if (Object.keys(labels).length > 0) setOutcomeLabels((prev) => ({ ...prev, ...labels }));
    } catch {
      setMessage(t('programmeLoadFailed'));
    }
  }

  async function attachLinkSubject() {
    if (!editing || !linkSubjectPick) return;
    try {
      setLinks(
        await attachSubjectMutation.mutateAsync({ questionId: editing.question.id, subjectId: linkSubjectPick }),
      );
    } catch {
      setMessage(t('programmeSaveFailed'));
    }
  }

  async function detachLinkSubject(subjectId: string) {
    if (!editing) return;
    try {
      setLinks(await detachSubjectMutation.mutateAsync({ questionId: editing.question.id, subjectId }));
    } catch {
      setMessage(t('programmeSaveFailed'));
    }
  }

  async function attachLinkOutcome() {
    if (!editing || !linkOutcomePick) return;
    try {
      setLinks(
        await attachOutcomeMutation.mutateAsync({
          questionId: editing.question.id,
          outcomeId: linkOutcomePick,
          cognitiveLevel: linkLevelPick,
        }),
      );
      setLinkOutcomePick('');
    } catch {
      setMessage(t('programmeSaveFailed'));
    }
  }

  async function changeOutcomeLevel(outcomeId: string, cognitiveLevel: string) {
    if (!editing) return;
    try {
      setLinks(
        await updateOutcomeLinkMutation.mutateAsync({
          questionId: editing.question.id,
          outcomeId,
          cognitiveLevel,
        }),
      );
    } catch {
      setMessage(t('programmeSaveFailed'));
    }
  }

  async function detachLinkOutcome(outcomeId: string) {
    if (!editing) return;
    try {
      setLinks(await detachOutcomeMutation.mutateAsync({ questionId: editing.question.id, outcomeId }));
    } catch {
      setMessage(t('programmeSaveFailed'));
    }
  }

  if (loading) {
    return (
      <PageShell width="full">
        <PageHeader title={mode === 'edit' ? t('editNewVersion') : t('newQuestion')} />
        <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full', 'h-24 w-full']} />
      </PageShell>
    );
  }
  if (loadError) {
    return (
      <PageShell width="full">
        <PageHeader title={mode === 'edit' ? t('editNewVersion') : t('newQuestion')} />
        <ErrorAlert variant="destructive">
          {loadError}
        </ErrorAlert>
        <p>
          <Link to="/questions" className="text-sm underline">
            {t('backToQuestionBankList')}
          </Link>
        </p>
      </PageShell>
    );
  }

  const currentStatus = entryStatus(editing);
  const statusLabel =
    currentStatus === 'draft'
      ? t('questionStatusDraft')
      : currentStatus === 'hidden'
        ? t('questionStatusHidden')
        : t('questionStatusReady');
  const selectedStimulus = stimuli.find((s) => s.id === form.stimulusId) ?? null;

  const moveItem = <T,>(items: T[], index: number, delta: number): T[] => {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return items;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    return next;
  };

  return (
    <PageShell width="full">
      <PageHeader title={mode === 'edit' ? t('editQuestionTitle', { name: formExcerpt(form) }) : t('newQuestion')} />
      <div
        id="editor-toolbar-slot"
        className="sticky top-2 z-30 mb-2 min-h-11 rounded-lg border bg-background shadow-sm empty:hidden"
      />
      <form onSubmit={onSubmit}>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {editing ? statusLabel : t('questionStatusNew')}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                {editing && (
                  <Button type="button" variant="outline" render={<Link to="/questions" />}>
                    {t('cancelEdit')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving !== null}
                  onClick={() => void submitWith('draft')}
                >
                  {t('saveDraft')}
                </Button>
                <Button type="submit" disabled={saving !== null}>
                  {editing ? t('saveNewVersion') : t('createQuestion')}
                </Button>
              </div>
            </div>
            {message ? (
              <ErrorAlert variant="destructive" role="status">
                {message}
              </ErrorAlert>
            ) : null}
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <FieldGroup>
                <GeneralSection
                  form={form}
                  patchForm={patchForm}
                  categories={categories}
                  categoryId={categoryId}
                  editing={editing !== null}
                  stimuli={stimuli}
                  contextId={contextId}
                  itemId={editing?.question.id}
                  onCategoryChange={handleCategoryChange}
                  onQtypeChange={handleQtypeChange}
                />
                <AnswersSection
                  form={form}
                  patchForm={patchForm}
                  contextId={contextId}
                  itemId={editing?.question.id}
                  moveItem={moveItem}
                />
              </FieldGroup>
              <StudentPreview form={form} stimulus={selectedStimulus} />
            </div>
          </CardContent>
        </Card>
      </form>

      {editing && (
        <ProgrammeLinks
          links={links}
          linkSubjects={linkSubjects}
          outcomeLabels={outcomeLabels}
          linkSubjectPick={linkSubjectPick}
          linkOutcomeOptions={linkOutcomeOptions}
          linkOutcomePick={linkOutcomePick}
          linkLevelPick={linkLevelPick}
          pickLinkSubject={pickLinkSubject}
          attachLinkSubject={attachLinkSubject}
          detachLinkSubject={detachLinkSubject}
          attachLinkOutcome={attachLinkOutcome}
          changeOutcomeLevel={changeOutcomeLevel}
          detachLinkOutcome={detachLinkOutcome}
          setLinkOutcomePick={setLinkOutcomePick}
          setLinkLevelPick={setLinkLevelPick}
        />
      )}

      <p>
        <Link to="/questions" className="text-sm underline">
          {t('backToQuestionBankList')}
        </Link>
      </p>
    </PageShell>
  );
}

export function QuestionNewPage() {
  return <QuestionEditorPage mode="new" />;
}

export function QuestionEditPage() {
  return <QuestionEditorPage mode="edit" />;
}

export default QuestionNewPage;
