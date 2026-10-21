import { Collapsible, CollapsibleContent } from '@giaokhoa/ui/components/collapsible';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@giaokhoa/ui/components/sidebar';
import { ChevronRightIcon, CirclePlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';

type NavItem = {
  title: string;
  url: string;
  icon?: React.ReactNode;
  items?: {
    title: string;
    url: string;
  }[];
};

function MainNavItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { pathname } = useLocation();
  const itemActive =
    pathname === item.url ||
    pathname.startsWith(`${item.url}/`) ||
    (item.url === '/assignments/new' &&
      (pathname.startsWith('/assignments/') || pathname.startsWith('/attempts/')));
  const sectionActive =
    itemActive || item.items?.some((subItem) => pathname === subItem.url) === true;
  const [open, setOpen] = useState(sectionActive);

  if (!item.items?.length) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={item.title}
          isActive={itemActive}
          render={<Link to={item.url} onClick={onNavigate} />}
        >
          {item.icon}
          <span>{item.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <SidebarMenuButton
        tooltip={item.title}
        isActive={sectionActive}
        render={
          <Link
            to={item.url}
            onClick={() => {
              setOpen((current) => (itemActive ? !current : true));
              onNavigate();
            }}
          />
        }
      >
        {item.icon}
        <span>{item.title}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        type="button"
        aria-label={`Đóng/mở ${item.title}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRightIcon className="transition-transform duration-150 ease-out group-data-open/collapsible:rotate-90" />
      </SidebarMenuAction>
      <CollapsibleContent>
        <SidebarMenuSub>
          {item.items.map((subItem) => (
            <SidebarMenuSubItem key={subItem.title}>
              <SidebarMenuSubButton
                isActive={pathname === subItem.url}
                render={<Link to={subItem.url} onClick={onNavigate} />}
              >
                <span>{subItem.title}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function NavMain({ items }: { items: NavItem[] }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <div className="flex flex-col gap-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Thêm câu hỏi"
                className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                render={<Link to="/questions/new" onClick={closeMobileSidebar} />}
              >
                <CirclePlusIcon />
                <span>Thêm câu hỏi</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarGroupLabel>Quản lý</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((item) => (
              <MainNavItem key={item.title} item={item} onNavigate={closeMobileSidebar} />
            ))}
          </SidebarMenu>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
