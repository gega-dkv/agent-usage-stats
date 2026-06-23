import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type Theme = 'light' | 'dark';

function readTheme(): Theme {
  if (typeof document !== 'undefined') {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  }
  return 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  // Sync state to whatever the pre-paint script already applied, and re-sync
  // when the theme is toggled externally (e.g. via the native View menu).
  useEffect(() => {
    setTheme(readTheme());
    const onThemeChange = () => setTheme(readTheme());
    window.addEventListener('themechange', onThemeChange);
    return () => window.removeEventListener('themechange', onThemeChange);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.theme = next;
    } catch {
      /* ignore */
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
          {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{theme === 'light' ? 'Switch to dark' : 'Switch to light'}</TooltipContent>
    </Tooltip>
  );
}

/** Imperatively toggle the theme (used by the native View menu). */
export function toggleThemeGlobally(): void {
  const isDark = document.documentElement.classList.toggle('dark');
  try {
    localStorage.theme = isDark ? 'dark' : 'light';
  } catch {
    /* ignore */
  }
  // Notify any ThemeToggle instances to re-sync.
  window.dispatchEvent(new Event('themechange'));
}
