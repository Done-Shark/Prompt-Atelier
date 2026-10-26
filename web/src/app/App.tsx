import { useEffect, useState } from 'react';
import { IdCard, Images, Library, Settings2, Tags } from 'lucide-react';
import { AppProvider, useStore } from './store';
import { Titlebar } from './Titlebar';
import { isPage, type Page } from './pages';
import { ToastViewport } from '../components/ui';
import { PromptsPage } from '../features/prompts/PromptsPage';
import { GalleryPage } from '../features/gallery/GalleryPage';
import { TagsPage } from '../features/tags/TagsPage';
import { RpPage } from '../features/rp/RpPage';
import { SettingsPage } from '../features/settings/SettingsPage';

const NAV: { page: Page; label: string; icon: typeof Library }[] = [
  { page: 'prompts', label: '提示词', icon: Library },
  { page: 'gallery-nai', label: 'NAI', icon: Images },
  { page: 'gallery-comfy', label: 'ComfyUI', icon: Images },
  { page: 'tags', label: 'Tag 库', icon: Tags },
  { page: 'rp', label: 'RP', icon: IdCard },
];

function readHash(): Page {
  const value = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return isPage(value) ? value : 'prompts';
}

function Shell() {
  const { ready, bootError, toasts } = useStore();
  const [page, setPage] = useState<Page>(readHash);

  useEffect(() => {
    const onHashChange = () => setPage(readHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (next: Page) => {
    if (next === page) return;
    window.location.hash = `#/${next}`;
    setPage(next);
  };

  if (bootError) {
    return (
      <div className="boot">
        <p style={{ color: 'var(--danger-text)' }}>无法连接本地服务</p>
        <p className="muted" style={{ maxWidth: 420, textAlign: 'center' }}>
          {bootError}
          <br />
          请确认后端已启动：桌面版直接运行 npm start；浏览器调试运行 npm run dev。
        </p>
        <button type="button" className="btn btn--secondary" onClick={() => window.location.reload()}>
          重试
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="boot">
        <span className="spinner" />
        正在打开工作台…
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="rail" aria-label="主导航">
        <div className="rail__brand" title="Prompt Atelier">
          PA
        </div>
        <div className="rail__nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.page}
                type="button"
                className="rail__item"
                data-active={page === item.page}
                onClick={() => navigate(item.page)}
                aria-current={page === item.page ? 'page' : undefined}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="rail__foot">
          <button
            type="button"
            className="rail__item"
            data-active={page === 'settings'}
            onClick={() => navigate('settings')}
            aria-current={page === 'settings' ? 'page' : undefined}
            title="设置"
          >
            <Settings2 size={17} strokeWidth={1.8} />
            <span>设置</span>
          </button>
        </div>
      </nav>

      <div className="shell">
        <Titlebar page={page} onNavigate={navigate} />
        <main className="page-host">
          {page === 'prompts' ? <PromptsPage /> : null}
          {page === 'gallery-nai' ? <GalleryPage target="nai" /> : null}
          {page === 'gallery-comfy' ? <GalleryPage target="comfyui" /> : null}
          {page === 'tags' ? <TagsPage /> : null}
          {page === 'rp' ? <RpPage /> : null}
          {page === 'settings' ? <SettingsPage /> : null}
        </main>
      </div>

      <ToastViewport toasts={toasts} />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
