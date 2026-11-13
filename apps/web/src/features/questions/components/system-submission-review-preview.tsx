import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichTextDocument } from '@giaokhoa/contracts';
import { RichTextView } from '@giaokhoa/editor';
import type { SystemQuestionSubmission } from '../api/questions';
import { QTYPE_LABEL_KEYS, QTYPES, type Qtype } from '../utils/shared';

const ReviewMediaBase = createContext('/api/v1/system-bank/submissions');

function reviewImageSrc(base: string, submissionId: string, hash: string): string {
  return `${base}/${submissionId}/media/${hash}`;
}

function renderableDocument(value: unknown, submission: SystemQuestionSubmission, base: string): RichTextDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;
  const allowedHashes = new Set((submission.package.media ?? []).map((file) => file.contentHash));
  const transform = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(transform);
    if (!node || typeof node !== 'object') return node;
    const original = node as Record<string, unknown>;
    const cloned = Object.fromEntries(Object.entries(original).map(([key, nested]) => [key, transform(nested)]));
    if (original.type === 'image') {
      const attrs = original.attrs && typeof original.attrs === 'object'
        ? original.attrs as Record<string, unknown> : {};
      const originalSrc = typeof attrs.src === 'string' ? attrs.src : '';
      const hash = originalSrc.startsWith('bank-media://') ? originalSrc.slice('bank-media://'.length) : '';
      cloned.attrs = { ...attrs, src: allowedHashes.has(hash) ? reviewImageSrc(base, submission.id, hash) : '' };
    }
    return cloned;
  };
  return transform(value) as RichTextDocument;
}

function SnapshotValue({ value, submission }: { value: unknown; submission: SystemQuestionSubmission }) {
  const { t } = useTranslation('app');
  const base = useContext(ReviewMediaBase);
  const rich = renderableDocument(value, submission, base);
  if (rich) return <div className="min-w-0 [&_img]:max-w-full"><RichTextView value={rich} /></div>;
  if (value === null || value === undefined) return <span>—</span>;
  if (typeof value === 'string' || typeof value === 'number') return <span>{value}</span>;
  if (typeof value === 'boolean') return <span>{t(value ? 'systemReviewCorrect' : 'systemReviewIncorrect')}</span>;
  if (Array.isArray(value)) {
    return <ol className="list-inside list-decimal space-y-1">{value.map((part, i) => (
      <li key={i}><SnapshotValue value={part} submission={submission} /></li>
    ))}</ol>;
  }
  if (typeof value === 'object') {
    const data = value as Record<string, unknown>;
    if ('answer' in data) return <SnapshotValue value={data.answer} submission={submission} />;
    if (Array.isArray(data.answers)) {
      return <ol className="list-inside list-decimal space-y-1">
        {data.answers.map((answer, i) => {
          if (!answer || typeof answer !== 'object') return <li key={i}><SnapshotValue value={answer} submission={submission} /></li>;
          const pair = answer as Record<string, unknown>;
          return <li key={i}>
            {typeof pair.statementId === 'string' ? <code className="mr-2 text-xs">{pair.statementId}</code> : null}
            <SnapshotValue value={pair.value ?? pair.answer} submission={submission} />
          </li>;
        })}
      </ol>;
    }
    return <dl className="space-y-1">
      {Object.entries(data).map(([key, nested]) => (
        <div key={key} className="flex flex-wrap gap-2 text-sm">
          <dt className="font-medium">{key}:</dt>
          <dd className="min-w-0"><SnapshotValue value={nested} submission={submission} /></dd>
        </div>
      ))}
    </dl>;
  }
  return <span>—</span>;
}

export function SystemSubmissionReviewPreview({ submission, mediaBase = '/api/v1/system-bank/submissions' }: {
  submission: SystemQuestionSubmission; mediaBase?: string;
}) {
  const { t } = useTranslation('app');
  const pkg = submission.package;
  const qtype = (QTYPES as readonly string[]).includes(submission.qtype)
    ? submission.qtype as Qtype : 'essay';

  return (
    <ReviewMediaBase.Provider value={mediaBase}>
    <div className="space-y-4 text-sm" data-testid="system-submission-preview">
      <p className="text-muted-foreground break-all">
        {t(QTYPE_LABEL_KEYS[qtype])} · {t('systemSourceCentre')}: {submission.centreSlug} ·
        {t('systemSourceVersion')}: {submission.sourceVersionNumber} ·
        {t('systemSourceChecksum')}: {submission.checksum}
      </p>
      <p className="break-words">
        {t('systemSourceAuthor')}: {pkg.source?.authorId ?? '—'} ·
        {t('systemSourceReference')}: {pkg.source?.sourceRef ?? '—'} ·
        {t('systemSourceLicense')}: {pkg.source?.license ?? '—'}
      </p>
      {pkg.stimulusContent ? (
        <section className="rounded-md border p-3">
          <h6 className="mb-2 font-medium">{t('systemReviewStimulus')}</h6>
          <SnapshotValue value={pkg.stimulusContent} submission={submission} />
        </section>
      ) : null}
      <section className="rounded-md border p-3">
        <h6 className="mb-2 font-medium">{t('systemReviewQuestion')}</h6>
        <SnapshotValue value={pkg.questionText} submission={submission} />
      </section>
      {pkg.answerKey?.guidance ? (
        <section className="rounded-md border p-3">
          <h6 className="mb-2 font-medium">{t('systemReviewGuidance')}</h6>
          <SnapshotValue value={pkg.answerKey.guidance} submission={submission} />
        </section>
      ) : null}
      <section className="space-y-2 rounded-md border p-3">
        <h6 className="font-medium">{t('systemAnswerPreview')}</h6>
        {pkg.answers.length ? (
          <ol className="list-inside list-decimal space-y-2">
            {[...pkg.answers].sort((a, b) => a.sortOrder - b.sortOrder).map((answer, i) => (
              <li key={i} className="space-y-1">
                <SnapshotValue value={answer.answer} submission={submission} />
                <span className="ml-2 font-medium">
                  {t(answer.isCorrect ? 'systemReviewCorrect' : 'systemReviewIncorrect')}
                </span>
                {answer.feedback ? (
                  <div className="ml-4 text-muted-foreground">
                    {t('systemReviewFeedback')}: <SnapshotValue value={answer.feedback} submission={submission} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <p>{t('systemAnswerInKey')}</p>}
        {pkg.answerKey?.solution ? (
          <div>
            <h6 className="mb-2 font-medium">{t('systemReviewSolution')}</h6>
            <SnapshotValue value={pkg.answerKey.solution} submission={submission} />
          </div>
        ) : null}
      </section>
      {pkg.generalFeedback ? (
        <section className="rounded-md border p-3">
          <h6 className="mb-2 font-medium">{t('systemReviewFeedback')}</h6>
          <SnapshotValue value={pkg.generalFeedback} submission={submission} />
        </section>
      ) : null}
      {pkg.options && Object.keys(pkg.options).length ? (
        <section className="rounded-md border p-3">
          <h6 className="mb-2 font-medium">{t('systemReviewOptions')}</h6>
          <SnapshotValue value={pkg.options} submission={submission} />
        </section>
      ) : null}
      {pkg.outcomes.length ? (
        <section className="rounded-md border p-3">
          <h6 className="mb-2 font-medium">{t('systemReviewOutcomes')}</h6>
          <ul className="list-inside list-disc">
            {pkg.outcomes.map((outcome) => <li key={outcome.outcomeId}>{outcome.outcomeId} · {outcome.cognitiveLevel}</li>)}
          </ul>
        </section>
      ) : null}
      {pkg.media?.length ? (
        <section className="space-y-2 rounded-md border p-3">
          <h6 className="font-medium">{t('systemReviewMedia')}</h6>
          <div className="flex flex-wrap gap-3">
            {pkg.media.map((file) => (
              <figure key={file.contentHash} className="max-w-64">
                <img src={reviewImageSrc(mediaBase, submission.id, file.contentHash)} alt={file.fileName}
                  className="max-h-56 max-w-full rounded-md border object-contain" loading="lazy" />
                <figcaption className="break-all text-xs text-muted-foreground">{file.fileName}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
    </div>
    </ReviewMediaBase.Provider>
  );
}
