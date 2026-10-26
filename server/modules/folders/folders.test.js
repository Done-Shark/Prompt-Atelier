/**
 * 文件夹：重名、环检测、删除上移。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeTmpDir, openTestDb, rmDir } from '../../testing/helpers.js';
import { openDb } from '../../store/db.js';
import * as folders from './service.js';
import * as prompts from '../prompts/service.js';
import { ApiError } from '../../lib/errors.js';

test('创建与列表：order 递增、target 默认 all', async (t) => {
  const { db } = await openTestDb(t);
  const a = await folders.create(db, { name: '角色' });
  const b = await folders.create(db, { name: '场景', target: 'nai' });
  assert.equal(a.order, 0);
  assert.equal(b.order, 1);
  assert.equal(a.target, 'all');
  assert.equal(b.target, 'nai');
  assert.equal(folders.list(db).total, 2);
});

test('同级重名 409，不同父级允许同名', async (t) => {
  const { db } = await openTestDb(t);
  const parent = await folders.create(db, { name: '父级' });
  await folders.create(db, { name: '角色' });

  await assert.rejects(
    () => folders.create(db, { name: '角色' }),
    (err) => err instanceof ApiError && err.code === 'CONFLICT' && err.status === 409,
  );
  // 大小写与空白视为同名
  await assert.rejects(
    () => folders.create(db, { name: '  角色 ' }),
    (err) => err.code === 'CONFLICT',
  );

  const child = await folders.create(db, { name: '角色', parentId: parent.id });
  assert.equal(child.parentId, parent.id);
});

test('名称为空 400', async (t) => {
  const { db } = await openTestDb(t);
  await assert.rejects(
    () => folders.create(db, { name: '   ' }),
    (err) => err.code === 'VALIDATION',
  );
});

test('环检测：禁止自身为父级与父子互换', async (t) => {
  const { db } = await openTestDb(t);
  const root = await folders.create(db, { name: '根' });
  const child = await folders.create(db, { name: '子', parentId: root.id });
  const grandchild = await folders.create(db, { name: '孙', parentId: child.id });

  await assert.rejects(
    () => folders.update(db, root.id, { parentId: root.id }),
    (err) => err.code === 'VALIDATION',
  );
  await assert.rejects(
    () => folders.update(db, root.id, { parentId: child.id }),
    (err) => err.code === 'VALIDATION',
  );
  await assert.rejects(
    () => folders.update(db, root.id, { parentId: grandchild.id }),
    (err) => err.code === 'VALIDATION',
  );

  const moved = await folders.update(db, grandchild.id, { parentId: root.id });
  assert.equal(moved.parentId, root.id);
});

test('删除：子级上移一层，Prompt 的 folderId 置 null', async (t) => {
  const { db } = await openTestDb(t);
  const root = await folders.create(db, { name: '根' });
  const middle = await folders.create(db, { name: '中层', parentId: root.id });
  const child = await folders.create(db, { name: '子层', parentId: middle.id });

  await prompts.create(db, { target: 'nai', positive: 'a', folderId: middle.id });
  await prompts.create(db, { target: 'nai', positive: 'b', folderId: middle.id });
  await prompts.create(db, { target: 'nai', positive: 'c', folderId: child.id });

  const result = await folders.remove(db, middle.id);
  assert.deepEqual(result, { ok: true, movedPrompts: 2, movedImages: 0, movedCharacters: 0 });

  const list = folders.list(db).items;
  const movedChild = list.find((item) => item.id === child.id);
  assert.equal(movedChild.parentId, root.id);
  assert.equal(list.some((item) => item.id === middle.id), false);

  const orphan = prompts.list(db, { folderId: 'root' }).items;
  assert.equal(orphan.length, 2);
  assert.equal(prompts.list(db, { folderId: child.id }).total, 1);

  await assert.rejects(() => folders.remove(db, middle.id), (err) => err.code === 'NOT_FOUND');
});


test('RP 文件夹：重开数据库后 scope 仍是 rp', async (t) => {
  const dir = await makeTmpDir();
  t.after(() => rmDir(dir));
  const options = {
    dataDir: dir,
    dbFile: path.join(dir, 'db.json'),
    sqliteFile: path.join(dir, 'atelier.db'),
  };

  const db = await openDb(options);
  const folder = await folders.create(db, { name: '奇幻', scope: 'rp' });
  db.close();

  const reopened = await openDb(options);
  const items = folders.list(reopened, { scope: 'rp' }).items;
  reopened.close();

  assert.equal(items.length, 1);
  assert.equal(items[0].id, folder.id);
  assert.equal(items[0].scope, 'rp');
});
