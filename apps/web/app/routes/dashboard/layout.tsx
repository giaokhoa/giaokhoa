import { TooltipProvider } from '@giaokhoa/ui/components/tooltip';
import type { CSSProperties } from 'react';
import { Outlet, useNavigation } from 'react-router';
import { classesContract } from '@giaokhoa/shared/http/classes';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { getAccess } from '#features/workspace/access.server.js';
import { apiData } from '#lib/http/data.server.js';
import { WorkspaceErrorBoundary } from '#features/workspace/ui.js';
import type { Route } from './+types/layout';

export async function loader({ request }: Route.LoaderArgs) {
  const access = await getAccess(request);
  const [classes, assignments] = await Promise.all([
    apiData(request, classesContract.list.path, classesContract.list.responses[200]),
    apiData(request, assignmentsContract.list.path, assignmentsContract.list.responses[200]),
  ]);
  return { access, classes, assignments };
}
export function headers() {
  return { 'Cache-Control': 'private, no-store' };
}
export function shouldRevalidate() {
  return true;
}
export const ErrorBoundary = WorkspaceErrorBoundary;
import { AppSidebar } from '#components/app-sidebar.js';
import { SiteHeader } from '#components/site-header.js';
import { SidebarInset, SidebarProvider } from '@giaokhoa/ui/components/sidebar';

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
  const navigation = useNavigation();
  return (
    <TooltipProvider>
      <SidebarProvider
        style={
          {
            '--sidebar-width': '18rem',
            '--header-height': '3rem',
          } as CSSProperties
        }
      >
        <AppSidebar
          variant="inset"
          capabilities={loaderData.access.capabilities}
          classes={loaderData.classes}
          assignments={loaderData.assignments}
        />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col" aria-busy={navigation.state !== 'idle'}>
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
