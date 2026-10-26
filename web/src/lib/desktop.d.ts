/** Electron 预加载脚本暴露的桥接接口；浏览器中不存在 */
export interface AtelierBridge {
  isDesktop: boolean;
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
  };
  chooseDirectory: () => Promise<string | null>;
  openPath: (target: string) => Promise<boolean>;
}

declare global {
  interface Window {
    atelier?: AtelierBridge;
  }
}

export {};
