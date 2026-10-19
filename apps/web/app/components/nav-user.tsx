import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@giaokhoa/ui/components/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from '@giaokhoa/ui/components/sidebar';
import { ChevronsUpDownIcon, LogOutIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { authClient } from '#features/auth/api/auth-client.js';

function initials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length) {
    return parts
      .slice(-2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }

  return email.slice(0, 2).toUpperCase();
}

function UserAvatar({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image?: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const alt = name || email;

  return (
    <Avatar>
      {image && !imageFailed ? (
        <img
          src={image}
          alt={alt}
          className="size-full rounded-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <AvatarFallback>{initials(name, email)}</AvatarFallback>
      )}
    </Avatar>
  );
}

export function NavUser() {
  const { isMobile } = useSidebar();
  const { data: session, isPending } = authClient.useSession();

  const signOut = useCallback(async () => {
    await authClient.signOut();
    window.location.replace('/login');
  }, []);

  if (isPending) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuSkeleton showIcon />
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  if (!session?.user) return null;

  const user = session.user;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={user.email} />}>
            <UserAvatar name={user.name} email={user.email} image={user.image} />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name || 'Tài khoản'}</span>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="flex items-center gap-2">
                  <UserAvatar name={user.name} email={user.email} image={user.image} />
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name || 'Tài khoản'}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOutIcon />
              Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
