import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { cn } from '@giaokhoa/ui/lib/utils';
import { BankArea } from '../utils/shared';
import '#config/i18n';

const BANK_TAB_PATHS: Record<'questions' | 'exams' | 'matrices', { personal: string; system: string }> = {
  questions: { personal: '/questions', system: '/system-bank/questions' },
  exams: { personal: '/exams', system: '/system-bank/exams' },
  matrices: { personal: '/matrices', system: '/system-bank/matrices' },
};

export function bankTabsForArea(area: BankArea): {
  personalPath: string;
  systemPath: string;
  active: 'personal' | 'system';
} {
  const entity =
    area === 'my-exams' || area === 'system-exams'
      ? 'exams'
      : area === 'my-matrices' || area === 'system-matrices'
        ? 'matrices'
        : 'questions';
  const paths = BANK_TAB_PATHS[entity];
  return {
    personalPath: paths.personal,
    systemPath: paths.system,
    active: area.startsWith('system') ? 'system' : 'personal',
  };
}

export function BankAreaTabs({ area }: { area: BankArea }) {
  const { t } = useTranslation('app');
  const tabs = bankTabsForArea(area);
  const items = [
    { key: 'personal', label: t('bankTabPersonal'), to: tabs.personalPath, active: tabs.active === 'personal' },
    { key: 'system', label: t('bankTabSystem'), to: tabs.systemPath, active: tabs.active === 'system' },
  ] as const;
  return (
    <nav
      aria-label={t('bankTabsLabel')}
      className="inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground"
    >
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          aria-current={item.active ? 'page' : undefined}
          data-active={item.active || undefined}
          className={cn(
            'inline-flex h-[calc(100%-1px)] items-center justify-center rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all hover:text-foreground',
            'data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-input/30',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
