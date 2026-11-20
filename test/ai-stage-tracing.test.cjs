const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../src/server');
const { payload, validDraft, professionalDraft, isPlain, isReview, passingReview } = require('./grounded-fixture.cjs');

const PRIVATE = {
  question: 'sentinel_question_content', draft: 'sentinel_draft_content',
  answer: 'sentinel_answer_content', review: 'sentinel_review_content',
  key: 'sentinel_provider_key'
};

function fixture() {
  const raw = payload(undefined, '用户的私密测试问题 ' + PRIVATE.question);
  const draft = validDraft(raw);
  draft.useful.reason += ' 私密专业文本 ' + PRIVATE.draft;
  draft.plain.answer += ' ' + PRIVATE.answer;
  const state = { credits: 3, reserve: 0, finish: 0, refund: 0, audits: [], calls: [] };
  const completed = new Map();
  const accounts = {
    settings: { quotaEnabled: true },
    current: async () => ({ id: 'user-1', credits: state.credits }),
    reserve: async (_user, key) => {
      state.reserve++;
      if (completed.has(key)) return { cached: true, answer: completed.get(key), model: 'deepseek-flash', credits: state.credits };
      state.credits--;
      return { id: 1, key, cached: false };
    },
    finish: async (reservation, answer) => { state.finish++; completed.set(reservation.key, answer); return state.credits; },
    refund: async () => { state.refund++; state.credits++; }
  };
  const auditStore = {
    logVisit: async () => {}, health: async () => ({ ok: true }),
    logAIRecord: async row => { state.audits.push(row); }
  };
  const emitProvider = request => request.onMetrics?.({ durationMs: 14, httpStatus: 200,
    timeToHeadersMs: 3, bodyMs: 11, usage: { promptTokens: 100, completionTokens: 40, reasoningTokens: 30 },
    apiKey: PRIVATE.key, body: PRIVATE.review, question: PRIVATE.question });
  const validComplete = async request => {
    state.calls.push(request);
    emitProvider(request);
    if (isReview(request)) return passingReview();
    return JSON.stringify(isPlain(request) ? draft.plain : professionalDraft(draft));
  };
  return { raw, draft, state, accounts, auditStore, emitProvider, validComplete };
}

async function listening(t, f, { complete = f.validComplete, env = {}, traceLog } = {}) {
  const lines = [];
  const log = traceLog || (line => lines.push(line));
  const server = createServer({ env, complete, accounts: f.accounts, auditStore: f.auditStore, traceLog: log });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  return { url: 'http://127.0.0.1:' + server.address().port,
    records: () => lines.filter(line => line.startsWith('[ai_trace] ')).map(line => JSON.parse(line.slice('[ai_trace] '.length))) };
}

async function divine(url, raw, requestKey) {
  const response = await fetch(url + '/api/divine', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...raw, requestKey }) });
  return { status: response.status, body: await response.json(), requestId: response.headers.get('x-request-id') };
}

function correlated(records, result, expectedStatus) {
  assert.ok(result.requestId);
  assert.ok(records.length);
  assert.ok(records.every(record => record.request_id === result.requestId && record.schema_version === 1));
  const ends = records.filter(record => record.event === 'request_end');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].status, expectedStatus);
  assert.equal(records.at(-1).event, 'request_end');
  const json = JSON.stringify(records);
  for (const sentinel of Object.values(PRIVATE)) assert.ok(!json.includes(sentinel), sentinel);
  assert.doesNotMatch(json, /"(?:question|draft|answer|issues|message|headers|apiKey|Authorization|body)":/);
  assert.ok(records.every(record => Number.isInteger(record.elapsed_ms) && record.elapsed_ms >= 0));
  assert.ok(records.every((record, index) => !index || record.elapsed_ms >= records[index - 1].elapsed_ms));
}

function pairedRepair(records, scope, status) {
  const starts = records.filter(record => record.event === 'repair_start');
  const ends = records.filter(record => record.event === 'repair_end');
  assert.equal(starts.length, 1);
  assert.equal(ends.length, 1);
  assert.equal(starts[0].repair_scope, scope);
  assert.equal(ends[0].repair_scope, scope);
  assert.equal(ends[0].repair_count, starts[0].repair_count);
  assert.equal(ends[0].status, status);
  assert.ok(Number.isInteger(ends[0].duration_ms) && ends[0].duration_ms >= 0);
  assert.ok(records.indexOf(ends[0]) > records.indexOf(starts[0]));
}

test('HTTP stage and provider traces correlate to request headers without leaking generated or user content', async t => {
  const f = fixture(), h = await listening(t, f);
  const result = await divine(h.url, f.raw, 'trace-success-000000001');
  assert.equal(result.status, 200);
  const records = h.records(); correlated(records, result, 'success');
  assert.deepEqual(records.filter(record => record.event === 'stage_start').map(record => record.stage), ['professional', 'plain', 'review']);
  assert.deepEqual(records.filter(record => record.event === 'stage_end').map(record => record.call), [1, 2, 3]);
  const providers = records.filter(record => record.event === 'provider_metrics');
  assert.equal(providers.length, 3);
  for (const metric of providers) {
    assert.equal(metric.http_status, 200); assert.equal(metric.duration_ms, 14);
    assert.equal(metric.time_to_headers_ms, 3); assert.equal(metric.body_ms, 11);
    assert.equal(metric.prompt_tokens, 100); assert.equal(metric.completion_tokens, 40); assert.equal(metric.reasoning_tokens, 30);
  }
  assert.equal(f.state.reserve, 1); assert.equal(f.state.finish, 1); assert.equal(f.state.refund, 0); assert.equal(f.state.credits, 2);
  assert.equal(f.state.audits.length, 1); assert.equal(f.state.audits[0].success, true);
});

test('HTTP quality rejection traces validation and repair boundaries, finishes once and refunds once', async t => {
  const f = fixture();
  const h = await listening(t, f, { complete: async request => {
    f.state.calls.push(request); f.emitProvider(request);
    return JSON.stringify({ schema_version: '1', private: PRIVATE.draft });
  } });
  const result = await divine(h.url, f.raw, 'trace-quality-000000001');
  assert.equal(result.status, 502); assert.equal(result.body.code, 'AI_QUALITY_ERROR');
  const records = h.records(); correlated(records, result, 'failed');
  assert.equal(records.filter(record => record.event === 'validation_error').length, 2);
  assert.equal(records.filter(record => record.event === 'stage_error').length, 2);
  assert.deepEqual(records.filter(record => record.event === 'repair_start').map(record => record.repair_scope), ['professional']);
  pairedRepair(records, 'professional', 'failed');
  assert.equal(records.find(record => record.event === 'repair_end').code, 'AI_QUALITY_ERROR');
  assert.equal(records.at(-1).stage, 'professional'); assert.equal(records.at(-1).code, 'AI_QUALITY_ERROR');
  assert.equal(f.state.calls.length, 2); assert.equal(f.state.reserve, 1); assert.equal(f.state.finish, 0); assert.equal(f.state.refund, 1);
  assert.equal(f.state.credits, 3); assert.equal(f.state.audits[0].success, false);
});

test('HTTP reviewer protocol repair traces only the repeated review, never professional or plain regeneration', async t => {
  const f = fixture(); let reviews = 0;
  const h = await listening(t, f, { complete: async request => {
    if (isReview(request)) {
      f.state.calls.push(request); f.emitProvider(request); reviews++;
      return reviews === 1 ? JSON.stringify({ verdict: 'revise', issues: [{ unknown: PRIVATE.review }] }) : passingReview();
    }
    return f.validComplete(request);
  } });
  const result = await divine(h.url, f.raw, 'trace-protocol-000000001');
  assert.equal(result.status, 200);
  const records = h.records(); correlated(records, result, 'success');
  assert.deepEqual(records.filter(record => record.event === 'stage_start').map(record => record.stage), ['professional', 'plain', 'review', 'review_format']);
  const invalid = records.find(record => record.event === 'validation_error');
  assert.equal(invalid.stage, 'review'); assert.equal(invalid.code, 'AI_REVIEW_PROTOCOL');
  assert.deepEqual(records.filter(record => record.event === 'repair_start').map(record => record.repair_scope), ['protocol']);
  pairedRepair(records, 'protocol', 'completed');
  assert.equal(records.find(record => record.event === 'repair_end').stage, 'review_format');
  assert.equal(f.state.calls.length, 4); assert.equal(f.state.finish, 1); assert.equal(f.state.refund, 0); assert.equal(f.state.credits, 2);
});

test('HTTP a plain-only semantic rejection traces its scope and preserves already validated professional content', async t => {
  const f = fixture(); let reviews = 0, plains = 0;
  const revisedAnswer = '尚不能确定结果，建议先完成一个可以检查的小目标。';
  const h = await listening(t, f, { complete: async request => {
    if (isReview(request)) {
      f.state.calls.push(request); f.emitProvider(request); reviews++;
      return reviews === 1 ? JSON.stringify({ verdict: 'revise', issues: [{ scope: 'plain', target: 'plain.answer',
        message: '直接回答需要明确建议动作 ' + PRIVATE.review, evidence: [f.draft.useful.evidence[0]] }] }) : passingReview();
    }
    if (isPlain(request)) {
      f.state.calls.push(request); f.emitProvider(request); plains++;
      assert.deepEqual(JSON.parse(request.messages[1].content).professional, professionalDraft(f.draft));
      return JSON.stringify(plains === 2 ? { ...f.draft.plain, answer: revisedAnswer } : f.draft.plain);
    }
    return f.validComplete(request);
  } });
  const result = await divine(h.url, f.raw, 'trace-plain-scope-000001');
  assert.equal(result.status, 200); assert.ok(result.body.answer.includes(revisedAnswer));
  const records = h.records(); correlated(records, result, 'success');
  assert.deepEqual(records.filter(record => record.event === 'stage_start').map(record => record.stage),
    ['professional', 'plain', 'review', 'plain', 'review']);
  const rejection = records.find(record => record.event === 'review_rejected');
  assert.equal(rejection.stage, 'review'); assert.equal(rejection.call, 3); assert.equal(rejection.issue_count, 1);
  assert.deepEqual(records.filter(record => record.event === 'repair_start').map(record => record.repair_scope), ['plain']);
  pairedRepair(records, 'plain', 'completed');
  assert.equal(records.find(record => record.event === 'repair_end').stage, 'plain');
  assert.equal(f.state.calls.length, 5); assert.equal(f.state.finish, 1); assert.equal(f.state.refund, 0); assert.equal(f.state.credits, 2);
});

test('HTTP an expired shared deadline identifies the stage and refunds without advancing the pipeline', async t => {
  const f = fixture();
  const h = await listening(t, f, { env: { AI_TIMEOUT_MS: '1000' }, complete: async request => {
    f.state.calls.push(request);
    await new Promise(resolve => setTimeout(resolve, 1100));
    request.onMetrics?.({ durationMs: 1100, httpStatus: 200, errorCode: 'UPSTREAM_TIMEOUT' });
    return JSON.stringify(professionalDraft(f.draft));
  } });
  const result = await divine(h.url, f.raw, 'trace-timeout-000000001');
  assert.equal(result.status, 504); assert.equal(result.body.code, 'UPSTREAM_TIMEOUT');
  const records = h.records(); correlated(records, result, 'timeout');
  assert.equal(records.filter(record => record.event === 'stage_start').length, 1);
  assert.equal(records.at(-1).stage, 'professional'); assert.equal(records.at(-1).code, 'UPSTREAM_TIMEOUT');
  assert.ok(records.at(-1).elapsed_ms >= 1000);
  assert.equal(f.state.finish, 0); assert.equal(f.state.refund, 1); assert.equal(f.state.credits, 3);
});

test('HTTP a completed cache read gets its own terminal correlation record but no stages or new charge', async t => {
  const f = fixture(), h = await listening(t, f);
  const first = await divine(h.url, f.raw, 'trace-cached-0000000001');
  assert.equal(first.status, 200);
  const result = await divine(h.url, f.raw, 'trace-cached-0000000001');
  assert.equal(result.status, 200); assert.equal(result.body.cached, true);
  assert.notEqual(result.requestId, first.requestId);
  const records = h.records().filter(record => record.request_id === result.requestId); correlated(records, result, 'cached');
  assert.deepEqual(records.map(record => record.event), ['request_end']);
  assert.equal(f.state.calls.length, 3); assert.equal(f.state.finish, 1); assert.equal(f.state.refund, 0); assert.equal(f.state.credits, 2);
});

test('HTTP historical replay is traced as cached while preserving the raw answer and read-only credit path', async t => {
  const f = fixture();
  const answer = '历史原始回复 ' + PRIVATE.answer;
  f.raw.cast.ben.guaci = '旧版卦辞';
  f.accounts.replayCompleted = async () => ({ cached: true, answer, credits: 3, model: 'deepseek-flash' });
  const h = await listening(t, f);
  const result = await divine(h.url, f.raw, 'trace-legacy-0000000001');
  assert.equal(result.status, 200); assert.equal(result.body.answer, answer);
  correlated(h.records(), result, 'cached');
  assert.deepEqual(h.records().map(record => record.event), ['request_end']);
  assert.equal(f.state.reserve, 0); assert.equal(f.state.calls.length, 0); assert.equal(f.state.finish, 0); assert.equal(f.state.refund, 0);
});

test('HTTP malformed JSON or unsupported content type finishes validation tracing once before any credit operation', async t => {
  const f = fixture(), h = await listening(t, f);
  for (const [contentType, body, expectedStatus] of [
    ['application/json', '{"private":"' + PRIVATE.question, 400],
    ['text/plain', PRIVATE.question, 415]
  ]) {
    const response = await fetch(h.url + '/api/divine', { method: 'POST', headers: { 'Content-Type': contentType }, body });
    const result = { status: response.status, body: await response.json(), requestId: response.headers.get('x-request-id') };
    assert.equal(result.status, expectedStatus);
    const records = h.records().filter(record => record.request_id === result.requestId);
    correlated(records, result, 'rejected');
    assert.deepEqual(records.map(record => record.event), ['request_end']);
    assert.equal(records[0].stage, 'validation'); assert.equal(records[0].code, 'REQUEST_INVALID');
  }
  assert.equal(f.state.reserve, 0); assert.equal(f.state.calls.length, 0); assert.equal(f.state.finish, 0); assert.equal(f.state.refund, 0);
  assert.equal(f.state.credits, 3); assert.equal(f.state.audits.length, 0);
});

test('HTTP historical lookup failures from either account or replay finish once without exposing errors or changing credits', async t => {
  for (const failedLookup of ['current', 'replayCompleted']) {
    const f = fixture();
    f.raw.cast.ben.guaci = '旧版卦辞';
    f.accounts.replayCompleted = async () => null;
    f.accounts[failedLookup] = async () => { throw Object.assign(new Error(PRIVATE.key + PRIVATE.question), { code: 'ETIMEDOUT' }); };
    const h = await listening(t, f);
    const result = await divine(h.url, f.raw, 'trace-legacy-error-0001');
    assert.equal(result.status, 503); assert.equal(result.body.code, 'DATABASE');
    const records = h.records(); correlated(records, result, 'failed');
    assert.deepEqual(records.map(record => record.event), ['request_end']);
    assert.equal(records[0].stage, 'validation'); assert.equal(records[0].code, 'DATABASE');
    assert.equal(f.state.reserve, 0); assert.equal(f.state.calls.length, 0); assert.equal(f.state.finish, 0); assert.equal(f.state.refund, 0);
    assert.equal(f.state.credits, 3); assert.equal(f.state.audits.length, 0);
  }
});

test('HTTP broken sync or async telemetry loggers cannot change success charging or quality failure refunds', async t => {
  for (const asynchronous of [false, true]) {
    for (const failed of [false, true]) {
      const f = fixture();
      const traceLog = asynchronous ? async () => { throw new Error(PRIVATE.key); } : () => { throw new Error(PRIVATE.key); };
      const h = await listening(t, f, { traceLog, complete: failed ? async () => '{"invalid":true}' : f.validComplete });
      const result = await divine(h.url, f.raw, `trace-brokenlog-${asynchronous ? 1 : 0}-${failed ? 1 : 0}-00001`);
      assert.equal(result.status, failed ? 502 : 200);
      assert.equal(f.state.finish, failed ? 0 : 1); assert.equal(f.state.refund, failed ? 1 : 0);
      assert.equal(f.state.credits, failed ? 3 : 2); assert.equal(f.state.audits[0].success, !failed);
    }
  }
  await new Promise(resolve => setImmediate(resolve));
});
