const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createGroundedInterpreter, reviewMessages } = require('../src/grounded-interpreter');
const { validateRequest } = require('../src/divination');
const { buildRuleFacts } = require('../src/liuyao-rules');
const { createServer } = require('../src/server');
const { payload, validDraft, professionalDraft, passingReview } = require('./grounded-fixture.cjs');

function stageName(request) {
  const system = request.messages[0].content;
  if (system.startsWith('你是六爻专业局部纠错编辑')) return 'professional_patch';
  if (system.startsWith('你是独立')) return system.includes('上一轮核校输出不符合协议') ? 'review_format' : 'review';
  return system.startsWith('你是通俗') ? 'plain' : 'professional';
}

function fixture() {
  const raw = payload();
  const draft = validDraft(raw);
  const professional = professionalDraft(draft);
  const input = validateRequest(raw);
  const facts = buildRuleFacts(input);
  const factId = professional.useful.evidence[0];
  const issue = (scope = 'professional', target = 'conclusion') => ({ scope, target,
    message: '请保留原始事实，修正此处的解释并重新核对结论。', evidence: [factId] });
  return { raw, draft, professional, input, facts, factId, issue };
}

function driver(f, handlers = {}, options = {}) {
  const calls = [], events = [];
  const counts = {};
  let checked;
  const interpreter = createGroundedInterpreter({ timeoutMs: options.timeoutMs,
    complete: async request => {
      const name = stageName(request);
      calls.push({ name, request });
      counts[name] = (counts[name] || 0) + 1;
      if (handlers[name]) return handlers[name](request, counts[name]);
      if (name === 'professional') return JSON.stringify(f.professional);
      if (name === 'plain') return JSON.stringify(f.draft.plain);
      if (name === 'review' || name === 'review_format') return passingReview();
      throw new Error('No patch response configured');
    },
    onChecked: value => { checked = value; if (options.onChecked) return options.onChecked(value); }
  });
  return { calls, events, counts, get checked() { return checked; },
    run: () => interpreter.complete(f.input, { onEvent: value => { events.push(value); if (options.onEvent) return options.onEvent(value); } }) };
}

function reviewContext(backs, reviseDraft = () => {}) {
  const raw = payload(backs);
  const input = validateRequest(raw);
  const facts = buildRuleFacts(input);
  const draft = validDraft(raw);
  reviseDraft(draft, facts);
  const data = JSON.parse(reviewMessages(input, facts, draft)[1].content);
  return { facts, data, ids: new Set(data.rules.facts.map(fact => fact.id)) };
}

function assertMainContext(ids, lineId) {
  for (const suffix of ['IDENTITY', 'MONTH', 'DAY', 'VOID']) {
    assert.ok(ids.has(`${lineId}.${suffix}`), `review context is missing ${lineId}.${suffix}`);
  }
}

test('review context includes a selected hidden useful candidate and the flying main line conditions', () => {
  const { ids } = reviewContext([2, 1, 1, 1, 1, 1], (draft, facts) => {
    const candidate = facts.candidates.find(item => item.source === 'hidden');
    assert.equal(candidate.id, 'L2.F');
    draft.useful = { ...draft.useful, candidate_id: candidate.id, evidence: [candidate.factId] };
    for (const suffix of ['MONTH', 'DAY', 'VOID']) {
      draft.analysis.push({ evidence: [`${candidate.id}.${suffix}`], interpretation: '此项只用于核对条件，不能认定现实结果。' });
    }
  });
  for (const id of ['L2.HIDDEN', 'L2.F.MONTH', 'L2.F.DAY', 'L2.F.VOID']) assert.ok(ids.has(id));
  assertMainContext(ids, 'L2');
});

test('review context closes identity and calendar dependencies for static shi and ying participants', () => {
  const { ids, facts } = reviewContext([1, 1, 1, 1, 1, 1]);
  assert.equal(facts.movingLineIds.length, 0);
  assertMainContext(ids, facts.shiId);
  assertMainContext(ids, facts.yingId);
});

test('review context closes cited secondary hidden and static pair subjects beyond the main useful candidate', () => {
  const { ids } = reviewContext([2, 1, 1, 1, 1, 1], draft => {
    assert.equal(draft.useful.candidate_id, 'L1');
    draft.analysis.push({ evidence: ['L2.F.DAY', 'L3_L5'], interpretation: '次要条件也须核对相关限制，不能单凭关系确定结果。' });
  });
  for (const id of ['L2.HIDDEN', 'L2.F.MONTH', 'L2.F.DAY', 'L2.F.VOID', 'L3_L5']) assert.ok(ids.has(id), `review context is missing ${id}`);
  for (const lineId of ['L2', 'L3', 'L5']) assertMainContext(ids, lineId);
});

test('a structured plain-only review correction retains professional work and independently reviews the revised translation', async () => {
  const f = fixture();
  const newPlain = { ...f.draft.plain, answer: '当前结果仍无法确定，先明确学习目标，再按实际进展调整安排。' };
  const d = driver(f, {
    review: (request, n) => {
      const data = JSON.parse(request.messages[1].content);
      const { plain, ...professional } = data.draft;
      assert.deepEqual(professional, f.professional);
      assert.equal(plain.answer, n === 1 ? f.draft.plain.answer : newPlain.answer);
      assert.deepEqual(request.messages.map(item => item.role), ['system', 'user']);
      return n === 1 ? JSON.stringify({ verdict: 'revise', issues: [f.issue('plain', 'plain.answer')] }) : passingReview();
    },
    plain: (request, n) => {
      const data = JSON.parse(request.messages[1].content);
      assert.deepEqual(data.professional, f.professional);
      if (n === 2) assert.ok(data.correction_required.includes(f.issue().message));
      return JSON.stringify(n === 1 ? f.draft.plain : newPlain);
    }
  });
  const answer = await d.run();
  assert.deepEqual(d.calls.map(call => call.name), ['professional', 'plain', 'review', 'plain', 'review']);
  assert.ok(answer.includes(newPlain.answer));
  assert.equal(d.checked.calls, 5);
  assert.equal(d.checked.repairs, 1);
  assert.doesNotMatch(answer, /\bL[1-6](?:[._][A-Z0-9_]+)*\b|SHI_YING/);
});

test('malformed review protocol retries only the reviewer and retains the exact checked draft', async () => {
  const f = fixture();
  let original;
  const d = driver(f, {
    review: request => { original = JSON.parse(request.messages[1].content); return JSON.stringify({ verdict: 'pass', issues: {} }); },
    review_format: request => {
      assert.deepEqual(JSON.parse(request.messages[1].content), original);
      assert.match(request.messages[0].content, /scope、target、message、evidence/);
      return passingReview();
    }
  });
  await d.run();
  assert.deepEqual(d.calls.map(call => call.name), ['professional', 'plain', 'review', 'review_format']);
  assert.equal(d.checked.calls, 4);
  assert.ok(d.events.some(event => event.event === 'validation_error' && event.code === 'AI_REVIEW_PROTOCOL'));
});

test('observed legacy error/fact_ids objects retain semantic feedback and never trigger a wasteful protocol repair', async () => {
  const f = fixture();
  const report = { error: '应爻与上爻的动变归属应分开说明。', fact_ids: [f.factId] };
  const d = driver(f, {
    review: (_request, n) => n === 1 ? JSON.stringify({ verdict: 'revise', issues: [report] }) : passingReview(),
    professional: (request, n) => {
      if (n === 2) {
        const repair = JSON.parse(request.messages.at(-1).content);
        assert.deepEqual(repair.previous_draft, f.professional);
        assert.deepEqual(repair.correction_required, [{ scope: 'professional', target: 'full', message: report.error, evidence: report.fact_ids }]);
      }
      return JSON.stringify(f.professional);
    }
  });
  await d.run();
  assert.deepEqual(d.calls.map(call => call.name), ['professional', 'plain', 'review', 'professional', 'plain', 'review']);
});

test('a scoped analysis patch preserves useful and every other analysis while updating conclusion and translation before fresh review', async () => {
  const f = fixture();
  const snapshot = JSON.stringify(f.professional);
  const replacement = { evidence: [...f.professional.analysis[0].evidence], interpretation: '已核对该项结构条件，不能据此确定现实结果。' };
  const conclusion = { ...f.professional.conclusion, text: '修正后仍需结合实际进展，具体结果目前不能确定。' };
  const d = driver(f, {
    review: (request, n) => {
      if (n === 2) {
        const actual = JSON.parse(request.messages[1].content).draft;
        assert.deepEqual(actual.useful, f.professional.useful);
        assert.deepEqual(actual.analysis[0], replacement);
        assert.deepEqual(actual.analysis.slice(1), f.professional.analysis.slice(1));
        assert.deepEqual(actual.conclusion, conclusion);
      }
      return n === 1 ? JSON.stringify({ verdict: 'revise', issues: [f.issue('professional', 'analysis[0]')] }) : passingReview();
    },
    professional_patch: request => {
      const data = JSON.parse(request.messages[1].content);
      assert.deepEqual(data.previous_professional, f.professional);
      assert.deepEqual(data.allowed_analysis_indices, [0]);
      return JSON.stringify({ analysis: [{ index: 0, ...replacement }], conclusion });
    },
    plain: (request, n) => {
      const data = JSON.parse(request.messages[1].content);
      assert.equal(data.professional.conclusion.text, n === 1 ? f.professional.conclusion.text : conclusion.text);
      return JSON.stringify(f.draft.plain);
    }
  });
  await d.run();
  assert.deepEqual(d.calls.map(call => call.name), ['professional', 'plain', 'review', 'professional_patch', 'plain', 'review']);
  assert.equal(JSON.stringify(f.professional), snapshot);
  assert.equal(d.checked.calls, 6);
});

test('a conclusion-only professional repair allows an empty analysis patch and preserves all original analysis', async () => {
  const f = fixture();
  const conclusion = { ...f.professional.conclusion, text: '现有依据尚不足以确认具体结果，需要继续核对实际进展。' };
  const d = driver(f, {
    review: (request, n) => {
      if (n === 2) assert.deepEqual(JSON.parse(request.messages[1].content).draft.analysis, f.professional.analysis);
      return n === 1 ? JSON.stringify({ verdict: 'revise', issues: [f.issue()] }) : passingReview();
    },
    professional_patch: request => {
      assert.deepEqual(JSON.parse(request.messages[1].content).allowed_analysis_indices, []);
      return JSON.stringify({ analysis: [], conclusion });
    }
  });
  await d.run();
  assert.deepEqual(d.calls.map(call => call.name), ['professional', 'plain', 'review', 'professional_patch', 'plain', 'review']);
});

test('protocol repair plus semantic repair shares one signal and never exceeds seven model calls', async () => {
  const f = fixture();
  const d = driver(f, {
    review: (_request, n) => n === 1 ? '{}' : passingReview(),
    review_format: () => JSON.stringify({ verdict: 'revise', issues: ['需要重新核对专业结论。'] })
  });
  await d.run();
  assert.deepEqual(d.calls.map(call => call.name), ['professional', 'plain', 'review', 'review_format', 'professional', 'plain', 'review']);
  assert.equal(d.checked.calls, 7);
  assert.ok(d.calls.every(call => call.request.signal === d.calls[0].request.signal));
});

test('an exhausted protocol repair budget cannot be reset by a later professional repair', async () => {
  const f = fixture();
  const d = driver(f, { review: () => '{}', review_format: () => JSON.stringify({ verdict: 'revise', issues: ['重新核对专业结论。'] }) });
  await assert.rejects(d.run(), error => error.code === 'AI_QUALITY_ERROR' && error.failureCode === 'AI_REVIEW_PROTOCOL');
  assert.equal(d.calls.length, 7);
  assert.equal(d.counts.review_format, 1);
  assert.equal(d.checked, undefined);
});

test('the seven-call ceiling blocks additional selective repair rather than skipping final review', async () => {
  const f = fixture();
  const d = driver(f, {
    review: (_request, n) => n === 1 ? '{}' : JSON.stringify({ verdict: 'revise', issues: [f.issue('plain', 'plain.answer')] }),
    review_format: () => JSON.stringify({ verdict: 'revise', issues: ['重新核对专业结论。'] })
  });
  await assert.rejects(d.run(), error => error.code === 'AI_QUALITY_ERROR' && error.failureCode === 'AI_REPAIR_LIMIT');
  assert.equal(d.calls.length, 7);
  assert.equal(d.checked, undefined);
});

test('plain-only validation exhaustion is bounded at one professional and two editorial calls', async () => {
  const f = fixture();
  const d = driver(f, { plain: () => '{}' });
  await assert.rejects(d.run(), { code: 'AI_QUALITY_ERROR' });
  assert.deepEqual(d.calls.map(call => call.name), ['professional', 'plain', 'plain']);
  assert.equal(d.checked, undefined);
});

test('optional diagnostic observers cannot turn a completed reviewed answer into a failure', async () => {
  const f = fixture();
  let n = 0;
  const d = driver(f, {}, { onEvent: () => { if (++n % 2) throw new Error('observer failure'); return Promise.reject(new Error('async observer failure')); },
    onChecked: () => { throw new Error('checked observer failure'); } });
  const answer = await d.run();
  assert.equal(typeof answer, 'string');
  assert.equal(d.calls.length, 3);
  assert.match(answer, /^一、专业分析/);
});

test('a rejecting asynchronous checked observer cannot become an unhandled rejection or invalidate an answer', async () => {
  const f = fixture();
  const d = driver(f, {}, { onChecked: () => Promise.reject(new Error('async checked observer failure')) });
  const answer = await d.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof answer, 'string');
  assert.equal(d.calls.length, 3);
});

function creditHarness() {
  const state = { credits: 3, charges: 0, finish: 0, refund: 0, records: [] };
  const accounts = { settings: { quotaEnabled: true }, current: async () => ({ id: 'selective-user', credits: state.credits }),
    reserve: async () => { state.charges++; state.credits--; return { id: 1, userId: 'selective-user', status: 'pending' }; },
    finish: async reservation => { assert.equal(reservation.status, 'pending'); reservation.status = 'completed'; state.finish++; return state.credits; },
    refund: async reservation => { state.refund++; if (reservation.status === 'pending') { reservation.status = 'failed'; state.credits++; } } };
  const auditStore = { logVisit: async () => {}, health: async () => ({ ok: true }), logAIRecord: async record => { state.records.push(record); } };
  return { state, accounts, auditStore };
}

async function post(t, f, complete, env = {}) {
  const harness = creditHarness();
  const server = createServer({ ...harness, env, complete, traceLog: () => {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/divine`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...f.raw, requestKey: 'selective-repair-http-0001' }) });
  return { response, body: await response.json(), state: harness.state };
}

for (const invalid of ['outside_scope', 'missing_coverage', 'unknown_evidence']) {
  test(`HTTP rejects a ${invalid} professional patch and refunds once without more generation`, async t => {
    const f = fixture();
    const monthly = `${f.professional.useful.candidate_id}.MONTH`;
    const index = invalid === 'missing_coverage' ? f.professional.analysis.findIndex(item => item.evidence.includes(monthly)) : 0;
    assert.ok(index >= 0);
    const actors = [];
    const result = await post(t, f, async request => {
      const name = stageName(request); actors.push(name);
      if (name === 'professional') return JSON.stringify(f.professional);
      if (name === 'plain') return JSON.stringify(f.draft.plain);
      if (name === 'review') return JSON.stringify({ verdict: 'revise', issues: [f.issue('professional', `analysis[${index}]`)] });
      const patch = { analysis: [{ index, evidence: invalid === 'unknown_evidence' ? ['L9.INVENTED'] : invalid === 'missing_coverage' ? [f.factId] : f.professional.analysis[index].evidence,
        interpretation: '此项条件仍需核对，不能直接确定现实结果。' }], conclusion: f.professional.conclusion };
      if (invalid === 'outside_scope') patch.useful = f.professional.useful;
      return JSON.stringify(patch);
    });
    assert.equal(result.response.status, 502);
    assert.equal(result.body.code, 'AI_QUALITY_ERROR');
    assert.deepEqual(actors, ['professional', 'plain', 'review', 'professional_patch']);
    assert.equal(result.state.charges, 1);
    assert.equal(result.state.finish, 0);
    assert.equal(result.state.refund, 1);
    assert.equal(result.state.credits, 3);
    assert.equal(result.state.records.length, 1);
    assert.equal(result.state.records[0].success, false);
    assert.equal(result.state.records[0].ai_answer, '');
  });
}

test('HTTP format-only retry still shares the overall deadline and refunds on timeout', async t => {
  const f = fixture();
  const actors = [];
  const result = await post(t, f, async request => {
    const name = stageName(request); actors.push(name);
    if (name === 'professional') return JSON.stringify(f.professional);
    if (name === 'plain') return JSON.stringify(f.draft.plain);
    if (name === 'review') return '{}';
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(request.signal.aborted, true);
    return passingReview();
  }, { AI_TIMEOUT_MS: '1000' });
  assert.equal(result.response.status, 504);
  assert.equal(result.body.code, 'UPSTREAM_TIMEOUT');
  assert.deepEqual(actors, ['professional', 'plain', 'review', 'review_format']);
  assert.equal(result.state.charges, 1);
  assert.equal(result.state.finish, 0);
  assert.equal(result.state.refund, 1);
  assert.equal(result.state.credits, 3);
});
