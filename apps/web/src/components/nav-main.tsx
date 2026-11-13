import type { Icon } from '@tabler/icons-react';
import { ChevronRightIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';

import { Badge } from '@giaokhoa/ui/components/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@giaokhoa/ui/components/collapsible';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@giaokhoa/ui/components/sidebar';

export interface NavItem {
  title: string;
  url: string;
  icon?: Icon;
  badgeCount?: number;
}

export interface NavGroupItem {
  groupId: string;
  title: string;
  icon?: Icon;
  url?: string;
  toggleLabel?: string;
  children: NavItem[];
}

function navPendingClassName({ isPending }: { isPending: boolean }): string | undefined {
  return isPending ? 'opacity-50 transition-opacity' : undefined;
}

export type NavEntry = NavItem | NavGroupItem;

function isNavGroup(entry: NavEntry): entry is NavGroupItem {
  return 'children' in entry;
}

function isPathActive(url: string, pathname: string, search: string): boolean {
  const queryIndex = url.indexOf('?');
  const urlPath = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const pathMatches = urlPath === '/' ? pathname === '/' : pathname === urlPath || pathname.startsWith(`${urlPath}/`);
  if (!pathMatches || queryIndex < 0) return pathMatches;
  const wanted = new URLSearchParams(url.slice(queryIndex + 1));
  const current = new URLSearchParams(search);
  let queryMatches = true;
  wanted.forEach((value, key) => {
    if (current.get(key) !== value) queryMatches = false;
  });
  return queryMatches;
}

function NavLeafButton({ item, pathname, search }: { item: NavItem; pathname: string; search: string }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<NavLink to={item.url} className={navPendingClassName} />}
        tooltip={item.title}
        isActive={isPathActive(item.url, pathname, search)}
      >
        {item.icon && <item.icon />}
        <span>{item.title}</span>
        {item.badgeCount != null && item.badgeCount > 0 ? (
          <Badge variant="destructive" className="ml-auto h-5 min-w-5 shrink-0 rounded-full px-1">
            {item.badgeCount}
          </Badge>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavGroupCollapsible({
  item,
  pathname,
  search,
  open,
  onOpenChange,
}: {
  item: NavGroupItem;
  pathname: string;
  search: string;
  open: boolean;
  onOpenChange: (groupId: string, open: boolean) => void;
}) {
  const { state, isMobile, setOpen } = useSidebar();
  const hasActiveChild = item.children.some((child) => isPathActive(child.url, pathname, search));

  const handleOpenChange = (nextOpen: boolean) => {
    if (state === 'collapsed' && !isMobile) {
      setOpen(true);
      if (!open) onOpenChange(item.groupId, true);
      return;
    }
    onOpenChange(item.groupId, nextOpen);
  };

  const subMenu = (
    <SidebarMenuSub>
      {item.children.map((child) => (
        <SidebarMenuSubItem key={child.url}>
          <SidebarMenuSubButton render={<NavLink to={child.url} className={navPendingClassName} />} isActive={isPathActive(child.url, pathname, search)}>
            {child.icon && <child.icon />}
            <span>{child.title}</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  );

  if (item.url && item.children.length === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton render={<NavLink to={item.url} className={navPendingClassName} />} tooltip={item.title} isActive={isPathActive(item.url, pathname, search)}>
          {item.icon && <item.icon />}
          <span>{item.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  if (item.url) {
    return (
      <Collapsible open={open} onOpenChange={handleOpenChange} className="group/collapsible" render={<SidebarMenuItem />}>
        <SidebarMenuButton
          render={<NavLink to={item.url} className={navPendingClassName} />}
          tooltip={item.title}
          isActive={isPathActive(item.url, pathname, search)}
          className="pr-8"
        >
          {item.icon && <item.icon />}
          <span>{item.title}</span>
        </SidebarMenuButton>
        <CollapsibleTrigger
          aria-label={item.toggleLabel ?? item.title}
          className="absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md text-sidebar-foreground/70 ring-sidebar-ring outline-hidden focus-visible:ring-2 group-data-[collapsible=icon]:hidden"
        >
          <ChevronRightIcon className="size-4 transition-transform duration-200 group-data-open/collapsible:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>{subMenu}</CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange} className="group/collapsible" render={<SidebarMenuItem />}>
      <CollapsibleTrigger render={<SidebarMenuButton tooltip={item.title} isActive={hasActiveChild} />}>
        {item.icon && <item.icon />}
        <span>{item.title}</span>
        <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[collapsible=icon]:hidden group-data-open/collapsible:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>{subMenu}</CollapsibleContent>
    </Collapsible>
  );
}

export function NavMain({
  items,
  openGroups,
  onOpenGroupChange,
}: {
  items: NavEntry[];
  openGroups: string[];
  onOpenGroupChange: (groupId: string, open: boolean) => void;
}) {
  const { pathname, search } = useLocation();
  const visible = items.filter((entry) => !isNavGroup(entry) || entry.children.length > 0 || Boolean(entry.url));
  if (visible.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {visible.map((entry) =>
            isNavGroup(entry) ? (
              <NavGroupCollapsible
                key={entry.groupId}
                item={entry}
                pathname={pathname}
                search={search}
                open={
                  openGroups.includes(entry.groupId) ||
                  entry.children.some((child) => isPathActive(child.url, pathname, search)) ||
                  (entry.url ? isPathActive(entry.url, pathname, search) : false)
                }
                onOpenChange={onOpenGroupChange}
              />
            ) : (
              <NavLeafButton key={entry.url} item={entry} pathname={pathname} search={search} />
            ),
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
