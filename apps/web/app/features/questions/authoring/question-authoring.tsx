import { imagesContract } from '@giaokhoa/shared/http/images';
import type { ImageRef } from '@giaokhoa/shared/images';
import {
  collectImageRefs,
  questionCreateSchema,
  type Question,
  type QuestionCreate,
  type QuestionStatus,
  type QuestionType,
} from '@giaokhoa/shared/questions';
import { hasTextContent, type UploadImage } from '@giaokhoa/editor';
import {
  discardImages,
  loadOriginalImage,
  loadTikzSource,
  uploadImage,
} from '#features/images/api/images.client.js';
import { Button } from '@giaokhoa/ui/components/button';
import { Tabs, TabsList, TabsTrigger } from '@giaokhoa/ui/components/tabs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker, useFetcher } from 'react-router';
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

type PendingUploadEntry = [string, ImageRef];

type SaveQuestionActionData = { question: Question } | { error: string };

type SaveRequest = {
  requestFingerprint: string;
  payload: QuestionCreate;
  pendingUploads: PendingUploadEntry[];
  leaveAfterSave: boolean;
};

function isImageRefUsed(ref: ImageRef, usedRefs: ImageRef[]): boolean {
  return usedRefs.some(
    (used) =>
      used.imageId === ref.imageId &&
      (ref.imageVariantId === null || used.imageVariantId === ref.imageVariantId),
  );
}

export function QuestionAuthoring({ initialDraft }: { initialDraft: QuestionDraft }) {
  const [draft, setDraft] = useState<QuestionDraft>(() => initialDraft);
  const [savedDraftFingerprint, setSavedDraftFingerprint] = useState(() =>
    getDraftFingerprint(initialDraft),
  );
  const [questionId, setQuestionId] = useState<string>();
  const [persistedStatus, setPersistedStatus] = useState<QuestionStatus>();
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
  const pendingUploadsRef = useRef(new Map<string, ImageRef>());

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
    const key = `${uploaded.imageId}:${uploaded.imageVariantId ?? ''}`;
    pendingUploadsRef.current.set(key, {
      imageId: uploaded.imageId,
      imageVariantId: uploaded.imageVariantId,
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
          await discardImages(batch.map(([, ref]) => ref));

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
      const images = [...pendingUploadsRef.current.values()];
      if (!images.length) return;

      for (let offset = 0; offset < images.length; offset += DISCARD_BATCH_SIZE) {
        const body = imagesContract.discard.body.parse({
          images: images.slice(offset, offset + DISCARD_BATCH_SIZE),
        });
        void fetch(imagesContract.discard.path, {
          method: imagesContract.discard.method,
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

    savingRef.current = true;
    saveRequestRef.current = {
      requestFingerprint: getDraftFingerprint(requestDraft),
      payload: payloadResult.data,
      pendingUploads: [...pendingUploadsRef.current.entries()],
      leaveAfterSave,
    };
    setSavingStatus(targetStatus);
    setError(undefined);

    void saveFetcher.submit(
      {
        ...(persistedQuestionId ? { questionId: persistedQuestionId } : {}),
        question: payloadResult.data,
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
          setError(data.error);
          return;
        }

        setQuestionId(data.question.id);
        setPersistedStatus(data.question.status);
        setSavedDraftFingerprint(request.requestFingerprint);

        const persistedImageRefs = collectImageRefs(request.payload);
        const currentImageRefs = collectImageRefs(draftRef.current);
        const cleanupCandidates = request.pendingUploads.filter(
          ([, ref]) =>
            isImageRefUsed(ref, persistedImageRefs) || !isImageRefUsed(ref, currentImageRefs),
        );
        if (!(await discardPendingUploads(cleanupCandidates))) {
          setError('Đã lưu câu hỏi nhưng chưa dọn được ảnh không còn sử dụng.');
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
  const canSaveDraft = dirty && (Boolean(questionId) || hasAnyData) && !savingStatus;
  const canMarkReady = complete && !savingStatus && (dirty || persistedStatus !== 'ready');

  return (
    <div className="flex-1 bg-muted/30 px-4 py-8 md:px-8">
      <div className="container mx-auto">
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Thêm câu hỏi</h1>
              <p className="mt-1 text-sm text-muted-foreground" role="status">
                Trạng thái: {statusLabel}
                {dirty ? ' · Có thay đổi chưa lưu' : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canSaveDraft}
                onClick={() => void saveQuestion('draft')}
              >
                {savingStatus === 'draft' ? 'Đang lưu…' : 'Lưu bản nháp'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!canMarkReady}
                onClick={() => void saveQuestion('ready')}
              >
                {savingStatus === 'ready' ? 'Đang lưu…' : 'Lưu câu hỏi'}
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
