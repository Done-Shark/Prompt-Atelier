/**
 * 预加载脚本：只暴露窗口控制与目录选择，不向页面开放 Node。
 * 浏览器调试时 window.atelier 不存在，前端据此隐藏窗口按钮。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atelier', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (callback) => {
      const handler = (_event, value) => callback(Boolean(value));
      ipcRenderer.on('window:maximized', handler);
      return () => ipcRenderer.removeListener('window:maximized', handler);
    },
  },
  chooseDirectory: () => ipcRenderer.invoke('dialog:choose-directory'),
  openPath: (target) => ipcRenderer.invoke('shell:open-path', target),
});
