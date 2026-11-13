import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { apiFetch } from '#lib/api';
import { courseContentQueryOptions } from '#lib/course-content';
import { coursesListQueryOptions } from '#features/course-builder/queries/course-builder';
import { formatDateTime } from '#utils/date-format';
import { courseGroupsQueryOptions } from '#features/progress-report/queries/progress-report';
import { queryKeys } from '#lib/query-keys';
import { queryKeys as examsQueryKeys } from '../queries/keys';
import { useDeployExamPin } from '#features/questions/queries/questions';
import { extractRichTextPlainText, type RichTextDocument } from '@giaokhoa/contracts';
import { systemExamQuestionPreviewQueryOptions, systemExamQuestionsQueryOptions, examQuestionDiscoveryQueryOptions, useCreateExamPaper, useExamPaper, useExamPaperPins, useReplaceExamPaperSlots, useSwapExamPaperSlot, useUpdateExamPaperMeta } from '../queries/exam-paper';
import type { DiscoveryItemLite, PaperView } from '../types/exam-paper';
import { clearQuestionBankListCache } from '#features/questions/queries/questions';
import { withApiReason } from '#features/questions/utils/shared';

interface SlotDraft {
  sourceDomain?: 'centre' | 'bank-system';
  sourceVersionNumber?: number;
  questionId: string;
  questionName: string;
  maxMark: string;
  section: string;
  pinnedVersionNumber: number | null;
  latestReadyVersionNumber: number | null;
  hasNewerVersion: boolean;
  matrixCellId?: string | null;
}

const EXAM_KINDS = ['regular', 'midterm', 'final', 'mock', 'practice'] as const;
const EXAM_KIND_LABEL_KEYS: Record<(typeof EXAM_KINDS)[number], string> = {
  regular: 'examKindRegular',
  midterm: 'examKindMidterm',
  final: 'examKindFinal',
  mock: 'examKindMock',
  practice: 'examKindPractice',
};

const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs';

export function ExamPaperEditorPage({ mode }: { mode: 'new' | 'edit' }) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const { paperId } = useParams();
  const [searchParams] = useSearchParams();
  const bankId = searchParams.get('bank') ?? '';

  const [name, setName] = useState('');
  const [examKind, setExamKind] = useState('');
  const [grade, setGrade] = useState('');
  const [duration, setDuration] = useState('');
  const [totalScore, setTotalScore] = useState('10');
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [swapPosition, setSwapPosition] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const paperQuery = useExamPaper(paperId, mode === 'edit');
  const original = paperQuery.data ?? null;
  const pins = useExamPaperPins(paperId, mode === 'edit').data ?? [];
  const createPaper = useCreateExamPaper();
  const updateMeta = useUpdateExamPaperMeta();
  const replaceSlots = useReplaceExamPaperSlots();
  const swapSlot = useSwapExamPaperSlot();
  const [submittedSearch, setSubmittedSearch] = useState<string | null>(null);
  const discoveryQuery = useQuery({
    ...examQuestionDiscoveryQueryOptions(submittedSearch ?? ''),
    enabled: submittedSearch !== null,
    placeholderData: keepPreviousData,
  });
  const results = discoveryQuery.data ?? [];
  const searched = submittedSearch !== null && !discoveryQuery.isFetching;

  const deployPin = useDeployExamPin();
  const pinRequest = useRef<{ key: string; id: string } | null>(null);
  const [systemPreview, setSystemPreview] = useState<{ id: string; version: number } | null>(null);
  const previewQuery = useQuery({ ...systemExamQuestionPreviewQueryOptions(systemPreview?.id ?? '', systemPreview?.version ?? 1), enabled: !!systemPreview });
  const [showSystem, setShowSystem] = useState(false);
  const [systemOffset, setSystemOffset] = useState(0);
  const [systemVersions, setSystemVersions] = useState<Record<string, number>>({});
  const systemQuestions = useQuery({ ...systemExamQuestionsQueryOptions(systemOffset), enabled: showSystem });
  const canPin = mode === 'edit' && !!original && original.paper.status === 'ready' && original.capabilities.deploy;
  const [pinCourseId, setPinCourseId] = useState('');
  const [pinSectionId, setPinSectionId] = useState('');
  const [pinGroupId, setPinGroupId] = useState('');
  const [pinVariantCount, setPinVariantCount] = useState('1');
  const pinCourses = useQuery({ ...coursesListQueryOptions(), enabled: canPin }).data ?? [];
  const pinContentQuery = useQuery({
    ...courseContentQueryOptions(pinCourseId),
    enabled: canPin && !!pinCourseId,
  });
  const pinSections = pinContentQuery.data?.sections ?? [];
  const pinGroups = useQuery({
    ...courseGroupsQueryOptions(pinCourseId),
    enabled: canPin && !!pinCourseId,
  }).data ?? [];

  const firstPinSectionId = pinContentQuery.data?.sections[0]?.id;
  if (!pinSectionId && firstPinSectionId) {
    setPinSectionId(firstPinSectionId);
  }

  async function runPin() {
    if (!paperId || !original || !pinCourseId || !pinSectionId) return;
    setMessage(null);
    try {
      const requestKey = JSON.stringify([paperId, original.version.id, pinCourseId, pinSectionId, pinGroupId, pinVariantCount]);
      if (pinRequest.current?.key !== requestKey) pinRequest.current = { key: requestKey, id: crypto.randomUUID() };
      await deployPin.mutateAsync({
        courseId: pinCourseId,
        body: {
          requestId: pinRequest.current.id,
          sectionId: pinSectionId,
          examId: paperId,
          variantCount: Math.min(50, Math.max(1, Number(pinVariantCount) || 1)),
          ...(pinGroupId ? { targetGroupId: pinGroupId } : {}),
        },
      });
      pinRequest.current = null;
      setMessage(t('pinOk', { version: original.paper.latestVersion }));
      void queryClient.invalidateQueries({ queryKey: examsQueryKeys.examPaperPins(paperId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.courseBuilder(pinCourseId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.courseContent(pinCourseId) });
    } catch (err) {
      setMessage(withApiReason(t('pinFailed'), err));
    }
  }

  function toSlotDrafts(view: PaperView): SlotDraft[] {
    return view.slots.map((s) => ({
      questionId: s.questionId,
      sourceDomain: s.sourceDomain,
      sourceVersionNumber: s.sourceDomain === 'bank-system' ? s.pinnedVersionNumber ?? undefined : undefined,
      questionName: s.questionName ?? s.questionId,
      maxMark: String(s.maxMark),
      section: s.section,
      pinnedVersionNumber: s.pinnedVersionNumber,
      latestReadyVersionNumber: s.latestReadyVersionNumber,
      hasNewerVersion: s.hasNewerVersion,
      matrixCellId: s.matrixCellId,
    }));
  }

  const loadedPaperIdRef = useRef<string | null>(null);
  useEffect(() => {
    const view = paperQuery.data;
    if (!view) return;
    if (loadedPaperIdRef.current === view.paper.id) return;
    loadedPaperIdRef.current = view.paper.id;
    setName(view.version.name);
    setExamKind(view.version.examKind ?? '');
    setGrade(view.version.grade != null ? String(view.version.grade) : '');
    setDuration(view.version.durationMinutes != null ? String(view.version.durationMinutes) : '');
    setTotalScore(String(view.version.totalScore));
    setSlots(toSlotDrafts(view));
  }, [paperQuery.data]);

  const loadError = paperQuery.isError ? withApiReason(t('examPaperSaveFailed'), paperQuery.error) : null;
  const displayMessage = message ?? loadError;

  async function doSwap(questionId: string) {
    if (!paperId || swapPosition == null) return;
    setMessage(null);
    try {
      const view = await swapSlot.mutateAsync({ paperId, position: swapPosition, questionId });
      setSlots(toSlotDrafts(view));
      setSwapPosition(null);
      setMessage(t('swapOk', { version: view.version.version }));
    } catch (err) {
      setMessage(withApiReason(t('swapFailed'), err));
    }
  }

  async function printVariant(pinId: string, code: string) {
    if (!paperId) return;
    setMessage(null);
    try {
      const response = await apiFetch(`/api/v1/exams/${paperId}/print?pinId=${pinId}&variantCode=${code}`);
      if (!response.ok) throw new Error('print failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank');
    } catch (err) {
      setMessage(withApiReason(t('printFailed'), err));
    }
  }

  function searchQuestions() {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    setSubmittedSearch(params.toString());
  }

  function addQuestion(item: DiscoveryItemLite) {
    setSlots((prev) => (prev.some((s) => s.questionId === item.questionId)
      ? prev
      : [...prev, { questionId: item.questionId, questionName: item.name, maxMark: '1', section: '', pinnedVersionNumber: null, latestReadyVersionNumber: null, hasNewerVersion: false }]));
  }

  function moveSlot(index: number, delta: number) {
    setSlots((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row!);
      return next;
    });
  }

  function slotPayload() {
    return slots.map((s) => ({
      questionId: s.questionId,
      ...(s.sourceDomain === 'bank-system' ? { sourceDomain: s.sourceDomain, sourceVersionNumber: s.sourceVersionNumber } : {}),
      maxMark: Number(s.maxMark) > 0 ? Number(s.maxMark) : 1,
      ...(s.section.trim() ? { section: s.section.trim() } : {}),
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      if (mode === 'new') {
        const created = await createPaper.mutateAsync({
          bankId,
          body: {
            name: name.trim(),
            examKind: examKind || null,
            grade: grade ? Number(grade) : null,
            durationMinutes: duration ? Number(duration) : null,
            totalScore: Number(totalScore) > 0 ? Number(totalScore) : 10,
            slots: slotPayload(),
          },
        });
        setMessage(t('examPaperSaved', { version: created.version.version }));
        clearQuestionBankListCache(queryClient);
        await navigate('/exams');
        return;
      }
      if (!original || !paperId) return;
      const metaChanged =
        name.trim() !== original.version.name ||
        (examKind || null) !== original.version.examKind ||
        (grade ? Number(grade) : null) !== original.version.grade ||
        (duration ? Number(duration) : null) !== original.version.durationMinutes ||
        Number(totalScore) !== original.version.totalScore;
      const slotsChanged = JSON.stringify(slotPayload()) !== JSON.stringify(
        original.slots.map((s) => ({
          questionId: s.questionId,
          ...(s.sourceDomain === 'bank-system' ? { sourceDomain: s.sourceDomain, sourceVersionNumber: s.pinnedVersionNumber ?? undefined } : {}),
          maxMark: s.maxMark, ...(s.section ? { section: s.section } : {}),
        })),
      );
      let view: PaperView = original;
      if (metaChanged) {
        view = await updateMeta.mutateAsync({
          paperId,
          body: {
            name: name.trim(),
            examKind: examKind || null,
            grade: grade ? Number(grade) : null,
            durationMinutes: duration ? Number(duration) : null,
            totalScore: Number(totalScore) > 0 ? Number(totalScore) : 10,
          },
        });
      }
      if (slotsChanged) {
        view = await replaceSlots.mutateAsync({ paperId, slots: slotPayload() });
      }
      setMessage(t('examPaperSaved', { version: view.version.version }));
      clearQuestionBankListCache(queryClient);
      await navigate('/exams');
    } catch (err) {
      setMessage(withApiReason(t('examPaperSaveFailed'), err));
    }
  }

  const orderIntact = !!original && slots.length === original.slots.length
    && slots.every((s, i) => s.questionId === original.slots[i]!.questionId);

  return (
    <PageShell width="full">
      <PageHeader
        title={mode === 'new' ? t('examPaperNew') : t('examPaperEdit')}
        actions={
          <Button type="button" variant="outline" render={<Link to="/exams" />}>
            {t('backToBanks')}
          </Button>
        }
      />
      {displayMessage ? (
        <ErrorAlert>
          {displayMessage}
        </ErrorAlert>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="paper-name">{t('examPaperName')}</FieldLabel>
                <Input id="paper-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field>
                  <FieldLabel htmlFor="paper-kind">{t('examKindLabel')}</FieldLabel>
                  <select id="paper-kind" className={selectClass} value={examKind} onChange={(e) => setExamKind(e.target.value)}>
                    <option value="">—</option>
                    {EXAM_KINDS.map((kind) => (
                      <option key={kind} value={kind}>{t(EXAM_KIND_LABEL_KEYS[kind])}</option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="paper-grade">{t('examGradeLabel')}</FieldLabel>
                  <Input id="paper-grade" type="number" min={1} max={12} value={grade} onChange={(e) => setGrade(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="paper-duration">{t('examDurationLabel')}</FieldLabel>
                  <Input id="paper-duration" type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="paper-score">{t('examTotalScoreLabel')}</FieldLabel>
                  <Input id="paper-score" type="number" min={0} step="0.5" value={totalScore} onChange={(e) => setTotalScore(e.target.value)} />
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('examPaperQuestions')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {slots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('examPaperNoSlots')}</p>
            ) : (
              <ul className="space-y-2">
                {slots.map((slot, index) => (
                  <li key={slot.questionId} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      {index + 1}. {slot.questionName}{slot.sourceDomain === 'bank-system' ? ` · ${t('examSystemPicker')} v${slot.sourceVersionNumber}` : ''}
                      {slot.pinnedVersionNumber != null ? (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">
                          {t('examSlotPinned', { version: slot.pinnedVersionNumber })}
                        </span>
                      ) : null}
                      {slot.hasNewerVersion && slot.latestReadyVersionNumber != null ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                          {t('examSlotHasNewer', { version: slot.latestReadyVersionNumber })}
                        </span>
                      ) : null}
                    </span>
                    <Label className="sr-only" htmlFor={`slot-section-${slot.questionId}`}>{t('examSectionLabel')}</Label>
                    <Input
                      id={`slot-section-${slot.questionId}`}
                      className="w-32"
                      placeholder={t('examSectionLabel')}
                      value={slot.section}
                      onChange={(e) => setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, section: e.target.value } : s)))}
                    />
                    <Label className="sr-only" htmlFor={`slot-mark-${slot.questionId}`}>{t('examSlotMarkLabel')}</Label>
                    <Input
                      id={`slot-mark-${slot.questionId}`}
                      className="w-20"
                      type="number"
                      min={0}
                      step="0.25"
                      value={slot.maxMark}
                      onChange={(e) => setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, maxMark: e.target.value } : s)))}
                    />
                    <Button type="button" variant="outline" onClick={() => moveSlot(index, -1)}>↑</Button>
                    <Button type="button" variant="outline" onClick={() => moveSlot(index, 1)}>↓</Button>
                    {mode === 'edit' && slot.matrixCellId && orderIntact ? (
                      <Button
                        type="button"
                        variant={swapPosition === index + 1 ? 'default' : 'outline'}
                        onClick={() => setSwapPosition(swapPosition === index + 1 ? null : index + 1)}
                      >
                        {t('swapAction')}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSlots((prev) => prev.filter((_, i) => i !== index))}
                    >
                      {t('deleteRow')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-3 border-t pt-4">
              <Label htmlFor="paper-pick">{t('examPickQuestions')}</Label>
              {swapPosition == null && <Button type="button" variant="outline" onClick={() => setShowSystem(!showSystem)}>{t('examSystemPicker')}</Button>}
              {showSystem && swapPosition == null && (
                <div className="space-y-3 rounded-md border p-3">
                  <p>{t('examSystemSnapshotHint')}</p>
                  {systemQuestions.isError && <ErrorAlert>{withApiReason(t('examPaperSaveFailed'), systemQuestions.error)}</ErrorAlert>}
                  {systemQuestions.isFetching && <p>{t('loading')}</p>}
                  {previewQuery.isError && <ErrorAlert>{withApiReason(t('examPaperSaveFailed'), previewQuery.error)}</ErrorAlert>}
                  {previewQuery.data && <p className="rounded-md bg-muted p-3">{extractRichTextPlainText(previewQuery.data.package.questionText as RichTextDocument)}</p>}
                  {(systemQuestions.data?.items ?? []).map((item) => {
                    const version = systemVersions[item.id] ?? item.versions.at(-1)?.version ?? 1;
                    return <div key={item.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1">{t(({ multichoice: 'qtypeMultichoice', truefalse: 'qtypeTruefalse', shortanswer: 'qtypeShortanswer', essay: 'qtypeEssay' } as Record<string, string>)[item.qtype] ?? 'questionType')} · {item.id}</span>
                      <Label className="sr-only" htmlFor={`system-version-${item.id}`}>{t('examSystemVersion')}</Label>
                      <select id={`system-version-${item.id}`} className="rounded-md border p-2" value={version}
                        onChange={(e) => setSystemVersions({ ...systemVersions, [item.id]: Number(e.target.value) })}>
                        {item.versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
                      </select>
                      <Button type="button" variant="outline" onClick={() => setSystemPreview({ id: item.id, version })}>{t('examSystemPreview')}</Button>
                      <Button type="button" variant="outline" disabled={slots.some((s) => s.questionId === item.id)} onClick={() => setSlots([...slots, {
                        questionId: item.id, questionName: `${t('examSystemPicker')} · ${item.id}`,
                        sourceDomain: 'bank-system', sourceVersionNumber: version, maxMark: '1', section: '',
                        pinnedVersionNumber: version, latestReadyVersionNumber: null, hasNewerVersion: false,
                      }])}>{t('examAddQuestion')}</Button>
                    </div>;
                  })}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" disabled={systemOffset === 0} onClick={() => setSystemOffset(Math.max(0, systemOffset - 20))}>{t('examSystemPrevious')}</Button>
                    <Button type="button" variant="outline" disabled={systemOffset + 20 >= (systemQuestions.data?.total ?? 0)} onClick={() => setSystemOffset(systemOffset + 20)}>{t('examSystemNext')}</Button>
                  </div>
                </div>
              )}
              {swapPosition != null ? (
                <p className="text-sm text-muted-foreground">{t('swapPickHint', { position: swapPosition })}</p>
              ) : null}
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  id="paper-pick"
                  className="max-w-sm"
                  placeholder={t('examSearchQuestions')}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <Button type="button" onClick={() => void searchQuestions()}>{t('discoverySearch')}</Button>
              </div>
              {searched && results.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('examNoQuestionsFound')}</p>
              ) : (
                <ul className="space-y-2">
                  {results.map((item) => (
                    <li key={item.questionId} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1">
                        {item.name}
                        <span className="block text-xs text-muted-foreground">{item.bankName}</span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={slots.some((s) => s.questionId === item.questionId)}
                        onClick={() => (swapPosition != null ? void doSwap(item.questionId) : addQuestion(item))}
                      >
                        {swapPosition != null ? t('swapApply') : t('examAddQuestion')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={!name.trim()}>{t('saveAction')}</Button>
      </form>
      {mode === 'edit' && (pins.length > 0 || canPin) ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('examPinsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pins.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {pins.map((pin) => (
                  <li key={pin.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      {pin.courseName} · v{pin.versionNumber} · {formatDateTime(pin.createdAt)} · {t('deploymentVariants', { count: pin.variantCount, codes: pin.variantCodes.join(', ') })}
                    </span>
                    {pin.variantCodes.map((code) => (
                      <Button key={code} type="button" variant="outline" onClick={() => void printVariant(pin.id, code)}>
                        {t('printVariant', { code })}
                      </Button>
                    ))}
                  </li>
                ))}
              </ul>
            ) : null}
            {canPin ? (
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor="pin-course">{t('deployPickCourse')}</Label>
                  <select
                    id="pin-course"
                    className={selectClass}
                    value={pinCourseId}
                    onChange={(e) => {
                      setPinCourseId(e.target.value);
                      setPinSectionId('');
                      setPinGroupId('');
                    }}
                  >
                    <option value="">—</option>
                    {pinCourses.map((c) => (
                      <option key={c.id} value={c.id}>{c.fullName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="pin-section">{t('pinPickSection')}</Label>
                  <select
                    id="pin-section"
                    className={selectClass}
                    value={pinSectionId}
                    onChange={(e) => setPinSectionId(e.target.value)}
                  >
                    <option value="">—</option>
                    {pinSections.map((sec) => (
                      <option key={sec.id} value={sec.id}>{sec.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="pin-group">{t('pinPickGroup')}</Label>
                  <select
                    id="pin-group"
                    className={selectClass}
                    value={pinGroupId}
                    onChange={(e) => setPinGroupId(e.target.value)}
                  >
                    <option value="">{t('pinExamWholeCourse')}</option>
                    {pinGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="pin-variants">{t('deployVariantCount')}</Label>
                  <Input
                    id="pin-variants"
                    type="number"
                    min={1}
                    max={50}
                    className="w-24"
                    value={pinVariantCount}
                    onChange={(e) => setPinVariantCount(e.target.value)}
                  />
                </div>
                <Button type="button" disabled={!pinCourseId || !pinSectionId || deployPin.isPending} onClick={() => void runPin()}>
                  {t('pinExamAction')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}

export function ExamPaperNewPage() {
  return <ExamPaperEditorPage mode="new" />;
}

export function ExamPaperEditPage() {
  return <ExamPaperEditorPage mode="edit" />;
}

export default ExamPaperNewPage;
