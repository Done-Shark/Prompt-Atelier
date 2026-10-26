/**
 * Electron 主进程（CommonJS）。
 * Electron 的 ESM 主进程在部分版本无法正确解析 electron 内建模块，这里用 CJS，
 * 业务代码仍是 ESM，通过动态 import 复用同一套服务端实现。
 *
 * 生产：本进程内启动本地 HTTP 服务（随机端口，仅 127.0.0.1），窗口加载该地址。
 * 开发：加载 Vite（5173），由 Vite 把 /api 代理到独立的 8787 服务。
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');

const isDev = process.argv.includes('--dev');
// 打包后的 exe 会把未知 --flag 交给 Chromium 报错，因此同时支持环境变量
const isSmoke = process.argv.includes('--smoke') || process.env.ATELIER_SMOKE === '1';

// 无头验收环境没有可用 GPU，关闭硬件加速避免进程反复崩溃
if (isSmoke) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

/** @type {BrowserWindow | null} */
let win = null;
/** @type {http.Server | null} */
let server = null;

/**
 * 打包后的数据目录：
 * - 优先 PROMPT_ATELIER_DATA_DIR；
 * - 便携版放在 exe 同级的 data/（electron-builder 会注入 PORTABLE_EXECUTABLE_DIR）；
 * - 安装版放在用户数据目录，避免写入 Program Files。
 */
function resolveDataDir() {
  if (process.env.PROMPT_ATELIER_DATA_DIR) return process.env.PROMPT_ATELIER_DATA_DIR;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
  return path.join(app.getPath('userData'), 'data');
}

async function startServer() {
  const { createApp } = await import('../server/app.js');
  const dataDir = isDev ? undefined : resolveDataDir();
  if (dataDir) console.log(`[atelier] 数据目录：${dataDir}`);
  const { handler } = await createApp(dataDir ? { dataDir } : {});
  server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#141312',
    title: 'Prompt Atelier',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win && win.show());
  win.on('maximize', () => win && win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win && win.webContents.send('window:maximized', false));

  // 外链交给系统浏览器，窗口内不允许开新窗
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 只允许停留在本地页面，避免远程页面继承 preload 暴露的桥接能力
  win.webContents.on('will-navigate', (event, target) => {
    const allowed = isDev
      ? target.startsWith('http://127.0.0.1:5173') || target.startsWith('http://localhost:5173')
      : target.startsWith('http://127.0.0.1:');
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/i.test(target)) shell.openExternal(target);
    }
  });

  const url = isDev ? 'http://127.0.0.1:5173' : await startServer();
  console.log(`[atelier] 加载 ${url}`);
  if (!isDev) {
    const health = await fetch(`${url}/api/health`).then((res) => res.status).catch((error) => String(error));
    console.log(`[atelier] 本地服务健康检查：${health}`);
  }
  await win.loadURL(url);

  if (isSmoke) {
    // 验收模式：等首屏渲染后截图并退出，用于无头环境确认桌面壳可用。
    // 截图失败（无 GPU / 渲染进程崩溃）也退出，避免 CI 卡住。
    const fs = require('node:fs/promises');
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      try {
        const image = await win.webContents.capturePage();
        const target = app.isPackaged
          ? path.join(app.getPath('temp'), 'atelier-smoke.png')
          : path.join(__dirname, '..', '.qa', 'electron.png');
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, image.toPNG());
        console.log(`[atelier] 截图：${target}`);
      } catch (error) {
        console.log(`[atelier] 截图失败：${error && error.message ? error.message : error}`);
      } finally {
        app.quit();
      }
    };
    win.webContents.once('did-finish-load', () => setTimeout(finish, 2000));
    setTimeout(finish, 8000);
  } else if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

function registerIpc() {
  ipcMain.on('window:minimize', () => win && win.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => win && win.close());
  ipcMain.handle('window:is-maximized', () => (win ? win.isMaximized() : false));

  ipcMain.handle('dialog:choose-directory', async () => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: '选择图片目录',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle('shell:open-path', async (_event, target) => {
    if (typeof target !== 'string' || !target) return false;
    const error = await shell.openPath(target);
    return error === '';
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpc();
    await createWindow();
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (server) server.close();
    server = null;
  });
}
