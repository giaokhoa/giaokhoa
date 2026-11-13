import { useState, type CSSProperties } from 'react';
import { Link, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { useAuth } from '#lib/auth';
import { useSidebarDefaultOpen } from '#lib/sidebar-default-open';
import { AppSidebar } from '#components/app-sidebar';
import { AppShellSkeleton } from '#components/app-shell-skeleton';
import { NavigationProgressBar, useNavigationPending } from '#components/navigation-progress';
import { SiteHeader } from '#components/site-header';
import { SidebarInset, SidebarProvider } from '@giaokhoa/ui/components/sidebar';

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';

function AuthenticatedShell() {
  const sidebarDefaultOpen = useSidebarDefaultOpen();
  const navigationPending = useNavigationPending();
  return (
    <SidebarProvider
      defaultOpen={sidebarDefaultOpen}
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <NavigationProgressBar active={navigationPending} />
      <AppSidebar variant="inset" />
      <SidebarInset
        aria-busy={navigationPending || undefined}
        className={`transition-opacity duration-200 ${navigationPending ? 'opacity-60' : ''}`}
      >
        <SiteHeader />
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}

function PublicShell() {
  const { user, logout } = useAuth();
  const { t } = useTranslation('app');
  const [logoutFailed, setLogoutFailed] = useState(false);
  return (
    <div>
      <header className="flex items-center gap-4 border-b px-8 py-3">
        <Link to="/" className="font-semibold">
          Giáo khoa
        </Link>
        <span className="ml-auto flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span>{user.username}</span>
              <Button type="button" variant="outline" onClick={() => {
                setLogoutFailed(false);
                void logout().catch(() => setLogoutFailed(true));
              }}>
                {t('logout')}
              </Button>
              {logoutFailed && <span role="alert" className="text-destructive">{t('logoutFailed')}</span>}
            </>
          ) : (
            <Link to="/login">{t('signIn')}</Link>
          )}
        </span>
      </header>
      <Outlet />
    </div>
  );
}

export default function Shell() {
  const { user, loading } = useAuth();
  if (loading) return <AppShellSkeleton />;
  return user ? <AuthenticatedShell /> : <PublicShell />;
}
