import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { usePermissions } from '#lib/permissions';
import { courseContentQueryOptions } from '#lib/course-content';
import { coursesListQueryOptions } from '#features/course-builder/queries/course-builder';
import { courseGroupsQueryOptions } from '#features/progress-report/queries/progress-report';
import {
  approveSharedExam, assignSharedExam, fetchSharedExamForReview, fetchSharedExamSubmissions,
  fetchSharedExams, fetchUsedSharedExams, forkSharedExam, rejectSharedExam, withdrawSharedExam,
} from '../api/questions';
import { SystemSourceNotices } from '#components/system-source-notices';
import { SystemSubmissionReviewPreview } from './system-submission-review-preview';
import type { SystemQuestionSubmission } from '../api/questions';

export function SystemSharedExamsPanel() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const contexts = permissions.access?.contexts ?? [];
  const canSubmit = permissions.ready && contexts.some((context) =>
    context.contextLevel === 20 && context.capabilities.includes('tenant:manage'));
  const canReview = permissions.ready && (contexts.some((context) =>
    context.contextLevel === 10 && context.capabilities.includes('systembank:review')) ||
    (permissions.access?.isSiteAdmin && !canSubmit) || false);

  const courses = useQuery(coursesListQueryOptions()).data ?? [];
  const [courseId, setCourseId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [name, setName] = useState('');
  const [timeOpen, setTimeOpen] = useState('');
  const [timeClose, setTimeClose] = useState('');
  const [variants, setVariants] = useState('1');
  const [requestId, setRequestId] = useState('');
  const [selectedReview, setSelectedReview] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const published = useQuery({
    queryKey: ['system-shared-exams', 'published', courseId],
    queryFn: () => fetchSharedExams(courseId),
    enabled: !!courseId,
  });
  const used = useQuery({
    queryKey: ['system-shared-exams', 'used'],
    queryFn: fetchUsedSharedExams,
    enabled: permissions.ready && contexts.some((ctx) =>
      ctx.contextLevel >= 20 && (ctx.capabilities.includes('exam:use') || ctx.capabilities.includes('tenant:manage'))),
  });
  const approved = useQuery({
    queryKey: ['system-shared-exams', 'approved'],
    queryFn: () => fetchSharedExamSubmissions('approved'),
    enabled: canReview,
  });
  const mine = useQuery({
    queryKey: ['system-shared-exams', 'mine'],
    queryFn: () => fetchSharedExamSubmissions('mine'),
    enabled: canSubmit,
  });
  const pending = useQuery({
    queryKey: ['system-shared-exams', 'pending'],
    queryFn: () => fetchSharedExamSubmissions('pending'),
    enabled: canReview,
  });
  const review = useQuery({
    queryKey: ['system-shared-exams', 'review', selectedReview],
    queryFn: () => fetchSharedExamForReview(selectedReview),
    enabled: canReview && !!selectedReview,
  });
  const content = useQuery({ ...courseContentQueryOptions(courseId), enabled: !!courseId }).data;
  const groups = useQuery({ ...courseGroupsQueryOptions(courseId), enabled: !!courseId }).data ?? [];
  const sections = content?.sections ?? [];

  async function fork() {
    if (!versionId || busy) return;
    setBusy(true); setNotice(null);
    try {
      const local = await forkSharedExam(versionId);
      setNotice(t('sharedExamForkSuccess', { id: local.paperId }));
    } catch {
      setNotice(t('sharedExamForkFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(selectedId = versionId) {
    if (!selectedId || busy) return;
    const reason = window.prompt(t('sharedExamWithdrawReason'));
    if (!reason?.trim()) return;
    setBusy(true); setNotice(null);
    try {
      await withdrawSharedExam(selectedId, reason.trim());
      if (selectedId === versionId) setVersionId('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['system-shared-exams', 'published'] }),
        queryClient.invalidateQueries({ queryKey: ['system-shared-exams', 'approved'] }),
        queryClient.invalidateQueries({ queryKey: ['system-shared-exams', 'used'] }),
      ]);
      setNotice(t('systemResourceWithdrawn'));
    } catch {
      setNotice(t('sharedExamWithdrawFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function deploy() {
    if (!versionId || !courseId || !sectionId || busy) return;
    const key = requestId || crypto.randomUUID();
    setRequestId(key);
    setBusy(true);
    setNotice(null);
    try {
      const result = await assignSharedExam(courseId, {
        sharedExamVersionId: versionId, requestId: key, sectionId,
        ...(groupId ? { targetGroupId: groupId } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(timeOpen ? { timeOpen: new Date(timeOpen).toISOString() } : {}),
        ...(timeClose ? { timeClose: new Date(timeClose).toISOString() } : {}),
        variantCount: Math.max(1, Math.min(50, Number(variants) || 1)),
      });
      setRequestId('');
      navigate(`/courses/${courseId}/exams/${result.id}`);
    } catch {
      setNotice(t('sharedExamAssignFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(approved: boolean) {
    if (!selectedReview || busy || (!approved && !reason.trim())) return;
    setBusy(true);
    setNotice(null);
    try {
      if (approved) await approveSharedExam(selectedReview);
      else await rejectSharedExam(selectedReview, reason.trim());
      setSelectedReview('');
      setReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['system-shared-exams', 'pending'] }),
        queryClient.invalidateQueries({ queryKey: ['system-shared-exams', 'published'] }),
      ]);
      setNotice(t(approved ? 'sharedExamApproved' : 'sharedExamRejected'));
    } catch {
      setNotice(t('sharedExamReviewFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="shared-exam-discovery" className="space-y-4 rounded-md border p-4">
      <h3 className="font-semibold">{t('sharedExamTitle')}</h3>
      <p className="text-sm text-muted-foreground">{t('sharedExamHint')}</p>
      {notice ? <p role="status">{notice}</p> : null}
      {(canSubmit || (permissions.ready && contexts.some((ctx) =>
        ctx.capabilities.includes('exam:use')))) ? <SystemSourceNotices resourceKind="exam" /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="shared-exam-course">{t('deployPickCourse')}</Label>
          <select id="shared-exam-course" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={courseId} onChange={(event) => {
              setCourseId(event.target.value); setSectionId(''); setGroupId('');
              setVersionId(''); setRequestId('');
            }}>
            <option value="">—</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.fullName}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="shared-exam-version">{t('sharedExamPickVersion')}</Label>
          <select id="shared-exam-version" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={versionId} disabled={!courseId || published.isLoading}
            onChange={(event) => { setVersionId(event.target.value); setRequestId(''); }}>
            <option value="">—</option>
            {(published.data ?? []).map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.name} · v{exam.sourceVersionNumber} · {t('examPaperSlotsCount', { count: exam.slotCount })}
              </option>
            ))}
            {(used.data ?? []).filter((exam) => exam.status === 'withdrawn').map((exam) =>
              <option key={`used:${exam.id}`} value={exam.id}>
                {exam.name} · v{exam.sourceVersionNumber} · {t('systemUsedWithdrawn')}
              </option>)}
          </select>
        </div>
      </div>
      {published.isError ? <p role="alert">{t('sharedExamListFailed')}</p> : null}
      {courseId && !published.isLoading && (published.data ?? []).length === 0
        ? <p className="text-sm text-muted-foreground">{t('sharedExamEmpty')}</p> : null}
      {versionId ? (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm">{t('sharedExamPinnedNotice')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="shared-exam-section">{t('pinPickSection')}</Label>
              <select id="shared-exam-section" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={sectionId} onChange={(event) => { setSectionId(event.target.value); setRequestId(''); }}>
                <option value="">—</option>
                {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="shared-exam-group">{t('pinPickGroup')}</Label>
              <select id="shared-exam-group" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={groupId} onChange={(event) => { setGroupId(event.target.value); setRequestId(''); }}>
                <option value="">{t('sharedExamAllStudents')}</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="shared-exam-name">{t('sharedExamInstanceName')}</Label>
              <Input id="shared-exam-name" value={name} onChange={(event) => { setName(event.target.value); setRequestId(''); }} />
            </div>
            <div>
              <Label htmlFor="shared-exam-variants">{t('sharedExamVariants')}</Label>
              <Input id="shared-exam-variants" type="number" min={1} max={50} value={variants}
                onChange={(event) => { setVariants(event.target.value); setRequestId(''); }} />
            </div>
            <div>
              <Label htmlFor="shared-exam-open">{t('sharedExamOpens')}</Label>
              <Input id="shared-exam-open" type="datetime-local" value={timeOpen}
                onChange={(event) => { setTimeOpen(event.target.value); setRequestId(''); }} />
            </div>
            <div>
              <Label htmlFor="shared-exam-close">{t('sharedExamCloses')}</Label>
              <Input id="shared-exam-close" type="datetime-local" value={timeClose}
                onChange={(event) => { setTimeClose(event.target.value); setRequestId(''); }} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !sectionId} onClick={() => void deploy()}>
              {t('sharedExamAssign')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void fork()}>
              {t('sharedExamFork')}
            </Button>
            {canReview ? <Button variant="outline" disabled={busy} onClick={() => void withdraw()}>
              {t('sharedExamWithdraw')}
            </Button> : null}
          </div>
        </div>
      ) : null}

      {canSubmit ? (
        <div className="space-y-2">
          <h4 className="font-medium">{t('sharedExamMySubmissions')}</h4>
          {(mine.data ?? []).length ? (
            <ul className="space-y-1 text-sm">
              {mine.data?.map((exam) => (
                <li key={exam.id}>{exam.name} · v{exam.sourceVersionNumber} ·
                  {' '}{t(`systemSubmissionStatus_${exam.status}`)}
                  {exam.rejectionReason ? ` · ${exam.rejectionReason}` : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t('sharedExamNoSubmissions')}</p>}
        </div>
      ) : null}
      {canReview ? (
        <div className="space-y-3">
          <h4 className="font-medium">{t('sharedExamWithdraw')}</h4>
          {(approved.data ?? []).map((exam) => <div key={exam.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex-1">{exam.name} · v{exam.sourceVersionNumber}</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void withdraw(exam.id)}>
              {t('sharedExamWithdraw')}
            </Button>
          </div>)}
          <h4 className="font-medium">{t('sharedExamPending')}</h4>
          {(pending.data ?? []).map((exam) => (
            <div key={exam.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1">{exam.name} · v{exam.sourceVersionNumber} ·
                {' '}{t('examPaperSlotsCount', { count: exam.slotCount })}
              </span>
              <Button variant="outline" disabled={busy} onClick={() => {
                setSelectedReview(exam.id); setReason('');
              }}>{t('systemReviewOpen')}</Button>
            </div>
          ))}
          {selectedReview && review.data ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="font-medium">{review.data.package.name} · v{review.data.package.source.versionNumber}</p>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="font-medium">{t('sharedExamTotalScore')}</dt><dd>{review.data.package.totalScore}</dd></div>
                <div><dt className="font-medium">{t('examDurationLabel')}</dt><dd>{review.data.package.durationMinutes ?? '—'}</dd></div>
                <div><dt className="font-medium">{t('sharedExamExamKind')}</dt><dd>{review.data.package.examKind ?? '—'}</dd></div>
                <div><dt className="font-medium">{t('sharedExamGrade')}</dt><dd>{review.data.package.grade ?? '—'}</dd></div>
                <div><dt className="font-medium">{t('sharedExamTfScale')}</dt><dd>{review.data.package.tfScale?.join(' · ') ?? '—'}</dd></div>
              </dl>
              <ol className="list-inside list-decimal space-y-3 text-sm">
                {review.data.package.slots.map((slot) => {
                  const submission: SystemQuestionSubmission = {
                    id: selectedReview, centreSlug: review.data.package.source.centreSlug,
                    sourceQuestionId: slot.questionId, sourceVersionId: slot.versionId,
                    sourceVersionNumber: slot.versionNumber, qtype: slot.qtype,
                    package: slot.package, checksum: slot.checksum,
                    status: 'pending', submittedBy: '', reviewedBy: null,
                    rejectionReason: null, publishedQuestionId: null,
                    publishedVersion: null, createdAt: '',
                  };
                  return <li key={slot.position} className="space-y-2 rounded-md border p-3">
                    <p className="font-medium">{t('sharedExamSection')}: {slot.section} · {t('sharedExamMaxMark')}: {slot.maxMark}</p>
                    <SystemSubmissionReviewPreview submission={submission} mediaBase="/api/v1/system-bank/exams" />
                  </li>;
                })}
              </ol>
              <Label htmlFor="shared-exam-reason">{t('systemRejectionReason')}</Label>
              <Input id="shared-exam-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void decide(true)}>{t('systemReviewApprove')}</Button>
                <Button variant="outline" disabled={busy || !reason.trim()}
                  onClick={() => void decide(false)}>{t('systemReviewReject')}</Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
