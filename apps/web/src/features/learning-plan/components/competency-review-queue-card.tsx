/**
 * Thẻ hàng đợi duyệt của khu quản trị competency (`competency-admin.tsx`): một trong ba thẻ của trang kế hoạch học tập khi người dùng có quyền quản trị.
 *
 * Luồng hiển thị: chọn người dùng cần duyệt (ô chọn từ danh sách người dùng hoặc nhập tay id) rồi tải hàng đợi — danh sách kế hoạch và danh sách năng lực của người dùng đó — và thao tác duyệt ngay trên từng dòng. Mọi dữ liệu và thao tác ghi đều do component cha `CompetencyAdmin` giữ (query/mutation/thông báo); thẻ này chỉ giữ việc hiển thị và gọi lại qua props.
 *
 * Quy tắc hiện nút duyệt lấy đúng từ `planTransition` và `transitionUsercompReview` trong competencies.service:
 * - Plan (0 nháp, 1 đang thực hiện, 2 chờ duyệt, 3 đang duyệt, 4 hoàn thành): start-review chỉ từ 2; approve chỉ từ 3; unapprove chỉ từ 1; complete từ 1 hoặc 3.
 * - Usercomp (0 chưa duyệt, 1 chờ duyệt, 2 đang duyệt): start-review chỉ từ 1; approve/reject từ 1 hoặc 2.
 */
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';
import type { PlanReviewActionName, UsercompReviewActionName } from '../types/learning-plan';
import type { PlanView, UserOption, UsercompView } from '../types/types';

/** Props của thẻ hàng đợi duyệt (dữ liệu và thao tác do `CompetencyAdmin` giữ). */
export interface CompetencyReviewQueueCardProps {
  users: UserOption[];
  reviewUserId: string;
  onReviewUserIdChange: (userId: string) => void;
  reviewPlans: PlanView[] | null;
  reviewUsercomps: UsercompView[] | null;
  planStatusLabels: Record<number, string>;
  onLoadReviewQueue: () => void;
  onPlanReviewAction: (planId: string, action: PlanReviewActionName) => void;
  onUsercompReviewAction: (usercompId: string, action: UsercompReviewActionName) => void;
}

/**
 * Thẻ hàng đợi duyệt: tải kế hoạch + năng lực của một người dùng rồi duyệt từng dòng ngay tại chỗ.
 *
 * @param props - Danh sách người dùng, id người dùng cần duyệt, hai danh sách của hàng đợi, nhãn trạng thái kế hoạch và các hàm tải/duyệt của component cha.
 * @returns Thẻ hàng đợi duyệt.
 */
export function CompetencyReviewQueueCard({
  users,
  reviewUserId,
  onReviewUserIdChange,
  reviewPlans,
  reviewUsercomps,
  planStatusLabels,
  onLoadReviewQueue,
  onPlanReviewAction,
  onUsercompReviewAction,
}: CompetencyReviewQueueCardProps) {
  const { t } = useTranslation('app');
  const REVIEW_STATUS: Record<number, string> = {
    0: t('reviewStatusNone'),
    1: t('reviewStatusWaiting'),
    2: t('reviewStatusInReview'),
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('compReviewQueueTitle')}</CardTitle>
        <CardDescription>{t('compReviewQueueDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          {users.length > 0 ? (
            <Field>
              <FieldLabel id="review-user-select-label">{t('compReviewUser')}</FieldLabel>
              <Select
                items={Object.fromEntries([
                  ['none', '—'],
                  ...users.map((u) => [u.id, `${u.username} (${u.id})`] as [string, string]),
                ])}
                value={reviewUserId === '' ? 'none' : reviewUserId}
                onValueChange={(v) => onReviewUserIdChange(v === 'none' || v === null ? '' : v)}
              >
                <SelectTrigger aria-labelledby="review-user-select-label" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.username} ({u.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="review-user-id">{t('compReviewUserId')}</FieldLabel>
            <Input id="review-user-id" value={reviewUserId} onChange={(e) => onReviewUserIdChange(e.target.value)} />
          </Field>
          <Button type="button" onClick={() => void onLoadReviewQueue()}>
            {t('compLoadReviewQueue')}
          </Button>
        </div>
        {reviewPlans !== null ? (
          <div className="space-y-2">
            <h3 className="font-medium">{t('compReviewPlansTitle')}</h3>
            <ul className="space-y-1" aria-label={t('compReviewPlansTitle')}>
              {reviewPlans.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span>{planStatusLabels[p.status] ?? p.status}</span>
                  {p.status === 2 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onPlanReviewAction(p.id, 'start-review')}
                    >
                      {t('compStartReview')}
                    </Button>
                  ) : null}
                  {p.status === 3 ? (
                    <Button type="button" variant="outline" onClick={() => void onPlanReviewAction(p.id, 'approve')}>
                      {t('compApprovePlan')}
                    </Button>
                  ) : null}
                  {p.status === 1 ? (
                    <Button type="button" variant="outline" onClick={() => void onPlanReviewAction(p.id, 'unapprove')}>
                      {t('compUnapprovePlan')}
                    </Button>
                  ) : null}
                  {p.status === 1 || p.status === 3 ? (
                    <Button type="button" variant="outline" onClick={() => void onPlanReviewAction(p.id, 'complete')}>
                      {t('compCompletePlan')}
                    </Button>
                  ) : null}
                </li>
              ))}
              {reviewPlans.length === 0 ? <li className="text-sm">{t('compNoPlansForUser')}</li> : null}
            </ul>
          </div>
        ) : null}
        {reviewUsercomps !== null ? (
          <div className="space-y-2">
            <h3 className="font-medium">{t('compReviewUsercompsTitle')}</h3>
            <ul className="space-y-1" aria-label={t('compReviewUsercompsTitle')}>
              {reviewUsercomps.map((uc) => (
                <li key={uc.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{t('compUsercompCompetency', { id: uc.competencyId })}</span>
                  <span>{REVIEW_STATUS[uc.status] ?? uc.status}</span>
                  <span>
                    {uc.proficiency == null
                      ? t('proficiencyNotYet')
                      : uc.proficiency
                        ? t('proficiencyYes')
                        : t('proficiencyNo')}
                  </span>
                  {uc.grade !== null ? <span>{t('compUsercompGrade', { grade: uc.grade })}</span> : null}
                  {uc.status === 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onUsercompReviewAction(uc.id, 'start-review')}
                    >
                      {t('compStartReview')}
                    </Button>
                  ) : null}
                  {uc.status === 1 || uc.status === 2 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onUsercompReviewAction(uc.id, 'approve')}
                    >
                      {t('compApproveUsercomp')}
                    </Button>
                  ) : null}
                  {uc.status === 1 || uc.status === 2 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onUsercompReviewAction(uc.id, 'reject')}
                    >
                      {t('compRejectUsercomp')}
                    </Button>
                  ) : null}
                </li>
              ))}
              {reviewUsercomps.length === 0 ? <li className="text-sm">{t('compNoUsercompsForUser')}</li> : null}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
