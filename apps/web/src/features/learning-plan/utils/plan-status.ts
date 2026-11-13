import { useTranslation } from 'react-i18next';

/**
 * Nhãn trạng thái kế hoạch học tập dịch qua catalog ở thời điểm render.
 * Dùng chung cho trang kế hoạch (phần người học) và khu quản trị
 * competency để tránh định nghĩa trùng `PLAN_STATUS` ở hai nơi.
 */
export function usePlanStatusLabels(): Record<number, string> {
  const { t } = useTranslation('app');
  return {
    0: t('planStatusDraft'),
    1: t('planStatusActive'),
    2: t('planStatusWaiting'),
    3: t('planStatusInReview'),
    4: t('planStatusComplete'),
  };
}
