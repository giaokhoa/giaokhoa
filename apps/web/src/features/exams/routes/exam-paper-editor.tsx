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
import { formatDateTime } from '#utils/date-format';
import { queryKeys } from '#lib/query-keys';
import { queryKeys as examsQueryKeys } from '../queries/keys';
import { DeployPinForm } from '#features/questions/components/deploy-pin-form';
import { examQuestionDiscoveryQueryOptions, useCreateExamPaper, useExamPaper, useExamPaperPins, useReplaceExamPaperSlots, useSwapExamPaperSlot, useUpdateExamPaperMeta } from '../queries/exam-paper';
import type { DiscoveryItemLite, PaperView } from '../types/exam-paper';
import { clearQuestionBankListCache } from '#features/questions/queries/questions';
import { withApiReason } from '#features/questions/utils/shared';

/** Slot đang soạn trong form (chưa ghim — server ghim bản ready mới nhất khi lưu). */
interface SlotDraft {
  questionId: string;
  questionName: string;
  maxMark: string;
  section: string;
  pinnedVersionNumber: number | null;
  /** Số version ready mới nhất của câu + cờ có bản mới (chỉ để hiện huy hiệu, không gửi lên khi lưu). */
  latestReadyVersionNumber: number | null;
  hasNewerVersion: boolean;
  /** Ô ma trận nguồn (EB-2): slot có trường này thì đổi câu bằng swap-cùng-ô. */
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

/** Tổng điểm mặc định của đề mới (thang 10); cũng là giá trị dự phòng khi ô tổng điểm trống/không hợp lệ lúc lưu. */
const DEFAULT_TOTAL_SCORE = 10;

/** Thời gian giữ blob URL của tab in trước khi thu hồi (tab in cần kịp tải xong blob; thu hồi ngay sẽ hỏng bản in). */
const PRINT_OBJECT_URL_REVOKE_DELAY_MS = 60_000;

/**
 * Màn soạn đề RIÊNG theo chuẩn §9 (EB-1, issue #113): tạo mới /exams/new?bank=<bankId>, sửa /exams/:paperId/edit. Soạn tự do: metadata + chọn câu từ ngân hàng câu hỏi (khám phá theo từ khoá) → thứ tự/phần/điểm từng câu → lưu. Lưu sửa tạo paper version mới phía server (metadata qua PATCH, slots qua PUT — chỉ gọi phần thật sự đổi); server ghim bản ready mới nhất của mỗi câu. Ở chế độ sửa, thẻ các lần ghim còn cho ghim đề vào khoá ngay tại chỗ (đề `ready` + cờ `capabilities.deploy`): cùng thao tác exam-pins, cùng cổng quyền với hộp ghim của panel "Đề của tôi" ở trang ngân hàng — luồng soạn → soát → giao liền một mạch, trạng thái lần ghim hiển thị đọc từ cùng nguồn `GET /exams/:id/pins`.
 */
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
  const [totalScore, setTotalScore] = useState(String(DEFAULT_TOTAL_SCORE));
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  /** Vị trí slot đang ở chế độ đổi câu cùng ô (EB-2); null = chế độ thêm câu thường. */
  const [swapPosition, setSwapPosition] = useState<number | null>(null);

  // Dữ liệu trang qua TanStack Query (F-01 của #133, `lib/exam-paper-data.ts`): chi tiết đề là query chính ở chế độ sửa (clientLoader của route sửa nạp trước cùng khoá), các lần ghim là query phụ; tìm câu để thêm/đổi là query theo tham số đã chốt khi bấm tìm, giữ kết quả lần trước trong lúc tải lần mới như bản thủ công.
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

  // --- Ghim đề vào khoá ngay tại màn sửa -------------------------------------
  //
  // Form ghim chỉ mở khi đề đã `ready` và người xem có cờ deploy tại bank của đề — đúng điều kiện hiện nút ghim của panel "Đề của tôi" ở trang ngân hàng. Form ghim dùng chung component `DeployPinForm` với hộp ghim của panel đó (cùng state/query/đột biến ghim, không có đường ghim thứ hai); khác nhau chỉ ở việc sau ghim: màn sửa làm mới danh sách lần ghim + gói dựng của khoá đích, panel đóng hộp + điều hướng.
  const canPin = mode === 'edit' && !!original && original.paper.status === 'ready' && original.capabilities.deploy;

  /** Ánh xạ slots của view đề thành slots nháp của form. */
  function toSlotDrafts(view: PaperView): SlotDraft[] {
    return view.slots.map((s) => ({
      questionId: s.questionId,
      questionName: s.questionName ?? s.questionId,
      maxMark: String(s.maxMark),
      section: s.section,
      pinnedVersionNumber: s.pinnedVersionNumber,
      latestReadyVersionNumber: s.latestReadyVersionNumber,
      hasNewerVersion: s.hasNewerVersion,
      matrixCellId: s.matrixCellId,
    }));
  }

  // Khởi tạo toàn bộ form từ view đề khi MỞ một đề (đề khác với đề đang soạn) — đúng nhịp loadPaper thủ công; các lần view đổi vì đổi câu cùng ô không qua đây (doSwap tự đồng bộ slots) để không đè lên metadata người dùng đang sửa dở.
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

  // Lỗi nạp chi tiết đề suy ngay khi render từ trạng thái query — không chép qua effect vào state như bản cũ (cùng khuôn pages/questions.tsx): banner hiện thông báo của thao tác nếu có, không thì lỗi nạp kèm lý do API trả.
  const loadError = paperQuery.isError ? withApiReason(t('examPaperSaveFailed'), paperQuery.error) : null;
  const displayMessage = message ?? loadError;

  /** Đổi câu của slot đang chọn sang câu khác CÙNG Ô (server gác pool của ô nguồn). */
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

  /** In đề theo một lần ghim + mã đề: tải HTML kèm token rồi mở tab in. */
  async function printVariant(pinId: string, code: string) {
    if (!paperId) return;
    setMessage(null);
    try {
      const response = await apiFetch(`/api/v1/exams/${paperId}/print?pinId=${pinId}&variantCode=${code}`);
      if (!response.ok) throw new Error('print failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank');
      // Thu hồi blob URL sau khi tab in kịp tải (không thu hồi ngay như
      // đường tải file — tab mới mở chưa kịp đọc blob sẽ in trắng).
      setTimeout(() => URL.revokeObjectURL(objectUrl), PRINT_OBJECT_URL_REVOKE_DELAY_MS);
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
            totalScore: Number(totalScore) > 0 ? Number(totalScore) : DEFAULT_TOTAL_SCORE,
            slots: slotPayload(),
          },
        });
        setMessage(t('examPaperSaved', { version: created.version.version }));
        // Điểm lưu: xoá cache danh sách ngân hàng để danh sách đề mở
        // lại là nạp tươi, như màn soạn câu hỏi (tiền lệ F-01 đợt 1).
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
          questionId: s.questionId, maxMark: s.maxMark, ...(s.section ? { section: s.section } : {}),
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
            totalScore: Number(totalScore) > 0 ? Number(totalScore) : DEFAULT_TOTAL_SCORE,
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

  /** Thứ tự slot nháp còn khớp bản đã lưu thì mới ánh xạ được vị trí cho swap-cùng-ô. */
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
                      {index + 1}. {slot.questionName}
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
      {/* Thẻ các lần ghim (chế độ sửa): danh sách đọc từ cùng nguồn
          phía khoá đọc; form ghim hiện khi đề ready + có cờ deploy —
          thẻ hiện cả khi chưa có lần ghim nào nếu người dùng được
          ghim, để bước giao bài làm được ngay tại màn soạn. */}
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
            {canPin && original && paperId ? (
              <DeployPinForm
                examId={paperId}
                examVersion={original.paper.latestVersion}
                enabled={canPin}
                idPrefix="pin"
                setMessage={setMessage}
                onDeployed={({ courseId }) => {
                  // Làm mới danh sách lần ghim của đề từ cùng nguồn dữ kiện phía khoá đọc để lần ghim mới hiện ngay tại chỗ, và làm mới gói dựng khoá + nội dung của khoá đích.
                  void queryClient.invalidateQueries({ queryKey: examsQueryKeys.examPaperPins(paperId) });
                  void queryClient.invalidateQueries({ queryKey: queryKeys.courseBuilder(courseId) });
                  void queryClient.invalidateQueries({ queryKey: queryKeys.courseContent(courseId) });
                }}
              />
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
