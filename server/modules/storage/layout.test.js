/**
 * 镜像布局：文件名跟随原文件 / 文件夹链，搬文件夹后磁盘同步。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openTestDb } from '../../testing/helpers.js';
import { encodePng } from '../../media/pngEncode.js';
import { resolveInside } from '../../lib/fsx.js';
import * as folders from '../folders/service.js';
import * as images from '../images/service.js';
import * as characters from '../characters/service.js';
import { ensureMirroredStorage, planLayout, relayout } from './layout.js';

function png(color = [10, 20, 30]) {
  return encodePng({ width: 8, height: 8, pixel: () => color });
}

function makeCtx(db, dir) {
  return {
    db,
    config: { dataDir: dir, imagesDir: path.join(dir, 'images'), thumbsDir: path.join(dir, 'thumbs') },
  };
}

async function exists(file) {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

test('planLayout：文件夹链 + 原文件名 + 冲突加序号', () => {
  const data = {
    folders: [
      { id: 'f1', name: '场景', parentId: null },
      { id: 'f2', name: '雨夜', parentId: 'f1' },
    ],
    images: [
      { id: 'i1', target: 'nai', fileName: 'rain.png', ext: 'png', hash: 'a'.repeat(64), file: 'nai/a.png', folderId: 'f2' },
      { id: 'i2', target: 'nai', fileName: 'rain.png', ext: 'png', hash: 'b'.repeat(64), file: 'nai/b.png', folderId: 'f2' },
    ],
    characters: [{ id: 'c1', name: '塞拉', imageFile: 'rp/c.png', imageExt: 'png', folderId: null }],
  };
  const plan = planLayout(data);
  assert.equal(plan.images[0].rel, 'nai/场景/雨夜/rain.png');
  assert.equal(plan.images[1].rel, 'nai/场景/雨夜/rain (2).png');
  assert.equal(plan.characters[0].rel, 'rp/塞拉.png');
});

test('relayout：移动图片到文件夹后磁盘同步，改名文件夹也跟随', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = makeCtx(db, dir);
  const folder = await folders.create(db, { name: '场景', scope: 'image', target: 'nai' });

  await images.importImages(ctx, { files: [{ name: 'rain.png', data: png().toString('base64') }] });
  const before = db.snapshot().images[0];
  assert.equal(before.file, `nai/${before.hash}.png`);

  await images.update(ctx, before.id, { folderId: folder.id });
  await relayout(ctx);
  const moved = db.snapshot().images[0];
  assert.equal(moved.file, 'nai/场景/rain.png');
  assert.ok(await exists(resolveInside(ctx.config.imagesDir, moved.file)));
  assert.ok(!(await exists(resolveInside(ctx.config.imagesDir, before.file))));

  await folders.update(db, folder.id, { name: '外景' });
  await relayout(ctx);
  const renamed = db.snapshot().images[0];
  assert.equal(renamed.file, 'nai/外景/rain.png');
  assert.ok(await exists(resolveInside(ctx.config.imagesDir, renamed.file)));
});

test('relayout：角色卡按角色名存放，移入文件夹后路径变化', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = makeCtx(db, dir);
  const folder = await folders.create(db, { name: '北境', scope: 'rp' });

  const card = await characters.create(ctx, { name: '塞拉', image: png().toString('base64') });
  assert.match(card.imageFile, /^rp\/[a-f0-9]{64}\.png$/);

  await characters.update(ctx, card.id, { folderId: folder.id });
  await relayout(ctx);
  const moved = db.snapshot().characters[0];
  assert.equal(moved.imageFile, 'rp/北境/塞拉.png');
  assert.ok(await exists(resolveInside(ctx.config.imagesDir, moved.imageFile)));
});

test('ensureMirroredStorage：旧扁平记录迁移并打标记', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = makeCtx(db, dir);
  const folder = await folders.create(db, { name: '场景', scope: 'image', target: 'nai' });

  const hash = 'c'.repeat(64);
  const rel = `nai/${hash}.png`;
  await fs.mkdir(path.join(ctx.config.imagesDir, 'nai'), { recursive: true });
  await fs.writeFile(resolveInside(ctx.config.imagesDir, rel), png());
  await db.mutate((data) => {
    data.images.push({
      id: 'i_legacy',
      target: 'nai',
      fileName: 'legacy.png',
      ext: 'png',
      hash,
      file: rel,
      folderId: folder.id,
      metadata: { format: 'unknown' },
    });
  });

  await ensureMirroredStorage(ctx);
  const snap = db.snapshot();
  assert.equal(snap.settings.storageLayout, 'mirrored');
  assert.equal(snap.images[0].file, 'nai/场景/legacy.png');
  assert.ok(await exists(resolveInside(ctx.config.imagesDir, 'nai/场景/legacy.png')));
  assert.ok(!(await exists(resolveInside(ctx.config.imagesDir, rel))));
});
