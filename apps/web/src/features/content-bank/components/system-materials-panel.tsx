/**
 * Panel công bố ngay trong Kho học liệu: quản trị chọn nguồn và gửi,
 * biên tập viên xem bản chụp rồi quyết định; giáo viên chọn phiên bản,
 * khoá và section để dùng nguyên trạng. API thực thi lại toàn bộ quyền.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SystemMaterialPackage } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Input } from '@giaokhoa/ui/components/input';
import { usePermissions } from '#lib/permissions';
import { ApiError } from '#lib/api';
import { courseContentQueryOptions } from '#lib/course-content';
import { materialSources, materialSubmissions, publishedMaterials, reviewMaterial, submitMaterial, attachPublishedMaterial } from '../api/system-materials';
import { queryKeys } from '../queries/keys';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';
const ROOT = '/api/v1/system-bank/materials';

/** Nguồn và giấy phép là dữ liệu xuất bản bắt buộc, luôn hiện cùng bản đang chọn. */
function MaterialAttribution({ pkg }: { pkg: SystemMaterialPackage }) {
  const { t } = useTranslation();
  return <div className="space-y-1 text-sm">
    <p>{pkg.name}</p>
    <p>{t('libraryAttributionAuthor', { author: pkg.source.originalAuthor })}</p>
    <p>{t('libraryAttributionSource', { source: pkg.source.sourceCitation ?? pkg.source.centreSlug })}</p>
    <p>{t('libraryAttributionLicense', { license: pkg.source.license })}</p>
    {pkg.description ? <p>{pkg.description}</p> : null}
    {pkg.externalUrl ? <a href={pkg.externalUrl} target="_blank" rel="noreferrer" className="underline">{t('materialPreview')}</a> : null}
  </div>;
}

/**
 * Ảnh chụp capability chỉ điều khiển trình bày; mọi hành động đọc/ghi vẫn
 * qua API. Query theo feature và chỉ chạy khi vai tương ứng đã sẵn sàng.
 */
export function SystemMaterialsPanel() {
  const { t } = useTranslation();
  const permissions = usePermissions();
  const client = useQueryClient();
  const access = permissions.access;
  const canSubmit = permissions.ready && Boolean(access?.contexts.some((ctx) => ctx.contextLevel === 20 && ctx.capabilities.includes('tenant:manage')));
  const canReview = permissions.ready && Boolean(access?.isSiteAdmin || access?.contexts.some((ctx) => ctx.contextLevel === 10 && ctx.capabilities.includes('systembank:review')));
  const canUse = permissions.ready && Boolean(access?.isSiteAdmin || access?.contexts.some((ctx) => ctx.capabilities.includes('contentbank:upload')));
  const sources = useQuery({ queryKey: queryKeys.materialSources, queryFn: materialSources, enabled: canSubmit });
  const mine = useQuery({ queryKey: queryKeys.materialSubmissions('mine'), queryFn: () => materialSubmissions('mine'), enabled: canSubmit });
  const pending = useQuery({ queryKey: queryKeys.materialSubmissions('pending'), queryFn: () => materialSubmissions('pending'), enabled: canReview });
  const published = useQuery({ queryKey: queryKeys.systemMaterials, queryFn: publishedMaterials, enabled: canUse });
  const [sourceId, setSourceId] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [reason, setReason] = useState('');
  const [versionKey, setVersionKey] = useState('');
  const [courseId, setCourseId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [notice, setNotice] = useState('');
  const [playerPath, setPlayerPath] = useState('');
  const sections = useQuery({ ...courseContentQueryOptions(courseId), enabled: Boolean(courseId) });
  const selectedReview = pending.data?.find((row) => row.id === reviewId);
  const selectedVersion = published.data?.find((row) => `${row.materialId}:${row.version}` === versionKey);

  /** Sau thao tác thành công, nạp lại hàng chờ/lịch sử/khám phá của feature. */
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      setNotice(t('materialActionDone'));
      await client.invalidateQueries({ queryKey: ['content-bank'] });
    },
    onError: (error) => setNotice(error instanceof ApiError ? error.problem.detail ?? t('libraryActionFailed') : t('libraryActionFailed')),
  });

  if (!canSubmit && !canReview && !canUse) return null;
  const failed = sources.isError || mine.isError || pending.isError || published.isError || sections.isError;
  return <Card>
    <CardHeader><CardTitle>{t('materialSystemTitle')}</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('materialSystemHelp')}</p>
      {failed ? <p role="alert">{t('libraryLoadFailed')}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {canSubmit ? <section className="space-y-2" aria-label={t('materialSubmit')}>
        <select aria-label={t('materialSource')} className={SELECT_CLASS} value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          <option value="">{t('materialSource')}</option>
          {sources.data?.filter((row) => !row.questionCategoryId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <Button disabled={!sourceId || action.isPending} onClick={() => action.mutate(() => submitMaterial(sourceId))}>{t('materialSubmit')}</Button>
        <ul className="space-y-1 text-sm">{mine.data?.map((row) => <li key={row.id}>
          {row.package.name} · {t(row.status === 'pending' ? 'libraryStatusPending' : row.status === 'approved' ? 'libraryStatusApproved' : 'libraryStatusRejected')}
          {row.publishedVersion ? ` · ${t('materialVersion', { version: row.publishedVersion })}` : ''}
          {row.rejectionReason ? ` · ${row.rejectionReason}` : ''}
        </li>)}</ul>
      </section> : null}
      {canReview ? <section className="space-y-2" aria-label={t('materialReview')}>
        <select aria-label={t('materialReview')} className={SELECT_CLASS} value={reviewId} onChange={(event) => setReviewId(event.target.value)}>
          <option value="">{t('materialReview')}</option>
          {pending.data?.map((row) => <option key={row.id} value={row.id}>{row.package.name} · {row.centreSlug}</option>)}
        </select>
        {selectedReview ? <>
          <MaterialAttribution pkg={selectedReview.package} />
          {selectedReview.package.file ? <a className="underline" href={`${ROOT}/submissions/${reviewId}/media`} target="_blank" rel="noreferrer">{t('materialPreview')}</a> : null}
          <Input aria-label={t('libraryReviewNote')} value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="flex gap-2">
            <Button disabled={action.isPending} onClick={() => action.mutate(() => reviewMaterial(reviewId))}>{t('libraryApprove')}</Button>
            <Button variant="outline" disabled={action.isPending || !reason.trim()} onClick={() => action.mutate(() => reviewMaterial(reviewId, reason.trim()))}>{t('libraryReject')}</Button>
          </div>
        </> : null}
      </section> : null}
      {canUse ? <section className="space-y-2" aria-label={t('materialChooseVersion')}>
        <select aria-label={t('materialChooseVersion')} className={SELECT_CLASS} value={versionKey} onChange={(event) => setVersionKey(event.target.value)}>
          <option value="">{t('materialChooseVersion')}</option>
          {published.data?.map((row) => <option key={`${row.materialId}:${row.version}`} value={`${row.materialId}:${row.version}`}>{row.package.name} · {t('materialVersion', { version: row.version })} · {row.package.source.centreSlug}</option>)}
        </select>
        {selectedVersion ? <>
          <MaterialAttribution pkg={selectedVersion.package} />
          {selectedVersion.package.file ? <a className="underline" href={`${ROOT}/${selectedVersion.materialId}/versions/${selectedVersion.version}/media`} target="_blank" rel="noreferrer">{t('materialPreview')}</a> : null}
          <select aria-label={t('libraryInsertCourse')} className={SELECT_CLASS} value={courseId} onChange={(event) => { setCourseId(event.target.value); setSectionId(''); }}>
            <option value="">{t('libraryInsertPickCourse')}</option>
            {permissions.courses.filter((row) => row.capabilities.includes('course:manageactivities')).map(({ course }) => <option key={course.id} value={course.id}>{course.fullName}</option>)}
          </select>
          <select aria-label={t('libraryInsertSection')} className={SELECT_CLASS} value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
            <option value="">{t('libraryInsertSection')}</option>
            {sections.data?.sections.map((row) => <option key={row.id} value={row.id}>{row.name ?? `#${row.section}`}</option>)}
          </select>
          <Button disabled={!courseId || !sectionId || action.isPending} onClick={() => action.mutate(async () => {
            const result = await attachPublishedMaterial({ materialId: selectedVersion.materialId, version: selectedVersion.version, courseId, sectionId });
            await client.invalidateQueries({ queryKey: courseContentQueryOptions(courseId).queryKey });
            setPlayerPath(`/courses/${courseId}/learn/${result.cmId}`);
          })}>{t('materialUseVersion')}</Button>
        </> : null}
        {playerPath ? <Link className="underline" to={playerPath}>{t('materialOpenInCourse')}</Link> : null}
      </section> : null}
    </CardContent>
  </Card>;
}
