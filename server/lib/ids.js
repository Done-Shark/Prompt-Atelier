/**
 * id 生成：短前缀 + 时间戳 + 随机片段，足够本地单用户避免碰撞。
 */
import { randomBytes } from 'node:crypto';

export function newId(prefix = 'x') {
  const time = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return `${prefix}_${time}${rand}`;
}

export function nowIso() {
  return new Date().toISOString();
}
