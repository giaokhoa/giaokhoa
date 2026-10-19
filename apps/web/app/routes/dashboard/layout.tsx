import { TooltipProvider } from '@giaokhoa/ui/components/tooltip';
import type { CSSProperties } from 'react';
import { Outlet } from 'react-router';
import { AppSidebar } from '#components/app-sidebar.js';
import { SiteHeader } from '#components/site-header.js';
import { SidebarInset, SidebarProvider } from '@giaokhoa/ui/components/sidebar';

export default function DashboardLayout() {
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
        <AppSidebar variant="inset" />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
