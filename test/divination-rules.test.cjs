const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../public/engine');
const { validateLegacyRequest, validateRequest, buildMessages } = require('../src/divination');
const { createDeepSeekClient } = require('../src/deepseek');
const { createServer } = require('../src/server');

const source = fs.readFileSync(path.join(__dirname, '../public/iching-data.js'), 'utf8').trim();
const textDB = JSON.parse(source.replace(/^const ICHING_TEXT\s*=\s*/, '').replace(/;$/, ''));
const at = new Date('2026-09-23T12:00:00+08:00');
function payload(backs = [3, 2, 2, 2, 2, 2]) {
  const cast = engine.cast(backs, at, textDB);
  return JSON.parse(JSON.stringify({ question: '下周的工作安排如何？', model: 'deepseek-flash', timestamp: cast.timestamp, cast }));
}

test('the server accepts a current complete cast without changing its idempotency hash', () => {
  const body = payload();
  const input = validateRequest(body);
  assert.deepEqual(Object.keys(input), ['question', 'timestamp', 'model', 'cast']);
  assert.deepEqual(JSON.parse(JSON.stringify(input.cast)), body.cast);
  assert.ok(input.canonicalCast);
  assert.equal(Object.prototype.propertyIsEnumerable.call(input, 'canonicalCast'), false);
});

test('new AI requests reject incomplete, contradictory, stale or forged casts and times', () => {
  const missing = payload();
  delete missing.cast.coins;
  assert.throws(() => validateRequest(missing), /卦盘/);

  const changedFlag = payload();
  changedFlag.cast.hasMove = false;
  assert.throws(() => validateRequest(changedFlag), /卦盘/);

  const changedText = payload();
  changedText.cast.ben.guaci = '伪造卦辞';
  assert.throws(() => validateRequest(changedText), /卦盘/);

  const changedPillar = payload();
  changedPillar.timestamp.pillars.day.text = '甲子';
  assert.throws(() => validateRequest(changedPillar), /卦盘|起卦时间/);

  const changedInstant = payload();
  changedInstant.timestamp.iso = '2026-09-24T12:00:00+08:00';
  assert.throws(() => validateRequest(changedInstant), /卦盘|起卦时间/);

  const oldCoinRule = payload();
  oldCoinRule.cast.ben.lines[1].yang = 1 - oldCoinRule.cast.ben.lines[1].yang;
  assert.throws(() => validateRequest(oldCoinRule), /卦盘/);
});

test('legacy normalization is read-only and retains former field order for completed-key replay', () => {
  const old = { question: '  问工作  ', model: 'deepseek-v4-flash',
    timestamp: { display: '旧起卦时刻', timezone: 'Asia/Shanghai', pillars: Object.fromEntries(
      ['year', 'month', 'day', 'hour'].map(key => [key, { text: '甲子', kong: ['戌', '亥'] }])) },
    cast: { ben: { name: '旧卦' } } };
  const input = validateLegacyRequest(old);
  assert.deepEqual(Object.keys(input), ['question', 'timestamp', 'model', 'cast']);
  assert.equal(input.question, '问工作');
  assert.equal(input.model, 'deepseek-flash');
  assert.deepEqual(input.cast, old.cast);
  assert.throws(() => validateRequest(old), /起卦时间|卦盘/);
});

test('AI receives the actual moving-to-changed branches, relatives and canonical line names', () => {
  const cast = payload().cast;
  const input = validateRequest(payload());
  const content = buildMessages(input)[1].content;
  const changed = cast.chg.lines[0];
  assert.match(content, /动变对应/);
  assert.ok(content.includes('化爻' + changed.liuqin + changed.gan + changed.zhi + changed.wx));
  assert.match(content, /纳甲判读基准：月建.+，日辰.+，日旬空/);
  assert.match(content, /五行关系：(比和|化爻回头生本爻|化爻回头克本爻|本爻生化爻|本爻克化爻)/);
  assert.match(content, /六二：/);
  assert.doesNotMatch(content, /二六：/);
  assert.match(content, /日柱：.*爻位空亡以此为准/);
  assert.match(content, /年柱：.*不作爻位空亡/);
  assert.match(buildMessages(input)[0].content, /先结合所测之事确定用神/);
  assert.match(buildMessages(input)[0].content, /月柱地支作月建、日柱地支作日辰/);
});

test('six moving lines of pure Qian or Kun include the special yong text', () => {
  assert.match(buildMessages(validateRequest(payload([3, 3, 3, 3, 3, 3])))[1].content, /全动特别断辞：用九/);
  assert.match(buildMessages(validateRequest(payload([0, 0, 0, 0, 0, 0])))[1].content, /全动特别断辞：用六/);
});

test('truncated or non-final upstream content is rejected even if it is non-empty', async () => {
  for (const finish_reason of ['length', 'content_filter', 'aborted', undefined]) {
    const complete = createDeepSeekClient({ apiKey: 'unit-test', fetchImpl: async () => ({
      ok: true, json: async () => ({ choices: [{ finish_reason, message: { content: '此卦宜' } }] })
    }) }).complete;
    await assert.rejects(complete({ model: 'deepseek-flash', messages: [] }), { code: 'UPSTREAM_INCOMPLETE' });
  }
  const complete = createDeepSeekClient({ apiKey: 'unit-test', fetchImpl: async () => ({
    ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '完整解读。' } }] })
  }) }).complete;
  assert.equal(await complete({ model: 'deepseek-flash', messages: [] }), '完整解读。');
});

test('an incomplete AI answer refunds its reserved credit rather than completing a charge', async t => {
  let reserved = 0, finished = 0, refunded = 0;
  const accounts = {
    settings: { quotaEnabled: true },
    current: async () => ({ id: 'user-1' }),
    reserve: async () => { reserved++; return { id: 1, userId: 'user-1', cached: false }; },
    finish: async () => { finished++; return 0; },
    refund: async () => { refunded++; }
  };
  const auditStore = { logVisit: async () => {}, logAIRecord: async () => {}, health: async () => ({ ok: true }) };
  const complete = createDeepSeekClient({ apiKey: 'unit-test', fetchImpl: async () => ({
    ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '未写完' } }] })
  }) }).complete;
  const server = createServer({ accounts, auditStore, complete, env: {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/divine', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload(), requestKey: 'incomplete-answer-0001' })
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'UPSTREAM_INCOMPLETE');
  assert.equal(reserved, 1);
  assert.equal(finished, 0);
  assert.equal(refunded, 1);
});
