/**
 * HTTP 工具：请求体读取、JSON 响应、CORS、静态文件与 SPA 回退。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from './errors.js';
import { isInside } from './fsx.js';

const MAX_BODY = 32 * 1024 * 1024; // 上传图片走 base64，给足余量

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const CORS_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

/** 读取并解析 JSON 请求体；空体视为 {} */
export async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      throw ApiError.validation('请求体过大');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw ApiError.validation('请求体不是合法 JSON');
  }
}

export function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendBuffer(res, status, buffer, contentType, headers = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    ...headers,
  });
  res.end(buffer);
}

export function sendHtml(res, status, html, headers = {}) {
  sendBuffer(res, status, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8', {
    // 桌面壳只加载本地页面，禁止外部脚本与内联脚本
    'Content-Security-Policy': HTML_CSP,
    ...headers,
  });
}

export const HTML_CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/** 仅对 /api/* 且来源在白名单内的请求加 CORS 头 */
export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !CORS_ORIGINS.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

export function contentTypeFor(ext) {
  return MIME[ext.toLowerCase()] || 'application/octet-stream';
}

/** 以流的方式返回文件；不存在返回 false 交给调用方回退 */
export async function sendFile(res, filePath, headers = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': contentTypeFor(path.extname(filePath)),
    'Content-Length': stat.size,
    ...headers,
  });
  await new Promise((resolve) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.destroy();
      resolve();
    });
    stream.on('end', resolve);
    stream.pipe(res);
  });
  return true;
}

/** 解析静态资源路径，越界返回 null */
export function resolveStatic(root, pathname) {
  const rel = pathname.replace(/^\/+/, '');
  const abs = path.resolve(root, rel);
  if (!isInside(root, abs)) return null;
  return abs;
}

export const NO_DIST_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Prompt Atelier</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#fbfbfa;color:#1c1c1c;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
main{max-width:520px;padding:32px;line-height:1.7}h1{font-size:18px;margin:0 0 12px}p{margin:8px 0;color:#444}
code{background:#f0efec;border-radius:4px;padding:2px 6px;font-family:ui-monospace,Menlo,monospace;font-size:13px}</style></head>
<body><main><h1>Prompt Atelier 后端已启动</h1>
<p>前端构建产物 <code>web/dist</code> 尚未生成。</p>
<p>开发模式：运行 <code>npm run dev</code>，然后打开 <code>http://localhost:5173</code>。</p>
<p>生产模式：运行 <code>npm run build</code> 后刷新本页。</p>
<p>接口可用：<code>/api/health</code></p></main></body></html>`;
