import { useEffect, useRef } from 'react';
import { Maximize2, Minus, Search, X } from 'lucide-react';
import { useStore } from '../app/store';
import { IconButton } from '../components/ui';
import type { Page } from './pages';

const PAGE_TITLES: Record<Page, string> = {
  prompts: '提示词库',
  'gallery-nai': 'NAI 图库',
  'gallery-comfy': 'ComfyUI 图库',
  tags: 'Tag 库',
  rp: 'RP 角色卡',
  settings: '设置',
};

interface TitlebarProps {
  page: Page;
  onNavigate: (page: Page) => void;
}

export function Titlebar({ page, onNavigate }: TitlebarProps) {
  const { filters, setFilters, promptTotal, settings, updateSettings, openEditor } = useStore();
  const searchRef = useRef<HTMLInputElement>(null);
  const bridge = window.atelier;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        onNavigate('prompts');
        openEditor(null);
      }
      if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNavigate, openEditor]);

  return (
    <header className="topbar">
      <span className="topbar__title">{PAGE_TITLES[page]}</span>
      {page === 'prompts' ? <span className="topbar__sub">{promptTotal} 条</span> : null}

      <div className="search">
        <Search size={14} className="search__icon" />
        <input
          ref={searchRef}
          className="input"
          type="search"
          placeholder="搜索标题、Prompt 或标签"
          value={filters.q}
          onChange={(event) => {
            setFilters({ q: event.target.value });
            if (page !== 'prompts') onNavigate('prompts');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onNavigate('prompts');
            if (event.key === 'Escape') {
              setFilters({ q: '' });
              searchRef.current?.blur();
            }
          }}
          aria-label="搜索 Prompt"
        />
        <span className="kbd search__kbd">Ctrl K</span>
      </div>

      <div className="topbar__actions">
        <IconButton
          label={settings?.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          onClick={() => updateSettings({ theme: settings?.theme === 'dark' ? 'light' : 'dark' })}
        >
          {settings?.theme === 'dark' ? <MoonIcon /> : <SunIcon />}
        </IconButton>
      </div>

      {bridge?.isDesktop ? <WindowControls /> : null}
    </header>
  );
}

function WindowControls() {
  const bridge = window.atelier;
  if (!bridge) return null;
  return (
    <div className="wincontrols">
      <button type="button" className="wincontrol" aria-label="最小化" onClick={() => bridge.window.minimize()}>
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="wincontrol"
        aria-label="最大化或还原"
        onClick={() => bridge.window.toggleMaximize()}
      >
        <Maximize2 size={13} />
      </button>
      <button type="button" className="wincontrol wincontrol--close" aria-label="关闭窗口" onClick={() => bridge.window.close()}>
        <X size={14} />
      </button>
    </div>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}
