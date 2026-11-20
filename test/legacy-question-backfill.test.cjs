const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { legacyAuditHash, backfillAccountQuestions } = require('../src/legacy-question-backfill');

function auditRow(id, input) {
  return { id, created_at: new Date('2026-09-22T01:02:03Z'), question: input.question,
    model: input.model, timestamp_json: JSON.stringify(input.timestamp), cast_json: JSON.stringify(input.cast) };
}

test('legacy hash matches only the original validated payload, including full cast and timestamp', () => {
  const input = { question: '工作安排如何？', timestamp: { display: '2026-09-22 09:02:03', timezone: 'Asia/Shanghai' },
    model: 'deepseek-flash', cast: { ben: { name: '乾', lines: [1, 2] }, moving: [true, false] } };
  const row = auditRow(1, input);
  assert.equal(legacyAuditHash(row), crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'));
  assert.notEqual(legacyAuditHash({ ...row, question: '别的问题' }), legacyAuditHash(row));
  assert.equal(legacyAuditHash({ ...row, cast_json: '{bad json' }), null);
});

test('historical backfill links exact unique requests only, skips shared payloads, and can rerun', async () => {
  const input = { question: '工作安排如何？', timestamp: { display: '2026-09-22 09:02:03' }, model: 'deepseek-flash', cast: { ben: { name: '乾' } } };
  const shared = { ...input, question: '两个人提出的相同问题' };
  const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const reserveAt = new Date('2026-09-22T01:01:00Z');
  const requests = [
    { id: 11, user_id: 'user-one', payload_hash: hash(input), reserve_at: reserveAt },
    { id: 12, user_id: 'user-two', payload_hash: hash(shared), reserve_at: reserveAt },
    { id: 13, user_id: 'user-three', payload_hash: hash(shared), reserve_at: reserveAt },
    { id: 14, user_id: 'user-four', payload_hash: 'a'.repeat(64), reserve_at: reserveAt }
  ];
  const audit = [auditRow(100, input), auditRow(101, shared), { ...auditRow(102, input), cast_json: '{bad json' }];
  const linked = new Set();
  const inserts = [];
  const pool = {
    async query(sql) {
      if (sql.includes('FROM credit_requests')) return [requests];
      if (sql.includes('FROM account_questions')) return [[...linked].map(credit_request_id => ({ credit_request_id }))];
      throw new Error('Unexpected query: ' + sql);
    },
    async execute(sql, args) {
      if (sql.includes('FROM ai_records')) return [audit.filter(row => row.id > Number(args[0]))];
      if (sql.startsWith('INSERT INTO account_questions')) { inserts.push(args); linked.add(String(args[0])); return [{}]; }
      throw new Error('Unexpected execute: ' + sql);
    }
  };
  const first = await backfillAccountQuestions(pool);
  assert.equal(first.matched, 1);
  assert.equal(first.ambiguous, 1);
  assert.deepEqual(inserts.map(row => row[0]), [11]);
  assert.equal(inserts[0][1], 'user-one');
  assert.equal(inserts[0][2], input.question);
  assert.equal(inserts[0][3], input.timestamp.display);
  assert.equal(inserts[0][4], reserveAt);
  const second = await backfillAccountQuestions(pool);
  assert.equal(second.matched, 0);
  assert.equal(inserts.length, 1);
});
