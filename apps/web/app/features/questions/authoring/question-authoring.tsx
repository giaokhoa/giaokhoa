import { filesContract } from '@giaokhoa/shared/http/files';
import type { FileRef } from '@giaokhoa/shared/files';
import {
  collectFileRefs,
  questionCreateSchema,
  type Question,
  type QuestionCreate,
  type QuestionStatus,
  type QuestionType,
} from '@giaokhoa/shared/questions';
import { hasTextContent, type UploadImage } from '@giaokhoa/editor';
import {
  discardFiles,
  loadOriginalImage,
  loadTikzSource,
  uploadImage,
} from '#features/files/api/files.client.js';
import { Button } from '@giaokhoa/ui/components/button';
import { Tabs, TabsList, TabsTrigger } from '@giaokhoa/ui/components/tabs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useFetcher } from 'react-router';
import { renderTikz } from '#lib/tikz-renderer.js';
import { AuthoringPane } from './authoring-pane';
import {
  createQuestionDraft,
  getDraftFingerprint,
  getDraftSolution,
  hasDraftData,
  isDraftComplete,
  type QuestionDraft,
} from './draft-state';
import { PreviewPane } from './preview-pane';

const DISCARD_BATCH_SIZE = 100;

const QUESTION_TYPES: Array<{ value: QuestionType; label: string }> = [
  { value: 'multiple_choice', label: 'Nhiều lựa chọn' },
  { value: 'true_false', label: 'Đúng / Sai' },
  { value: 'short_answer', label: 'Trả lời ngắn' },
  { value: 'essay', label: 'Tự luận' },
];

type PendingUploadEntry = [string, FileRef];

type SaveQuestionActionData = { question: Question } | { error: string; status?: number };

type SaveRequest = {
  requestFingerprint: string;
  payload?: QuestionCreate;
  pendingUploads: PendingUploadEntry[];
  leaveAfterSave: boolean;
};

function isFileRefUsed(ref: FileRef, usedRefs: FileRef[]): boolean {
  return usedRefs.some(
    (used) =>
      used.fileId === ref.fileId &&
      (ref.variantFileId === null || used.variantFileId === ref.variantFileId),
  );
}

export function QuestionAuthoring({
  initialDraft,
  initialQuestion,
}: {
  initialDraft: QuestionDraft;
  initialQuestion?: Question;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(() => initialDraft);
  const [savedDraftFingerprint, setSavedDraftFingerprint] = useState(() =>
    getDraftFingerprint(initialDraft),
  );
  const [questionId, setQuestionId] = useState<string | undefined>(initialQuestion?.id);
  const [persistedStatus, setPersistedStatus] = useState<QuestionStatus | undefined>(
    initialQuestion?.status,
  );
  const [persistedVersion, setPersistedVersion] = useState<number | undefined>(
    initialQuestion?.version,
  );
  const [savingStatus, setSavingStatus] = useState<QuestionStatus>();
  const [pendingUploadCount, setPendingUploadCount] = useState(0);
  const [pendingTypeChange, setPendingTypeChange] = useState<QuestionType>();
  const [changingType, setChangingType] = useState(false);
  const [leavingAction, setLeavingAction] = useState<'draft' | 'discard'>();
  const [error, setError] = useState<string>();
  const saveFetcher = useFetcher<SaveQuestionActionData>();

  const draftRef = useRef(draft);
  const savingRef = useRef(false);
  const saveRequestRef = useRef<SaveRequest | undefined>(undefined);
  const pendingUploadsRef = useRef(new Map<string, FileRef>());

  const draftFingerprint = getDraftFingerprint(draft);
  const hasDraftContent = hasDraftData(draft);
  const dirty =
    draftFingerprint !== savedDraftFingerprint && (Boolean(questionId) || hasDraftContent);
  const hasAnyData = hasDraftContent || pendingUploadCount > 0;
  const complete = isDraftComplete(draft);
  const shouldWarnOnExit = dirty || pendingUploadCount > 0;
  const blocker = useBlocker(shouldWarnOnExit);

  const clearError = useCallback(() => setError(undefined), []);

  const changeDraft = useCallback(
    (update: (draft: QuestionDraft) => QuestionDraft) => {
      const currentDraft = draftRef.current;
      const nextDraft = update(currentDraft);
      if (nextDraft.type !== currentDraft.type || nextDraft === currentDraft) return;

      draftRef.current = nextDraft;
      setDraft(nextDraft);
      clearError();
    },
    [clearError],
  );

  const uploadQuestionImage = useCallback<UploadImage>(async (...args) => {
    const uploaded = await uploadImage(...args);
    const key = `${uploaded.fileId}:${uploaded.variantFileId ?? ''}`;
    pendingUploadsRef.current.set(key, {
      fileId: uploaded.fileId,
      variantFileId: uploaded.variantFileId,
    });
    setPendingUploadCount(pendingUploadsRef.current.size);
    return uploaded;
  }, []);

  const discardPendingUploads = useCallback(
    async (pending: PendingUploadEntry[] = [...pendingUploadsRef.current.entries()]) => {
      if (!pending.length) return true;

      try {
        for (let offset = 0; offset < pending.length; offset += DISCARD_BATCH_SIZE) {
          const batch = pending.slice(offset, offset + DISCARD_BATCH_SIZE);
          await discardFiles(batch.map(([, ref]) => ref));

          for (const [key] of batch) pendingUploadsRef.current.delete(key);
          setPendingUploadCount(pendingUploadsRef.current.size);
        }
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!shouldWarnOnExit) return;
        event.preventDefault();
        event.returnValue = '';
      },
      [shouldWarnOnExit],
    ),
  );

  useEffect(() => {
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted || !shouldWarnOnExit || savingRef.current) return;
      const files = [...pendingUploadsRef.current.values()];
      if (!files.length) return;

      for (let offset = 0; offset < files.length; offset += DISCARD_BATCH_SIZE) {
        const body = filesContract.discard.body.parse({
          files: files.slice(offset, offset + DISCARD_BATCH_SIZE),
        });
        void fetch(filesContract.discard.path, {
          method: filesContract.discard.method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        });
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [shouldWarnOnExit]);

  const switchToType = (nextType: QuestionType) => {
    const nextDraft = createQuestionDraft(nextType);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    if (!questionId) setSavedDraftFingerprint(getDraftFingerprint(nextDraft));
    clearError();
  };

  const requestTypeChange = (nextType: QuestionType) => {
    const currentDraft = draftRef.current;
    if (savingRef.current || nextType === currentDraft.type) return;

    if (hasDraftData(currentDraft) || pendingUploadCount > 0) {
      setPendingTypeChange(nextType);
      return;
    }

    switchToType(nextType);
  };

  const discardAndChangeType = async () => {
    if (!pendingTypeChange || changingType) return;

    setChangingType(true);
    setError(undefined);
    if (!(await discardPendingUploads())) {
      setError('Không thể dọn ảnh chưa lưu. Vui lòng thử lại.');
      setChangingType(false);
      return;
    }

    switchToType(pendingTypeChange);
    setPendingTypeChange(undefined);
    setChangingType(false);
  };

  const saveQuestion = (targetStatus: QuestionStatus, leaveAfterSave = false): boolean => {
    const requestDraft = draftRef.current;
    if (savingRef.current || (targetStatus === 'ready' && !isDraftComplete(requestDraft))) {
      return false;
    }

    const persistedQuestionId = questionId;
    const requestFingerprint = getDraftFingerprint(requestDraft);
    const shouldSaveContent = !persistedQuestionId || requestFingerprint !== savedDraftFingerprint;
    if (!shouldSaveContent && persistedStatus === targetStatus) return false;
    if (persistedQuestionId && !persistedVersion) {
      setError('Không xác định được phiên bản câu hỏi. Hãy tải lại trang.');
      return false;
    }

    let payload: QuestionCreate | undefined;
    if (shouldSaveContent) {
      const guidancePayload = hasTextContent(requestDraft.guidance)
        ? requestDraft.guidance
        : persistedQuestionId
          ? null
          : undefined;
      const payloadResult = questionCreateSchema.safeParse({
        status: targetStatus,
        type: requestDraft.type,
        content: requestDraft.content,
        ...(guidancePayload !== undefined ? { guidance: guidancePayload } : {}),
        solution: getDraftSolution(requestDraft),
      });
      if (!payloadResult.success) {
        setError(payloadResult.error.issues.map(({ message }) => message).join('; '));
        return false;
      }
      payload = payloadResult.data;
    }

    savingRef.current = true;
    saveRequestRef.current = {
      requestFingerprint,
      payload,
      pendingUploads: payload ? [...pendingUploadsRef.current.entries()] : [],
      leaveAfterSave,
    };
    setSavingStatus(targetStatus);
    setError(undefined);

    void saveFetcher.submit(
      {
        ...(persistedQuestionId ? { questionId: persistedQuestionId } : {}),
        question: persistedQuestionId
          ? { expectedVersion: persistedVersion!, ...(payload ?? { status: targetStatus }) }
          : payload!,
      },
      { method: 'POST', encType: 'application/json', defaultShouldRevalidate: false },
    );
    return true;
  };

  useEffect(() => {
    const data = saveFetcher.data;
    if (saveFetcher.state !== 'idle' || !data) return;

    const request = saveRequestRef.current;
    if (!request) return;
    saveRequestRef.current = undefined;

    const finishSave = async () => {
      try {
        if ('error' in data) {
          setError(
            data.status === 409
              ? 'Câu hỏi đã có thay đổi từ phiên làm việc khác. Hãy sao lưu nội dung đang soạn rồi tải lại trang để lấy phiên bản mới nhất.'
              : data.error,
          );
          return;
        }

        setQuestionId(data.question.id);
        setPersistedStatus(data.question.status);
        setPersistedVersion(data.question.version);
        setSavedDraftFingerprint(request.requestFingerprint);

        if (request.payload) {
          const persistedFileRefs = collectFileRefs(request.payload);
          const currentFileRefs = collectFileRefs(draftRef.current);
          const cleanupCandidates = request.pendingUploads.filter(
            ([, ref]) =>
              isFileRefUsed(ref, persistedFileRefs) || !isFileRefUsed(ref, currentFileRefs),
          );
          if (!(await discardPendingUploads(cleanupCandidates))) {
            setError('Đã lưu câu hỏi nhưng chưa dọn được ảnh không còn sử dụng.');
          }
        }
      } finally {
        savingRef.current = false;
        setSavingStatus(undefined);
        if (request.leaveAfterSave) setLeavingAction(undefined);
      }

      if (
        request.leaveAfterSave &&
        blocker.state === 'blocked' &&
        getDraftFingerprint(draftRef.current) === request.requestFingerprint
      ) {
        blocker.proceed();
      }
    };

    void finishSave();
  }, [blocker, discardPendingUploads, saveFetcher.data, saveFetcher.state]);

  const saveDraftAndLeave = () => {
    setLeavingAction('draft');
    if (!saveQuestion('draft', true)) setLeavingAction(undefined);
  };

  const discardAndLeave = async () => {
    setLeavingAction('discard');
    setError(undefined);
    if (await discardPendingUploads()) {
      if (blocker.state === 'blocked') blocker.proceed();
      return;
    }
    setError('Không thể dọn ảnh chưa lưu. Vui lòng thử lại.');
    setLeavingAction(undefined);
  };

  const statusLabel = questionId
    ? persistedStatus === 'ready'
      ? 'Sẵn sàng'
      : 'Bản nháp'
    : 'Chưa lưu';
  const canSaveContent = dirty && (Boolean(questionId) || hasAnyData);
  const canSaveDraft =
    !savingStatus &&
    (canSaveContent || (!dirty && persistedStatus === 'ready' && pendingUploadCount === 0));
  const canSaveReady =
    complete &&
    !savingStatus &&
    (canSaveContent || (!dirty && persistedStatus === 'draft' && pendingUploadCount === 0));

  return (
    <div className="flex-1 bg-muted/30 px-4 py-8 md:px-8">
      <div className="container mx-auto">
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">
                {questionId ? 'Chỉnh sửa câu hỏi' : 'Thêm câu hỏi'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground" role="status">
                Trạng thái: {statusLabel}
                {persistedVersion ? ` · Phiên bản ${persistedVersion}` : ''}
                {dirty ? ' · Có thay đổi chưa lưu' : ''}
              </p>
              {questionId && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {dirty
                    ? 'Lưu nội dung sẽ tạo phiên bản mới. Bạn có thể chọn bản nháp hoặc sẵn sàng.'
                    : 'Đổi trạng thái không tạo phiên bản mới.'}
                </p>
              )}
              {questionId && (
                <Link
                  to={`/questions/${questionId}`}
                  className="mt-1 inline-block text-sm text-primary underline-offset-4 hover:underline"
                >
                  Đường dẫn câu hỏi
                </Link>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canSaveDraft}
                onClick={() => void saveQuestion('draft')}
              >
                {savingStatus === 'draft'
                  ? 'Đang lưu…'
                  : !dirty && persistedStatus === 'ready'
                    ? 'Chuyển về bản nháp'
                    : 'Lưu bản nháp'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!canSaveReady}
                onClick={() => void saveQuestion('ready')}
              >
                {savingStatus === 'ready'
                  ? 'Đang lưu…'
                  : !dirty && persistedStatus === 'draft'
                    ? 'Đánh dấu sẵn sàng'
                    : 'Lưu & sẵn sàng'}
              </Button>
            </div>
          </div>
          <Tabs
            value={draft.type}
            onValueChange={(value) => requestTypeChange(value as QuestionType)}
            className="mt-4 max-w-2xl"
          >
            <TabsList aria-label="Loại câu hỏi" className="w-full">
              {QUESTION_TYPES.map((item) => (
                <TabsTrigger key={item.value} value={item.value} disabled={Boolean(savingStatus)}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {error && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <AuthoringPane
            draft={draft}
            onChange={changeDraft}
            uploadImage={uploadQuestionImage}
            loadOriginalImage={loadOriginalImage}
            loadTikzSource={loadTikzSource}
            renderTikz={renderTikz}
          />
          <PreviewPane key={draft.type} draft={draft} />
        </div>
      </div>

      {pendingTypeChange && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-question-type-title"
            className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-xl"
          >
            <h2 id="change-question-type-title" className="text-lg font-semibold">
              Đổi loại câu hỏi?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Nội dung đang soạn sẽ không được giữ lại khi đổi loại câu hỏi.
            </p>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={changingType}
                onClick={() => {
                  setPendingTypeChange(undefined);
                  setError(undefined);
                }}
              >
                Ở lại
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={changingType}
                onClick={() => void discardAndChangeType()}
              >
                {changingType ? 'Đang đổi…' : 'Đổi loại'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-question-title"
            className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-xl"
          >
            <h2 id="unsaved-question-title" className="text-lg font-semibold">
              Bạn có thay đổi chưa lưu
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Bạn có thể lưu thành bản nháp, huỷ các thay đổi chưa lưu hoặc ở lại tiếp tục soạn.
            </p>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(leavingAction)}
                onClick={() => {
                  blocker.reset();
                  setLeavingAction(undefined);
                }}
              >
                Ở lại
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={Boolean(leavingAction)}
                onClick={() => void discardAndLeave()}
              >
                {leavingAction === 'discard' ? 'Đang dọn…' : 'Huỷ thay đổi & thoát'}
              </Button>
              <Button
                type="button"
                disabled={Boolean(leavingAction) || !canSaveDraft}
                onClick={saveDraftAndLeave}
              >
                {leavingAction === 'draft' ? 'Đang lưu…' : 'Lưu bản nháp & thoát'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
