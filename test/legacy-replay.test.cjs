const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createAccounts } = require('../src/accounts');
const { createServer } = require('../src/server');
const { validateLegacyRequest, validateRequest } = require('../src/divination');
const engine = require('../public/engine');

const source = fs.readFileSync(path.join(__dirname, '../public/iching-data.js'), 'utf8').trim();
const textDB = JSON.parse(source.replace(/^const ICHING_TEXT\s*=\s*/, '').replace(/;$/, ''));
const key = 'legacy-replay-0001';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function legacyPayload() {
  const cast = engine.cast([3, 2, 2, 2, 2, 2], new Date('2026-09-23T12:00:00+08:00'), textDB);
  const body = JSON.parse(JSON.stringify({ question: '求职是否顺利？', model: 'deepseek-flash', timestamp: cast.timestamp, cast, requestKey: key }));
  body.cast.ben.guaci = '旧客户端的原始排盘文本';
  assert.throws(() => validateRequest(body), /卦盘/);
  return body;
}

test('account replay reads only the exact completed request hash without writing or reserving', async () => {
  const body = legacyPayload();
  const normalized = validateLegacyRequest(body);
  const executed = [];
  const pool = {
    async query(sql) { assert.match(sql, /^CREATE TABLE/); return [{}]; },
    async execute(sql, args) {
      executed.push({ sql, args });
      if (sql.includes('FROM credit_requests')) return [[{
        payload_hash: hash(normalized), status: 'completed', answer: '原先已付费的完整答复', model: 'deepseek-flash'
      }]];
      if (sql.includes('FROM app_users')) return [[{ credits: 2 }]];
      throw new Error('Unexpected SQL: ' + sql);
    },
    getConnection() { throw new Error('Read-only replay must not begin a transaction'); }
  };
  const accounts = createAccounts({ auditStore: { enabled: true, ready: async () => {}, getPool: () => pool }, env: {} });
  assert.deepEqual(await accounts.replayCompleted('user-1', key, normalized), {
    cached: true, answer: '原先已付费的完整答复', model: 'deepseek-flash', credits: 2
  });
  assert.equal(executed.length, 2);
  assert.match(executed[0].sql, /^SELECT/);
  assert.match(executed[1].sql, /^SELECT/);
  assert.deepEqual(executed[0].args, ['user-1', key]);
});

test('account replay refuses invalid keys, mismatched payloads, pending requests and absent users', async () => {
  const body = legacyPayload();
  const normalized = validateLegacyRequest(body);
  let status = 'completed', savedHash = hash(normalized), rowPresent = true, userPresent = true;
  const pool = {
    async query() { return [{}]; },
    async execute(sql) {
      if (sql.includes('FROM credit_requests')) return [rowPresent ? [{
        payload_hash: savedHash, status, answer: '旧答复', model: 'deepseek-flash'
      }] : []];
      if (sql.includes('FROM app_users')) return [userPresent ? [{ credits: 2 }] : []];
      throw new Error('Unexpected SQL');
    },
    getConnection() { throw new Error('Replay must remain read-only'); }
  };
  const accounts = createAccounts({ auditStore: { enabled: true, ready: async () => {}, getPool: () => pool }, env: {} });
  assert.equal(await accounts.replayCompleted('user-1', 'bad', normalized), null);
  assert.equal(await accounts.replayCompleted('user-1', key, { ...normalized, question: '不同的问题' }), null);
  savedHash = hash(normalized); status = 'pending';
  assert.equal(await accounts.replayCompleted('user-1', key, normalized), null);
  status = 'failed';
  assert.equal(await accounts.replayCompleted('user-1', key, normalized), null);
  status = 'completed'; rowPresent = false;
  assert.equal(await accounts.replayCompleted('user-1', key, normalized), null);
  rowPresent = true; userPresent = false;
  assert.equal(await accounts.replayCompleted('user-1', key, normalized), null);
});

async function listening(t, accounts, complete) {
  const auditStore = { logVisit: async () => {}, logAIRecord: async () => {}, health: async () => ({ ok: true }) };
  const server = createServer({ accounts, auditStore, complete, env: {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  return 'http://127.0.0.1:' + server.address().port;
}
async function divine(url, body) {
  const response = await fetch(url + '/api/divine', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('HTTP serves only a completed legacy answer, without a second reserve or AI call', async t => {
  const body = legacyPayload();
  let current = 0, replay = 0, reserve = 0, complete = 0;
  const accounts = {
    settings: { quotaEnabled: true },
    current: async () => { current++; return { id: 'user-1' }; },
    replayCompleted: async (userId, requestKey, normalized) => {
      replay++;
      assert.equal(userId, 'user-1');
      assert.equal(requestKey, key);
      assert.equal(hash(normalized), hash(validateLegacyRequest(body)));
      return { cached: true, answer: '原先已付费的完整答复', model: 'deepseek-flash', credits: 2 };
    },
    reserve: async () => { reserve++; throw new Error('Must not reserve'); }
  };
  const url = await listening(t, accounts, async () => { complete++; return 'new answer'; });
  assert.deepEqual(await divine(url, body), { status: 200, body: {
    cached: true, answer: '原先已付费的完整答复', model: 'deepseek-flash', credits: 2
  } });
  assert.equal(current, 1);
  assert.equal(replay, 1);
  assert.equal(reserve, 0);
  assert.equal(complete, 0);
});

test('HTTP rejects unmatched or invalid legacy payloads before charging or calling AI', async t => {
  const body = legacyPayload();
  let replay = 0, reserve = 0, complete = 0;
  const accounts = {
    settings: { quotaEnabled: true },
    current: async () => ({ id: 'user-1' }),
    replayCompleted: async () => { replay++; return null; },
    reserve: async () => { reserve++; throw new Error('Must not reserve'); }
  };
  const url = await listening(t, accounts, async () => { complete++; return 'new answer'; });
  const unmatched = await divine(url, body);
  assert.equal(unmatched.status, 400);
  assert.match(unmatched.body.error, /卦盘/);
  assert.equal(replay, 1);
  const invalid = await divine(url, { ...body, question: '' });
  assert.equal(invalid.status, 400);
  assert.equal(replay, 1);
  assert.equal(reserve, 0);
  assert.equal(complete, 0);
});
