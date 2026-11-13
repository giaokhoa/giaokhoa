import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import '#config/i18n';

export type ThemeChoice = 'system' | 'dark' | 'light';
const STORAGE_KEY = 'giaokhoa:theme';

export function resolveDarkTheme(choice: ThemeChoice, prefersDark: boolean): boolean {
  return choice === 'dark' || (choice === 'system' && prefersDark);
}

const ThemeContext = createContext<{ dark: boolean; toggle: () => void }>({
  dark: false, toggle: () => {},
});

/**
 * SSR khởi tạo light trên cả server/client để không lệch hydrate.
 * Sau hydrate đọc theme đã chọn (hoặc ưu tiên hệ điều hành) và cập
 * nhật class .dark + color-scheme. Listener system tự cập nhật khi
 * chưa có lựa chọn thủ công. Không truy cập window/storage lúc SSR.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [prefersDark, setPrefersDark] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') setChoice(saved);
    } catch {
      // Browser không có localStorage (private mode): vẫn dùng media query.
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    setPrefersDark(media.matches);
    const update = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  const dark = resolveDarkTheme(choice, prefersDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);

  const toggle = () => {
    const next: ThemeChoice = dark ? 'light' : 'dark';
    setChoice(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Không chặn UI. */ }
  };

  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>;
}

/** Nút chọn sáng/tối dùng được cả khi đăng nhập và ngoài trang công khai. */
export function ThemeToggle() {
  const { dark, toggle } = useContext(ThemeContext);
  const { t } = useTranslation('app');
  return (
    <Button type="button" variant="ghost" size="icon" onClick={toggle}
      aria-label={dark ? t('themeLight') : t('themeDark')}>
      {dark ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
    </Button>
  );
}
