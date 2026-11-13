/**
 * Form ghim một đề vào khoá học (chọn khoá → chương → nhóm → số bản) — dùng chung cho hộp ghim của panel "Đề của tôi" ở trang ngân hàng và thẻ ghim tại màn sửa đề: cùng 4 state, cùng 3 query (danh sách khoá, nội dung khoá, nhóm của khoá), cùng nhịp chọn chương đầu tiên khi nội dung về, cùng công thức kẹp số bản và cùng đột biến ghim exam-pins. Điểm khác nhau duy nhất nằm ở phía gọi: panel đóng hộp + điều hướng tới màn đề của khoá đích sau khi ghim, màn sửa đề làm mới danh sách lần ghim + gói dựng của khoá đích. Danh sách khoá là query dùng chung toàn app; chương và nhóm nạp theo khoá đã chọn.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';

import { courseContentQueryOptions } from '#lib/course-content';
import { coursesListQueryOptions } from '#features/course-builder/queries/course-builder';
import { courseGroupsQueryOptions } from '#features/progress-report/queries/progress-report';
import { useDeployExamPin } from '../queries/questions';
import { withApiReason } from '../utils/shared';

/** Số bản tối thiểu của một lần ghim (kẹp ở cả Input lẫn body gửi lên). */
export const DEPLOY_VARIANT_COUNT_MIN = 1;
/** Số bản tối đa của một lần ghim (kẹp ở cả Input lẫn body gửi lên). */
export const DEPLOY_VARIANT_COUNT_MAX = 50;

/** Lớp chung cho các ô chọn của form ghim (biến thể px-2.5/shadow-xs, khác hằng `selectClass` dùng chung ở `#lib/form-classes`). */
const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs';

/** Props của form ghim đề vào khoá học. */
export interface DeployPinFormProps {
  /** Id đề cần ghim. */
  examId: string;
  /** Số phiên bản đã ghim để báo thành công (thông báo `pinOk` cần version). */
  examVersion: number;
  /** Bật các query chọn khoá/chương/nhóm (panel: hộp đang mở; màn sửa: đề ready + có cờ deploy). */
  enabled: boolean;
  /** Tiền tố id cho các ô chọn/nhập để không trùng id khi nhiều form cùng trang. */
  idPrefix: string;
  /** Báo thông báo kết quả lên khung trang. */
  setMessage: (message: string | null) => void;
  /** Chạy sau khi ghim thành công, nhận id lần ghim + id khoá đích. */
  onDeployed: (pin: { id: string; courseId: string }) => void;
  /** Nút đóng hộp (chỉ panel có; màn sửa đề không có nút đóng). */
  onClose?: () => void;
}

/**
 * Form ghim một đề vào khoá học.
 *
 * @param props - Đề cần ghim, trạng thái bật query, tiền tố id, bộ báo thông báo và các callback sau ghim/đóng.
 * @returns Form chọn khoá/chương/nhóm/số bản + nút ghim.
 */
export function DeployPinForm({
  examId,
  examVersion,
  enabled,
  idPrefix,
  setMessage,
  onDeployed,
  onClose,
}: DeployPinFormProps) {
  const { t } = useTranslation('app');
  const deployPinMutation = useDeployExamPin();
  const [courseId, setCourseId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [variantCount, setVariantCount] = useState('1');
  const courses = useQuery({ ...coursesListQueryOptions(), enabled }).data ?? [];
  const contentQuery = useQuery({ ...courseContentQueryOptions(courseId), enabled: enabled && !!courseId });
  const sections = contentQuery.data?.sections ?? [];
  const groups = useQuery({ ...courseGroupsQueryOptions(courseId), enabled: enabled && !!courseId }).data ?? [];

  // Chọn chương đầu tiên khi nội dung khoá đích tải về (nhịp của loadDeployQuizzes thủ công trước đây): setState trong lúc render chỉ chạy khi chương chưa chọn mà đã có chương đầu, các lần render sau không đổi gì thêm.
  const firstSectionId = contentQuery.data?.sections[0]?.id;
  if (!sectionId && firstSectionId) {
    setSectionId(firstSectionId);
  }

  /** Ghim đề vào khoá đã chọn (toàn khoá hoặc một nhóm đích) — một thao tác exam-pins. */
  async function runDeploy() {
    if (!courseId || !sectionId) return;
    try {
      const pin = await deployPinMutation.mutateAsync({
        courseId,
        body: {
          sectionId,
          examId,
          variantCount: Math.min(
            DEPLOY_VARIANT_COUNT_MAX,
            Math.max(DEPLOY_VARIANT_COUNT_MIN, Number(variantCount) || DEPLOY_VARIANT_COUNT_MIN),
          ),
          ...(groupId ? { targetGroupId: groupId } : {}),
        },
      });
      setMessage(t('pinOk', { version: examVersion }));
      onDeployed({ id: pin.id, courseId });
    } catch (err) {
      setMessage(withApiReason(t('pinFailed'), err));
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor={`${idPrefix}-course`}>{t('deployPickCourse')}</Label>
        <select
          id={`${idPrefix}-course`}
          className={selectClass}
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            setSectionId('');
            setGroupId('');
          }}
        >
          <option value="">—</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.fullName}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-section`}>{t('pinPickSection')}</Label>
        <select
          id={`${idPrefix}-section`}
          className={selectClass}
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
        >
          <option value="">—</option>
          {sections.map((sec) => (
            <option key={sec.id} value={sec.id}>{sec.name}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-group`}>{t('pinPickGroup')}</Label>
        <select
          id={`${idPrefix}-group`}
          className={selectClass}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        >
          <option value="">{t('pinExamWholeCourse')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-variants`}>{t('deployVariantCount')}</Label>
        <Input
          id={`${idPrefix}-variants`}
          type="number"
          min={DEPLOY_VARIANT_COUNT_MIN}
          max={DEPLOY_VARIANT_COUNT_MAX}
          className="w-24"
          value={variantCount}
          onChange={(e) => setVariantCount(e.target.value)}
        />
      </div>
      <Button
        type="button"
        disabled={!courseId || !sectionId || deployPinMutation.isPending}
        onClick={() => void runDeploy()}
      >
        {t('pinExamAction')}
      </Button>
      {onClose ? (
        <Button type="button" variant="outline" onClick={onClose}>
          ✕
        </Button>
      ) : null}
    </div>
  );
}
