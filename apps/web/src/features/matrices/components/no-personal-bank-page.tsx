/**
 * Trang "không có ngân hàng cá nhân" dùng chung cho màn tạo ma trận
 * tay và màn nhập ma trận: khi người gọi chưa có quyền dùng ngân
 * hàng câu hỏi (hoặc chưa có ngân hàng cá nhân), cả hai màn đều
 * hiện cùng một Card giải thích + đường dẫn về danh sách ma trận.
 */
import { Link } from 'react-router';
import { Card, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';

/**
 * Trang chặn khi không có ngân hàng cá nhân để làm việc.
 *
 * @param title - Tiêu đề trang (tên màn gọi: tạo ma trận / nhập ma trận).
 */
export function NoPersonalBankPage({ title }: { title: string }) {
  // Khoá của trang nằm ở namespace `app` (defaultNS của i18n là
  // `platform`, dùng useTranslation() trần sẽ tra sai namespace).
  const { t } = useTranslation('app');
  return (
    <PageShell width="medium">
      <PageHeader title={title} />
      <Card>
        <CardHeader>
          <CardTitle>{t('myMatrixBank')}</CardTitle>
          <CardDescription>{t('matrixNoPersonalBank')}</CardDescription>
        </CardHeader>
      </Card>
      <p>
        <Link to="/matrices" className="text-sm underline">
          {t('backToQuestionBankList')}
        </Link>
      </p>
    </PageShell>
  );
}
