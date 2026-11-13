import type { ReactNode } from 'react';
import { IconBell, IconLink, IconShieldLock } from '@tabler/icons-react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@giaokhoa/ui/lib/utils';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';

export function SettingsShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation('app');

  const items = [
    { to: '/settings/security', label: t('settingsSecurity'), icon: IconShieldLock },
    { to: '/settings/linked-accounts', label: t('settingsLinkedAccounts'), icon: IconLink },
    { to: '/settings/notifications', label: t('settingsNotifications'), icon: IconBell },
  ];

  return (
    <PageShell width="medium">
      <PageHeader title={t('settingsTitle')} />
      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        <nav aria-label={t('settingsTitle')} className="shrink-0 md:w-56">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {items.map((item) => (
              <li key={item.to} className="shrink-0 md:shrink">
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-4 md:gap-6">{children}</div>
      </div>
    </PageShell>
  );
}
