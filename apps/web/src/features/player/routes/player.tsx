import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { apiFetch, apiJson } from '#lib/api';
import { playerViewQueryOptions, useMarkPlayerModuleLearned, usePlayerView } from '../queries/player';
import { queryClient } from '#lib/query-client';

function isInlineMime(mime: string | null): boolean {
  return mime === 'application/pdf' || (mime?.startsWith('image/') ?? false) || (mime?.startsWith('video/') ?? false);
}

function isHls(fileName: string, mime: string | null): boolean {
  return fileName.toLowerCase().endsWith('.m3u8') || mime === 'application/vnd.apple.mpegurl' || mime === 'application/x-mpegurl';
}

const QUEUE_KEY = 'giaokhoa-learn-event-queue';
interface QueuedEvent { path: string; body: string }

function enqueueEvent(event: QueuedEvent): void {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const queue: QueuedEvent[] = raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
    queue.push(event);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-100)));
  } catch {
  }
}

async function flushEventQueue(): Promise<void> {
  let queue: QueuedEvent[];
  try {
    queue = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedEvent[];
  } catch {
    return;
  }
  if (!queue.length) return;
  const remaining: QueuedEvent[] = [];
  for (const event of queue) {
    try {
      await apiJson(event.path, { method: 'POST', body: event.body });
    } catch {
      remaining.push(event);
    }
  }
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  } catch {
  }
}

async function postLearningEvent(path: string, body: unknown): Promise<boolean> {
  try {
    await apiJson(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
    return true;
  } catch {
    enqueueEvent({ path, body: JSON.stringify(body ?? {}) });
    return false;
  }
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

export function PlayerPage() {
  const { t } = useTranslation('app');
  const { id, cmId } = useParams();
  const viewQuery = usePlayerView(id, cmId);
  const data = viewQuery.data ?? null;
  const { refetch } = viewQuery;
  const markLearnedMutation = useMarkPlayerModuleLearned(id, cmId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const viewedPostedFor = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastProgressSentAt = useRef(0);

  useEffect(() => {
    void flushEventQueue();
  }, [cmId]);

  useEffect(() => {
    if (!data || !id || !cmId) return;
    if (data.completion.mode !== 'view' || data.completion.viewed || viewedPostedFor.current === cmId) return;
    viewedPostedFor.current = cmId;
    void (async () => {
      const sent = await postLearningEvent(`/api/v1/courses/${id}/modules/${cmId}/view`, {});
      if (sent) void refetch();
    })();
  }, [data, id, cmId, refetch]);

  useEffect(() => {
    const onOnline = () => void flushEventQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const file = data?.content.type === 'resource' ? data.content.file : undefined;
  const hls = file ? isHls(file.fileName, file.mimeType) : false;
  const playableFileId = file && !hls && isInlineMime(file.mimeType) ? file.id : null;
  const [previousPlayableFileId, setPreviousPlayableFileId] = useState(playableFileId);
  if (playableFileId !== previousPlayableFileId) {
    setPreviousPlayableFileId(playableFileId);
    setFileUrl(null);
  }
  useEffect(() => {
    if (!file || hls || !isInlineMime(file.mimeType)) return;
    let alive = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await apiFetch(file.contentUrl ?? `/api/v1/files/${file.id}/content`);
        if (!res.ok) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (alive) setFileUrl(objectUrl);
      } catch {
        if (alive) setFileUrl(null);
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, hls]);

  const reportVideoProgress = useCallback(
    (force = false) => {
      const video = videoRef.current;
      if (!video || !id || !cmId || !video.duration) return;
      const now = Date.now();
      if (!force && now - lastProgressSentAt.current < 5000) return;
      lastProgressSentAt.current = now;
      void postLearningEvent(`/api/v1/courses/${id}/modules/${cmId}/progress`, {
        percent: Math.min(100, Math.round((video.currentTime / video.duration) * 100)),
        positionSeconds: Math.floor(video.currentTime),
      });
    },
    [id, cmId],
  );

  const resumeAt = data?.itemProgress?.positionSeconds ?? null;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    if (resumeAt && video.currentTime < 1 && Math.abs(video.currentTime - resumeAt) > 2) {
      video.currentTime = resumeAt;
    }
  }, [data, rate, resumeAt]);

  async function markLearned() {
    if (!id || !cmId) return;
    setBusy(true);
    try {
      await markLearnedMutation.mutateAsync();
      viewedPostedFor.current = null;
      setError(null);
    } catch {
      setError(t('completionMarkFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!data && !viewQuery.isPending) {
    return (
      <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 lg:px-6">
        <p role="alert">{t('playerLoadFailed')}</p>
        <Link to={`/courses/${id}`}>{t('playerBackToCourse')}</Link>
      </main>
    );
  }
  if (!data) {
    return <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 lg:px-6">{t('courseLoading')}</main>;
  }

  const { content } = data;
  const videoSrc = content.type === 'resource' && content.file
    ? (hls ? content.file.signedUrl : fileUrl)
    : null;
  return (
    <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/courses/${id}`} className="text-sm underline">
          {t('playerBackToCourse')}: {data.course.fullName}
        </Link>
        {data.progress.percent !== null ? (
          <span className="text-sm font-medium">{t('courseProgressLabel', { percent: data.progress.percent })}</span>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>
              {data.completion.state !== 0 ? '✓ ' : ''}
              {data.cm.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {content.type === 'page' ? (
              <div dangerouslySetInnerHTML={{ __html: content.page.content }} />
            ) : null}
            {content.type === 'resource' && content.resource.publication ? (
              <p className="text-sm text-muted-foreground">
                {t('platform:materialVersion', { version: content.resource.publication.version })} · {t('platform:libraryAttributionAuthor', { author: content.resource.publication.package.source.originalAuthor })} · {t('platform:libraryAttributionSource', { source: content.resource.publication.package.source.sourceCitation ?? content.resource.publication.package.source.centreSlug })} · {t('platform:libraryAttributionLicense', { license: content.resource.publication.package.source.license })}
              </p>
            ) : null}
            {content.type === 'resource' && content.file ? (
              <div className="space-y-3">
                {content.file.mimeType === 'application/pdf' && fileUrl ? (
                  <iframe title={content.file.fileName} src={fileUrl} className="h-[70vh] w-full rounded border" />
                ) : content.file.mimeType?.startsWith('image/') && fileUrl ? (
                  <img src={fileUrl} alt={content.file.fileName} className="max-w-full rounded border" />
                ) : content.file.mimeType?.startsWith('video/') || hls ? (
                  <div className="space-y-2">
                    {videoSrc ? (
                      <video
                        ref={videoRef}
                        src={videoSrc}
                        controls
                        className="w-full rounded border"
                        onTimeUpdate={() => reportVideoProgress()}
                        onPause={() => reportVideoProgress(true)}
                        onEnded={() => reportVideoProgress(true)}
                      />
                    ) : null}
                    <label className="flex items-center gap-2 text-sm">
                      {t('playerSpeed')}
                      <select
                        className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                        value={rate}
                        onChange={(e) => setRate(Number(e.target.value))}
                      >
                        {PLAYBACK_RATES.map((r) => (
                          <option key={r} value={r}>{r}x</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {content.file.fileName} ({Math.ceil(content.file.fileSize / 1024)} KB)
                </p>
                <a href={content.file.signedUrl} className="underline">
                  {t('playerDownload')}
                </a>
                {content.resource.transcript ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">{t('playerTranscript')}</summary>
                    <div className="mt-2 whitespace-pre-wrap text-sm">{content.resource.transcript}</div>
                  </details>
                ) : null}
              </div>
            ) : null}
            {content.type === 'resource' && !content.file ? (
              <div className="space-y-3">
                {content.embedUrl ? (
                  <iframe
                    title={content.resource.name}
                    src={content.embedUrl}
                    className="aspect-video w-full rounded border"
                    allow="accelerometer; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                ) : null}
                {content.resource.url ? (
                  <a href={content.resource.url} target="_blank" rel="noreferrer" className="underline">
                    {t('playerOpenLink')}
                  </a>
                ) : null}
                {content.resource.transcript ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">{t('playerTranscript')}</summary>
                    <div className="mt-2 whitespace-pre-wrap text-sm">{content.resource.transcript}</div>
                  </details>
                ) : null}
              </div>
            ) : null}
            {content.type === 'other' ? <p>{t('playerUnsupported')}</p> : null}
            {data.completion.mode === 'manual' && data.completion.state === 0 ? (
              <Button type="button" disabled={busy} onClick={() => void markLearned()}>
                {t('playerMarkLearned')}
              </Button>
            ) : null}
            {data.completion.mode === 'manual' && data.completion.state !== 0 ? <p>{t('completionCompleted')}</p> : null}
            <div className="flex items-center justify-between border-t pt-3">
              {data.prevCmId ? (
                <Link to={`/courses/${id}/learn/${data.prevCmId}`}>
                  <Button type="button" variant="outline">{t('playerPrev')}</Button>
                </Link>
              ) : (
                <span />
              )}
              {data.nextCmId ? (
                <Link to={`/courses/${id}/learn/${data.nextCmId}`}>
                  <Button type="button">{t('playerNext')}</Button>
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('playerOutline')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.progress.sections.map((section) => (
              <div key={section.sectionId}>
                <p className="text-sm font-medium">
                  {section.name ?? t('sectionDefaultName', { number: section.section })}
                  {section.percent !== null ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {t('courseProgressLabel', { percent: section.percent })}
                    </span>
                  ) : null}
                </p>
                <ul className="mt-1 space-y-1">
                  {section.items.map((item) => (
                    <li key={item.cmId} className={item.cmId === cmId ? 'font-semibold' : undefined}>
                      {item.done ? '✓ ' : ''}
                      <Link to={`/courses/${id}/learn/${item.cmId}`}>{item.name}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default PlayerPage;

export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.id && params.cmId) {
    await queryClient.prefetchQuery(playerViewQueryOptions(params.id, params.cmId));
  }
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Học bài');
}
