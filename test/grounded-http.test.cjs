const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../src/server');
const { payload, validDraft, professionalDraft, isPlain, isReview, passingReview, groundedComplete } = require('./grounded-fixture.cjs');

// Stateful credit/audit doubles make the public HTTP boundary observable without
// replacing the actual grounding validator, reviewer, or answer renderer.
function creditHarness() {
  const state = { credits: 3, reserve: 0, charges: 0, finish: 0, refund: 0, records: [], events: [] };
  const requests = new Map();
  const accounts = {
    settings: { quotaEnabled: true },
    current: async () => ({ id: 'user-1', credits: state.credits }),
    reserve: async (userId, requestKey, input) => {
      state.reserve++;
      const hash = JSON.stringify(input);
      const existing = requests.get(requestKey);
      if (existing) {
        assert.equal(existing.hash, hash);
        assert.equal(existing.status, 'completed');
        return { cached: true, answer: existing.answer, model: existing.model, credits: state.credits };
      }
      state.events.push('reserve');
      state.charges++;
      state.credits--;
      const reservation = { id: requests.size + 1, userId, cached: false, status: 'pending', hash };
      requests.set(requestKey, reservation);
      return reservation;
    },
    finish: async (reservation, answer, model) => {
      state.finish++;
      state.events.push('finish');
      assert.equal(reservation.status, 'pending');
      Object.assign(reservation, { status: 'completed', answer, model });
      return state.credits;
    },
    refund: async reservation => {
      state.refund++;
      state.events.push('refund');
      if (reservation.status === 'pending') {
        reservation.status = 'failed';
        state.credits++;
      }
    }
  };
  const auditStore = {
    logVisit: async () => {},
    logAIRecord: async record => { state.records.push(record); state.events.push(record.success ? 'audit-success' : 'audit-failure'); },
    health: async () => ({ ok: true })
  };
  return { state, accounts, auditStore };
}

async function listening(t, options) {
  const server = createServer({ env: {}, ...options });
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

test('HTTP malformed drafts exhaust one repair, refund once and never finish or record success', async t => {
  const harness = creditHarness();
  const calls = [];
  const url = await listening(t, { ...harness, complete: async request => {
    calls.push(request);
    return JSON.stringify({ schema_version: '1' });
  } });
  const result = await divine(url, { ...payload(), requestKey: 'invalid-draft-http-0001' });
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'AI_QUALITY_ERROR');
  assert.ok(result.body.error);
  assert.equal(calls.length, 2, 'only the original draft and one repair may be generated');
  assert.ok(calls.every(request => !isPlain(request)), 'unvalidated professional drafts must not reach the plain writer');
  assert.ok(calls.every(request => !isReview(request)), 'unvalidated drafts must not reach the reviewer');
  assert.ok(calls[1].messages.at(-1).content.includes('correction_required'));
  assert.equal(harness.state.reserve, 1);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.finish, 0);
  assert.equal(harness.state.refund, 1);
  assert.equal(harness.state.credits, 3);
  assert.equal(harness.state.records.length, 1);
  assert.equal(harness.state.records[0].success, false);
  assert.equal(harness.state.records[0].ai_answer, '');
});

test('HTTP a well-shaped but unsupported plain-language guarantee fails before independent review', async t => {
  const harness = creditHarness();
  const raw = payload();
  const draft = validDraft(raw);
  draft.plain.answer = '这项安排一定会成功，结果没有任何问题。';
  let calls = 0, drafts = 0, plains = 0, reviews = 0;
  const url = await listening(t, { ...harness, complete: async request => {
    calls++;
    if (isReview(request)) { reviews++; return passingReview(); }
    if (isPlain(request)) { plains++; return JSON.stringify(draft.plain); }
    drafts++;
    return JSON.stringify(professionalDraft(draft));
  } });
  const result = await divine(url, { ...raw, requestKey: 'unsupported-claim-http-0001' });
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'AI_QUALITY_ERROR');
  assert.equal(calls, 3, 'a persistent plain-only error must not regenerate a validated professional draft');
  assert.equal(drafts, 1);
  assert.equal(plains, 2);
  assert.equal(reviews, 0);
  assert.equal(harness.state.finish, 0);
  assert.equal(harness.state.refund, 1);
  assert.equal(harness.state.credits, 3);
  assert.equal(harness.state.records.length, 1);
  assert.equal(harness.state.records[0].success, false);
  assert.equal(harness.state.records[0].ai_answer, '');
});

test('HTTP a repaired draft arriving after the overall deadline times out and refunds rather than finishing as a quality error', async t => {
  const harness = creditHarness();
  let calls = 0;
  const url = await listening(t, { ...harness, env: { AI_TIMEOUT_MS: '1000' }, complete: async request => {
    calls++;
    if (calls === 2) {
      // Intentionally ignore cancellation to exercise the interpreter's own
      // deadline checks, rather than the network client's abort implementation.
      await new Promise(resolve => setTimeout(resolve, 1200));
      assert.equal(request.signal.aborted, true);
    }
    return '{}';
  } });
  const result = await divine(url, { ...payload(), requestKey: 'late-draft-timeout-http-0001' });
  assert.equal(result.status, 504);
  assert.equal(result.body.code, 'UPSTREAM_TIMEOUT');
  assert.equal(calls, 2);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.finish, 0);
  assert.equal(harness.state.refund, 1);
  assert.equal(harness.state.credits, 3);
  assert.equal(harness.state.records.length, 1);
  assert.equal(harness.state.records[0].success, false);
});

test('HTTP synchronous success-audit failure cannot turn an already completed valid answer into an error or refund', async t => {
  const harness = creditHarness();
  const raw = payload();
  let auditCalls = 0;
  harness.auditStore.logAIRecord = record => {
    auditCalls++;
    assert.equal(record.success, true);
    throw new Error('synchronous audit adapter failure');
  };
  const url = await listening(t, { ...harness, complete: groundedComplete(raw) });
  const result = await divine(url, { ...raw, requestKey: 'sync-success-audit-http-0001' });
  assert.equal(result.status, 200);
  assert.match(result.body.answer, /^一、专业分析/);
  assert.equal(result.body.credits, 2);
  assert.equal(harness.state.finish, 1);
  assert.equal(harness.state.refund, 0);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.credits, 2);
  assert.equal(auditCalls, 1, 'must not fall through to a failure audit after successful completion');
});

test('HTTP synchronous failure-audit error preserves the original quality response and the single refund', async t => {
  const harness = creditHarness();
  let auditCalls = 0;
  harness.auditStore.logAIRecord = record => {
    auditCalls++;
    assert.equal(record.success, false);
    throw new Error('synchronous audit adapter failure');
  };
  const url = await listening(t, { ...harness, complete: async () => '{}' });
  const result = await divine(url, { ...payload(), requestKey: 'sync-failure-audit-http-0001' });
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'AI_QUALITY_ERROR');
  assert.equal(harness.state.finish, 0);
  assert.equal(harness.state.refund, 1);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.credits, 3);
  assert.equal(auditCalls, 1);
});

test('HTTP independently rejected reviews also exhaust one repair and refund the single reservation', async t => {
  const harness = creditHarness();
  const raw = payload();
  const calls = [];
  const url = await listening(t, { ...harness, complete: async request => {
    calls.push(request);
    if (isReview(request)) return JSON.stringify({ verdict: 'revise', issues: ['结论与所引证据缺少一致的支持。'] });
    const draft = validDraft(raw);
    return JSON.stringify(isPlain(request) ? draft.plain : professionalDraft(draft));
  } });
  const result = await divine(url, { ...raw, requestKey: 'review-failure-http-0001' });
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'AI_QUALITY_ERROR');
  assert.ok(result.body.error);
  assert.equal(calls.length, 6);
  assert.equal(calls.filter(isPlain).length, 2);
  assert.equal(calls.filter(isReview).length, 2);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.finish, 0);
  assert.equal(harness.state.refund, 1);
  assert.equal(harness.state.credits, 3);
  assert.equal(harness.state.records.length, 1);
  assert.equal(harness.state.records[0].success, false);
});

test('HTTP only finishes after a separate fresh review and cache replay makes no new upstream call or charge', async t => {
  const harness = creditHarness();
  const raw = payload();
  const draft = validDraft(raw);
  const calls = [];
  const url = await listening(t, { ...harness, complete: async request => {
    calls.push(request);
    assert.equal(request.responseFormat, 'json_object');
    assert.equal(request.model, raw.model);
    assert.ok(request.signal instanceof AbortSignal);
    if (isReview(request)) {
      harness.state.events.push('review');
      assert.deepEqual(request.messages.map(message => message.role), ['system', 'user']);
      assert.match(request.messages[0].content, /^你是独立的六爻解读校核员/);
      assert.ok(request.messages[1].content.includes(draft.plain.answer));
      assert.equal(harness.state.finish, 0, 'no successful credit completion before review');
      assert.equal(harness.state.records.length, 0, 'no successful audit before review');
      return passingReview();
    }
    if (isPlain(request)) {
      assert.deepEqual(request.messages.map(message => message.role), ['system', 'user']);
      assert.match(request.messages[0].content, /^你是通俗解读编辑/);
      assert.equal(harness.state.finish, 0);
      assert.equal(harness.state.records.length, 0);
      harness.state.events.push('plain');
      return JSON.stringify(draft.plain);
    }
    harness.state.events.push('draft');
    return JSON.stringify(professionalDraft(draft));
  } });
  const body = { ...raw, requestKey: 'reviewed-success-http-0001' };
  const result = await divine(url, body);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].signal, calls[1].signal);
  assert.equal(calls[0].signal, calls[2].signal, 'professional writer, plain writer and reviewer share one overall deadline');
  assert.notEqual(calls[0].messages[0].content, calls[1].messages[0].content);
  assert.notEqual(calls[1].messages[0].content, calls[2].messages[0].content);
  assert.deepEqual(harness.state.events, ['reserve', 'draft', 'plain', 'review', 'finish', 'audit-success']);
  assert.equal(harness.state.finish, 1);
  assert.equal(harness.state.refund, 0);
  assert.equal(harness.state.charges, 1);
  assert.equal(result.body.credits, 2);
  assert.match(result.body.answer, /^一、专业分析/);
  assert.equal(result.body.answer.match(/一、专业分析/g)?.length, 1);
  assert.equal(result.body.answer.match(/二、通俗解读/g)?.length, 1);
  assert.ok(result.body.answer.includes(draft.plain.answer));
  assert.doesNotMatch(result.body.answer, /schema_version|candidate_id/);
  assert.equal(harness.state.records[0].success, true);
  assert.equal(harness.state.records[0].ai_answer, result.body.answer);
  const cached = await divine(url, body);
  assert.equal(cached.status, 200);
  assert.equal(cached.body.cached, true);
  assert.equal(cached.body.answer, result.body.answer);
  assert.equal(cached.body.credits, result.body.credits);
  assert.equal(calls.length, 3);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.finish, 1);
  assert.equal(harness.state.refund, 0);
  assert.equal(harness.state.records.length, 1);
});

test('HTTP one malformed draft can repair into a validated reviewed result without a second charge', async t => {
  const harness = creditHarness();
  const raw = payload();
  let drafts = 0, plains = 0, reviews = 0;
  const url = await listening(t, { ...harness, complete: async request => {
    if (isReview(request)) { reviews++; return passingReview(); }
    if (isPlain(request)) { plains++; return JSON.stringify(validDraft(raw).plain); }
    drafts++;
    return drafts === 1 ? 'not a JSON document' : JSON.stringify(professionalDraft(validDraft(raw)));
  } });
  const result = await divine(url, { ...raw, requestKey: 'repaired-success-http-0001' });
  assert.equal(result.status, 200);
  assert.equal(drafts, 2);
  assert.equal(plains, 1);
  assert.equal(reviews, 1);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.finish, 1);
  assert.equal(harness.state.refund, 0);
  assert.equal(harness.state.credits, 2);
  assert.equal(harness.state.records.length, 1);
  assert.equal(harness.state.records[0].success, true);
});

test('HTTP a malformed plain response gets one plain-only repair before fresh review', async t => {
  const harness = creditHarness();
  const raw = payload();
  const draft = validDraft(raw);
  const actors = [];
  let plains = 0;
  const url = await listening(t, { ...harness, complete: async request => {
    if (isReview(request)) { actors.push('review'); return passingReview(); }
    if (isPlain(request)) {
      actors.push('plain');
      plains++;
      return plains === 1 ? 'invalid plain JSON' : JSON.stringify(draft.plain);
    }
    actors.push('draft');
    return JSON.stringify(professionalDraft(draft));
  } });
  const result = await divine(url, { ...raw, requestKey: 'plain-repair-http-0001' });
  assert.equal(result.status, 200);
  assert.deepEqual(actors, ['draft', 'plain', 'plain', 'review']);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.finish, 1);
  assert.equal(harness.state.refund, 0);
  assert.equal(harness.state.credits, 2);
  assert.equal(harness.state.records.length, 1);
  assert.equal(harness.state.records[0].success, true);
});

test('HTTP plain jargon is repaired without regenerating professional facts, then independently reviewed and charged once', async t => {
  const harness = creditHarness();
  const raw = payload();
  const draft = validDraft(raw);
  const jargonPlain = { ...draft.plain, answer: '目前还不能确定结果，用神需要再核对。' };
  const calls = [];
  let plains = 0;
  const url = await listening(t, { ...harness, complete: async request => {
    calls.push(request);
    if (isReview(request)) {
      assert.deepEqual(request.messages.map(message => message.role), ['system', 'user']);
      assert.equal(JSON.parse(request.messages[1].content).draft.plain.answer, draft.plain.answer);
      return passingReview();
    }
    if (isPlain(request)) {
      plains++;
      assert.deepEqual(request.messages.map(message => message.role), ['system', 'user']);
      const data = JSON.parse(request.messages[1].content);
      assert.deepEqual(data.professional, professionalDraft(draft));
      if (plains === 2) {
        assert.ok(data.previous_plain.includes('用神'));
        assert.ok(data.correction_required.some(issue => issue.includes('用神')));
      }
      return JSON.stringify(plains === 1 ? jargonPlain : draft.plain);
    }
    return JSON.stringify(professionalDraft(draft));
  } });
  const result = await divine(url, { ...raw, requestKey: 'jargon-editorial-repair-http-0001' });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(request => isReview(request) ? 'review' : isPlain(request) ? 'plain' : 'draft'),
    ['draft', 'plain', 'plain', 'review']);
  assert.ok(calls.every(request => request.signal === calls[0].signal));
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.finish, 1);
  assert.equal(harness.state.refund, 0);
  assert.equal(harness.state.records.length, 1);
  assert.equal(harness.state.records[0].success, true);
});

test('HTTP the one plain-only repair budget does not reset after a full technical repair', async t => {
  const harness = creditHarness();
  const raw = payload();
  const draft = validDraft(raw);
  const jargonPlain = { ...draft.plain, answer: '目前还不能确定结果，用神需要再核对。' };
  const actors = [];
  let plains = 0;
  const url = await listening(t, { ...harness, complete: async request => {
    if (isReview(request)) {
      actors.push('review');
      return JSON.stringify({ verdict: 'revise', issues: ['专业结论需要重新核对其依据。'] });
    }
    if (isPlain(request)) {
      actors.push('plain');
      plains++;
      return JSON.stringify(plains === 2 ? draft.plain : jargonPlain);
    }
    actors.push('draft');
    return JSON.stringify(professionalDraft(draft));
  } });
  const result = await divine(url, { ...raw, requestKey: 'global-editorial-budget-http-0001' });
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'AI_QUALITY_ERROR');
  assert.deepEqual(actors, ['draft', 'plain', 'plain', 'review', 'draft', 'plain']);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.finish, 0);
  assert.equal(harness.state.refund, 1);
  assert.equal(harness.state.credits, 3);
  assert.equal(harness.state.records.length, 1);
  assert.equal(harness.state.records[0].success, false);
});

test('HTTP one editorial retry and one reviewer-driven full repair stay within seven calls and one charge', async t => {
  const harness = creditHarness();
  const raw = payload();
  const draft = validDraft(raw);
  const actors = [];
  let plains = 0, reviews = 0;
  const url = await listening(t, { ...harness, complete: async request => {
    if (isReview(request)) {
      actors.push('review');
      reviews++;
      assert.deepEqual(request.messages.map(message => message.role), ['system', 'user']);
      return reviews === 1 ? JSON.stringify({ verdict: 'revise', issues: ['请进一步说明结论的不确定条件。'] }) : passingReview();
    }
    if (isPlain(request)) {
      actors.push('plain');
      plains++;
      return plains === 1 ? 'invalid plain JSON' : JSON.stringify(draft.plain);
    }
    actors.push('draft');
    return JSON.stringify(professionalDraft(draft));
  } });
  const result = await divine(url, { ...raw, requestKey: 'bounded-seven-calls-http-0001' });
  assert.equal(result.status, 200);
  assert.deepEqual(actors, ['draft', 'plain', 'plain', 'review', 'draft', 'plain', 'review']);
  assert.equal(harness.state.charges, 1);
  assert.equal(harness.state.finish, 1);
  assert.equal(harness.state.refund, 0);
  assert.equal(harness.state.credits, 2);
  assert.equal(harness.state.records.length, 1);
  assert.equal(harness.state.records[0].success, true);
});

test('HTTP historical completed replay remains verbatim and never enters the new grounding or charging path', async t => {
  const raw = payload();
  raw.cast.ben.guaci = '旧客户端已经付费时保存的原始文本';
  const saved = '历史完整答复：保持原文，不要求改造成新结构。';
  let replay = 0, reserve = 0, calls = 0, finish = 0, refund = 0;
  const records = [];
  const accounts = {
    settings: { quotaEnabled: true },
    current: async () => ({ id: 'user-1', credits: 2 }),
    replayCompleted: async (userId, requestKey) => {
      replay++;
      assert.equal(userId, 'user-1');
      assert.equal(requestKey, 'historical-ground-http-0001');
      return { cached: true, answer: saved, model: raw.model, credits: 2 };
    },
    reserve: async () => { reserve++; throw new Error('must remain read-only'); },
    finish: async () => { finish++; },
    refund: async () => { refund++; }
  };
  const auditStore = { logVisit: async () => {}, logAIRecord: async record => records.push(record), health: async () => ({ ok: true }) };
  const url = await listening(t, { accounts, auditStore, complete: async () => { calls++; throw new Error('must not call AI'); } });
  const result = await divine(url, { ...raw, requestKey: 'historical-ground-http-0001' });
  assert.deepEqual(result, { status: 200, body: { cached: true, answer: saved, model: raw.model, credits: 2 } });
  assert.equal(replay, 1);
  assert.equal(reserve, 0);
  assert.equal(calls, 0);
  assert.equal(finish, 0);
  assert.equal(refund, 0);
  assert.deepEqual(records, []);
});
