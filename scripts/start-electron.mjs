/**
 * Electron 启动器。
 * 某些开发环境会设置 ELECTRON_RUN_AS_NODE=1，导致 Electron 退化成普通 Node，
 * require('electron') 只返回二进制路径、app 为 undefined。这里启动前剔除该变量。
 */
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
