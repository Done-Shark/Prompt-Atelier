/**
 * Prompt 字段 schema：落库字段与共享定义一致，未知字段被忽略。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_FIELD_KEYS } from '../../../shared/prompt/fields.js';
import { openTestDb } from '../../testing/helpers.js';
import * as prompts from './service.js';

const META_KEYS = ['id', 'usageCount', 'lastUsedAt', 'createdAt', 'updatedAt'];

test('创建：落库字段与 PROMPT_FIELD_KEYS 完全一致', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, { target: 'nai', positive: '1girl, solo' });
  const keys = Object.keys(prompt).filter((key) => !META_KEYS.includes(key)).sort();
  assert.deepEqual(keys, [...PROMPT_FIELD_KEYS].sort());
});

test('创建与修改：未知字段被忽略，枚举外回落默认值', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, {
    target: 'nai',
    positive: '1girl',
    origin: 'hacked',
    bogus: 'x',
  });
  assert.equal('bogus' in prompt, false);
  assert.equal(prompt.origin, 'manual');

  const patched = await prompts.update(db, prompt.id, { bogus: 'y', favorite: true });
  assert.equal('bogus' in patched, false);
  assert.equal(patched.favorite, true);
});

test('长度上限来自共享 schema：超长直接拒绝', async (t) => {
  const { db } = await openTestDb(t);
  const ok = await prompts.create(db, { target: 'nai', positive: '1girl', notes: 'x'.repeat(10000) });
  assert.equal(ok.notes.length, 10000);

  await assert.rejects(
    () => prompts.create(db, { target: 'nai', positive: '1girl', notes: 'x'.repeat(10001) }),
    /长度不能超过 10000/,
  );
});
