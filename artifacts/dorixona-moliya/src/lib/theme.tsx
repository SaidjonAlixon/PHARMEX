import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'pharmex-theme';

function readTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.add('theme-anim');
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  window.setTimeout(() => root.classList.remove('theme-anim'), 450);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* private mode */ }
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    if (readTheme() !== theme) applyTheme(theme);
  }, [theme]);
  const dark = theme === 'dark';
  const label = dark ? 'Kunduzgi rejimga oʻtish' : 'Tungi rejimga oʻtish';
  return <button type="button" className={`theme-toggle ${className}`} onClick={() => setTheme(dark ? 'light' : 'dark')} title={label} aria-label={label} aria-pressed={dark} data-testid="button-theme-toggle">
    <Sun className="theme-track-icon sun" size={13} /><Moon className="theme-track-icon moon" size={13} />
    <span className="theme-knob">{dark ? <Moon size={14} /> : <Sun size={14} />}</span>
  </button>;
}
