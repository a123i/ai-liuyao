const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequestTelemetry } = require('../src/ai-telemetry');

const ID = '29b975d8-c084-438f-9234-4a7d3d2cb001';
function harness(options = {}) {
  const lines = [];
  let time = 100;
  const trace = createRequestTelemetry({ requestId: ID, log: line => lines.push(line), now: () => time, ...options });
  return { trace, lines, tick: value => { time = value; }, records: () => lines.map(line => JSON.parse(line.slice('[ai_trace] '.length))) };
}

test('AI stage traces have one bounded JSON line and the server-generated correlation ID', () => {
  const h = harness();
  h.tick(112.3);
  assert.equal(h.trace.emit({ event: 'stage_start', stage: 'professional', call: 1, status: 'started' }), true);
  h.tick(141.5);
  h.trace.emit({ event: 'stage_end', stage: 'professional', call: 1, duration_ms: 29.2, status: 'success' });
  assert.deepEqual(h.records(), [
    { schema_version: 1, request_id: ID, event: 'stage_start', elapsed_ms: 12, stage: 'professional', status: 'started', call: 1 },
    { schema_version: 1, request_id: ID, event: 'stage_end', elapsed_ms: 42, stage: 'professional', status: 'success', call: 1, duration_ms: 29 }
  ]);
  assert.ok(h.lines.every(line => line.startsWith('[ai_trace] {') && !/[\r\n]/.test(line)));
});

test('only safe timing, provider usage, codes and repair summaries can enter telemetry', () => {
  const h = harness();
  const secret = 'sk-never-log-this-secret';
  h.trace.emit({ event: 'provider_metrics', stage: 'review', call: 3, status: 'failed', code: 'UPSTREAM_TIMEOUT',
    duration_ms: 85000, http_status: 200, time_to_headers_ms: 140.4, body_ms: 84859.6,
    prompt_tokens: 1000, completion_tokens: 2000, reasoning_tokens: 1990, issue_count: 2,
    repair_count: 1, repair_scope: 'professional', request_id: secret, schema_version: secret,
    question: '用户的私人问题', draft: secret, providerbody: secret, key: secret,
    message: secret, error: { message: secret }, issues: [secret], headers: { Authorization: secret } });
  const [record] = h.records();
  assert.deepEqual(record, { schema_version: 1, request_id: ID, event: 'provider_metrics', elapsed_ms: 0,
    stage: 'review', status: 'failed', code: 'UPSTREAM_TIMEOUT', repair_scope: 'professional', call: 3,
    duration_ms: 85000, issue_count: 2, repair_count: 1, http_status: 200,
    time_to_headers_ms: 140, body_ms: 84860, prompt_tokens: 1000, completion_tokens: 2000, reasoning_tokens: 1990 });
  assert.doesNotMatch(h.lines.join(''), /sk-never|私人|Authorization|"headers":|providerbody|"issues"|"message"/);
});

test('telemetry omits arbitrary strings, control characters and invalid numeric fields', () => {
  const h = harness();
  h.trace.emit({ event: 'stage_error', stage: 'professional\nsecret', status: 'oops', code: 'sk-secret', repair_scope: 'any',
    call: 1.2, duration_ms: Infinity, issue_count: 9, repair_count: -1, http_status: 999,
    time_to_headers_ms: '12', body_ms: NaN, prompt_tokens: 10000001, completion_tokens: -1, reasoning_tokens: 1.5 });
  assert.deepEqual(h.records(), [{ schema_version: 1, request_id: ID, event: 'stage_error', elapsed_ms: 0 }]);
  for (const input of [undefined, null, [], 'stage_end', { event: 'anything' }, { event: 'request_end' }, { event: 'stage_start\nsecret' }]) {
    assert.equal(h.trace.emit(input), false);
  }
  assert.equal(h.lines.length, 1);
});

test('request termination logs once, cannot spoof identity, and closes future emission', () => {
  const h = harness();
  h.tick(200);
  assert.equal(h.trace.finish({ event: 'stage_error', status: 'failed', stage: 'review', code: 'AI_REVIEW_PROTOCOL',
    request_id: 'sk-secret', schema_version: 900, elapsed_ms: 0, duration_ms: 100, issue_count: 1 }), true);
  assert.equal(h.trace.finish('success'), false);
  assert.equal(h.trace.emit({ event: 'stage_end', stage: 'review', status: 'success' }), false);
  assert.deepEqual(h.records(), [{ schema_version: 1, request_id: ID, event: 'request_end', elapsed_ms: 100,
    stage: 'review', status: 'failed', code: 'AI_REVIEW_PROTOCOL', duration_ms: 100, issue_count: 1 }]);
  const other = harness(); other.trace.finish('success');
  assert.equal(other.records()[0].status, 'success');
  const unknown = harness(); unknown.trace.finish();
  assert.equal(unknown.records()[0].status, 'unknown');
});

test('invalid correlation input is not logged while the existing fallback ID remains usable', () => {
  for (const requestId of ['private question', 'sk-private-key', 'a\nrequest', 'x'.repeat(1000), null]) {
    const h = harness({ requestId }); h.trace.finish('failed');
    assert.equal(h.records()[0].request_id, '[unavailable]');
    assert.ok(h.lines[0].length < 160);
  }
  const fallback = harness({ requestId: 'req_1792570000000_abcdef' });
  fallback.trace.finish('success');
  assert.equal(fallback.records()[0].request_id, 'req_1792570000000_abcdef');
});

test('clock failures and backwards movement never leak or regress elapsed time', () => {
  let time = 100;
  const h = harness({ now: () => { if (time === 'error') throw new Error('private clock message'); return time; } });
  time = 125.4; h.trace.emit({ event: 'stage_start' });
  time = 102; h.trace.emit({ event: 'stage_end' });
  time = Infinity; h.trace.emit({ event: 'stage_end' });
  time = 'error'; h.trace.emit({ event: 'stage_end' });
  time = 5000000; h.trace.finish('failed');
  assert.deepEqual(h.records().map(record => record.elapsed_ms), [25, 25, 25, 25, 3600000]);
  assert.doesNotMatch(h.lines.join(''), /private clock/);
});

test('sync and async logger failures never change the outcome or reopen a finished trace', async () => {
  for (const log of [() => { throw new Error('logger failed'); }, async () => { throw new Error('async logger failed'); }, null]) {
    const h = harness({ log });
    assert.doesNotThrow(() => h.trace.emit({ event: 'stage_start', stage: 'review' }));
    assert.doesNotThrow(() => h.trace.finish('success'));
    assert.equal(h.trace.finish('failed'), false);
  }
  await new Promise(resolve => setImmediate(resolve));
});

test('hostile property getters cannot inject data or break operational tracing', () => {
  const h = harness();
  const event = { event: 'validation_error', stage: 'validation' };
  Object.defineProperty(event, 'duration_ms', { get() { throw new Error('never expose'); } });
  assert.doesNotThrow(() => h.trace.emit(event));
  assert.equal(h.records()[0].event, 'validation_error');
  assert.equal(h.records()[0].duration_ms, undefined);
  const end = { status: 'success' };
  Object.defineProperty(end, 'error', { enumerable: true, get() { throw new Error('never enumerate raw errors'); } });
  Object.defineProperty(end, 'code', { enumerable: true, get() { throw new Error('never expose a code getter'); } });
  assert.doesNotThrow(() => h.trace.finish(end));
  assert.equal(h.records()[1].status, 'success');
  assert.equal(h.records()[1].code, undefined);
});
