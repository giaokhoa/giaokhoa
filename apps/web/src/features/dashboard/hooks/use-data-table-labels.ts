import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataTableLabels } from '#components/data-table';

/**
 * Nhãn DataTable dùng chung cho các bảng của trang tổng quan (S24):
 * ba khối vai trò (quản trị, giảng dạy, học tập) trước đây tự dựng
 * lại cùng một object `labels` từ sáu khoá i18n của namespace
 * `dashboard`. Hook này đọc đúng sáu khoá đó một lần và trả về object
 * đã memo theo kiểu `DataTableLabels` để mọi bảng dùng chung.
 *
 * @returns Nhãn DataTable (cột, chuyển trang, bảng rỗng, ô lọc, thông tin trang).
 */
export function useDataTableLabels(): DataTableLabels {
  const { t } = useTranslation('dashboard');
  return useMemo<DataTableLabels>(
    () => ({
      columns: t('tableColumns'),
      previous: t('tablePrevious'),
      next: t('tableNext'),
      empty: t('emptyTable'),
      filterPlaceholder: t('tableFilterPlaceholder'),
      pageInfo: (page, pages) => t('tablePageInfo', { page, pages }),
    }),
    [t],
  );
}
