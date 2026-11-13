import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { useAuth } from '#lib/auth';
import { usePermissions } from '#lib/permissions';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { PageShell } from '#components/page-shell';
import { DashboardSkeleton } from './dashboard-skeleton';
import { AdminSection } from './admin-section';
import { TeacherSection } from './teacher-section';
import { StudentSection } from './student-section';

/**
 * Vỏ trang tổng quan (route `/` khi đã đăng nhập, khung trình bày theo
 * block dashboard-01): chỉ phân loại vai trò từ ảnh chụp quyền rồi gộp
 * các khối vai trò — khối quản trị (`admin-section.tsx`), khối giảng
 * dạy (`teacher-section.tsx`), khối học tập (`student-section.tsx`).
 * Mọi query dữ liệu và logic tính toán nằm trong từng khối; file này
 * không gọi endpoint nghiệp vụ nào ngoài ảnh chụp quyền của
 * PermissionsProvider.
 */

/**
 * Trang tổng quan sau đăng nhập (route `/` khi đã đăng nhập), khung trình
 * bày theo block dashboard-01. Nội dung CHIA THEO VAI TRÒ từ ảnh chụp
 * quyền: khối quản trị chỉ hiện với người có capability quản trị, khối
 * giảng dạy chỉ với người đang dạy ít nhất một khoá, khối học tập chỉ với
 * người đang học ít nhất một khoá. Người có nhiều vai trò thấy các khối
 * tương ứng xếp chồng — mỗi khối chỉ chứa chức năng vai trò đó thao tác
 * được, không có phần tử thừa dẫn tới 403.
 */
export function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'app']);
  const { user } = useAuth();
  const perms = usePermissions();

  // Chưa phân loại được vai trò (ảnh chụp quyền + danh sách khoá đang
  // về — hai query song song) thì hiện khung giữ chỗ đúng hình học của
  // trang thay vì một dòng chữ "Đang tải…" chiếm cả trang như trước;
  // từng khối sau đó tự lấp dữ liệu theo query của nó.
  if (!perms.ready) {
    return <DashboardSkeleton />;
  }

  const hasBlocks = perms.canAdminister || perms.teaching.length > 0 || perms.learning.length > 0;
  const name = user ? `${user.firstName} ${user.lastName}`.trim() || user.username : '';

  return (
    // PageShell wide (1280px) theo §3.2; các khối bên trong tự giữ đệm
    // ngang px-4/lg:px-6 của riêng chúng nên PageShell tắt đệm của mình.
    <PageShell width="wide" className="px-0 lg:px-0">
      <h1 className="px-4 text-2xl font-semibold lg:px-6">{t('dashboard:welcome', { name })}</h1>
      {perms.canAdminister ? <AdminSection /> : null}
      {perms.teaching.length > 0 ? <TeacherSection /> : null}
      {perms.learning.length > 0 ? <StudentSection /> : null}
      {!hasBlocks ? (
        <div className="px-4 lg:px-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard:noBlocksTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-4">
              <p className="text-sm text-muted-foreground">{t('dashboard:noBlocksBody')}</p>
              <Button render={<Link to="/courses" />}>{t('dashboard:browseCourses')}</Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PageShell>
  );
}
