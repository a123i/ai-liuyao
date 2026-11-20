const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekClient } = require('../src/deepseek');

const messages = [{ role: 'system', content: '只输出完整JSON。' }, { role: 'user', content: '测试请求' }];
const completed = content => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) });

test('low-level client sends non-thinking JSON mode and caller options without losing the caller signal', async () => {
  const caller = new AbortController();
  let fetchSignal;
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    assert.ok(options.signal instanceof AbortSignal);
    fetchSignal = options.signal;
    assert.equal(options.signal.aborted, false);
    assert.deepEqual(JSON.parse(options.body), {
      model: 'deepseek-flash', messages, stream: false, temperature: 0,
      thinking: { type: 'disabled' }, max_tokens: 1400, response_format: { type: 'json_object' }
    });
    return completed('  {"verdict":"pass","issues":[]}  ');
  } });
  assert.equal(await ai.complete({ model: 'deepseek-flash', messages, responseFormat: 'json_object', temperature: 0, maxTokens: 1400, signal: caller.signal }),
    '{"verdict":"pass","issues":[]}');
  caller.abort();
  assert.equal(fetchSignal.aborted, true, 'combined request deadline must include the caller signal');
  assert.equal(fetchSignal.reason, caller.signal.reason);
});

test('low-level client retains default text-mode options for existing callers', async () => {
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.temperature, 0.6);
    assert.equal(body.max_tokens, 3000);
    assert.equal(Object.hasOwn(body, 'response_format'), false);
    assert.deepEqual(body.messages, messages);
    assert.ok(options.signal instanceof AbortSignal);
    return completed('完整文本');
  } });
  assert.equal(await ai.complete({ model: 'deepseek-flash', messages }), '完整文本');
});

test('thinking-enabled draft and review serialize low effort without temperature and return content only', async () => {
  const budgets = [7500, 5000];
  let calls = 0;
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async (_url, options) => {
    const budget = budgets[calls++];
    assert.deepEqual(JSON.parse(options.body), {
      model: 'deepseek-flash', messages, stream: false, reasoning_effort: 'low',
      thinking: { type: 'enabled' }, max_tokens: budget, response_format: { type: 'json_object' }
    });
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: {
      content: '  {"public":"structured answer"}  ', reasoning_content: 'Private model trace: never persist or display this.'
    } }] }) };
  } });
  for (const maxTokens of budgets) {
    const answer = await ai.complete({ model: 'deepseek-flash', messages, responseFormat: 'json_object',
      thinking: true, reasoningEffort: 'low', temperature: 0, maxTokens });
    assert.equal(answer, '{"public":"structured answer"}');
    assert.doesNotMatch(answer, /Private model trace|reasoning_content/);
  }
  assert.equal(calls, 2);
});

test('nonempty reasoning content cannot substitute for missing final answer content', async () => {
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async () => ({
    ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: {
      content: '  ', reasoning_content: 'This trace is not a completed interpretation.'
    } }] })
  }) });
  await assert.rejects(ai.complete({ model: 'deepseek-flash', messages, thinking: true }),
    { code: 'UPSTREAM_EMPTY', status: 502 });
});

test('caller cancellation reaches fetch and remains an upstream timeout rather than a quality failure', async () => {
  const caller = new AbortController();
  let fetchSignal;
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async (_url, options) => {
    fetchSignal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  const pending = ai.complete({ model: 'deepseek-flash', messages, responseFormat: 'json_object', signal: caller.signal });
  caller.abort();
  await assert.rejects(pending, { name: 'UpstreamError', code: 'UPSTREAM_TIMEOUT', status: 504 });
  assert.equal(fetchSignal.aborted, true);
  assert.equal(fetchSignal.reason, caller.signal.reason);
});

test('per-call service timeout is still effective when an independent caller signal is provided', async () => {
  const caller = new AbortController();
  let fetchSignal;
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', timeoutMs: 20, fetchImpl: async (_url, options) => {
    fetchSignal = options.signal;
    return new Promise((_resolve, reject) => {
      // A referenced timer keeps the mocked fetch alive like a real socket and
      // bounds this regression if the service deadline ever stops working.
      const guard = setTimeout(() => reject(new Error('mock deadline was not propagated')), 2000);
      options.signal.addEventListener('abort', () => { clearTimeout(guard); reject(options.signal.reason); }, { once: true });
    });
  } });
  await assert.rejects(ai.complete({ model: 'deepseek-flash', messages, signal: caller.signal }),
    { name: 'UpstreamError', code: 'UPSTREAM_TIMEOUT', status: 504 });
  assert.equal(fetchSignal.aborted, true);
  assert.equal(fetchSignal.reason.name, 'TimeoutError');
  assert.equal(caller.signal.aborted, false, 'the client must not abort its caller-owned signal');
});

test('per-call metrics report header/body timings and whitelisted usage without request or provider text', async () => {
  const events = [];
  const sensitive = ['fixture-private-api-key', 'private-user-question', 'private-answer-content', 'private-reasoning-content'];
  const ai = createDeepSeekClient({ apiKey: sensitive[0], fetchImpl: async (_url, options) => {
    assert.equal(Object.hasOwn(JSON.parse(options.body), 'onMetrics'), false);
    await new Promise(resolve => setTimeout(resolve, 8));
    return { ok: true, status: 200, headers: { private: sensitive[0] }, json: async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { private: sensitive[0], usage: { prompt_tokens: 17, completion_tokens: 25,
        completion_tokens_details: { reasoning_tokens: 19, secret: sensitive[3] }, secret: sensitive[2] },
      choices: [{ finish_reason: 'stop', message: { content: sensitive[2], reasoning_content: sensitive[3] } }] };
    } };
  } });
  const answer = await ai.complete({ model: 'deepseek-flash', messages: [{ role: 'user', content: sensitive[1] }],
    onMetrics: value => events.push(value) });
  assert.equal(answer, sensitive[2]);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.deepEqual(Object.keys(event).sort(), ['durationMs', 'timeToHeadersMs', 'bodyMs', 'httpStatus', 'errorCode', 'finishReason', 'usage'].sort());
  assert.equal(event.httpStatus, 200);
  assert.equal(event.errorCode, null);
  assert.equal(event.finishReason, 'stop');
  assert.deepEqual(event.usage, { promptTokens: 17, completionTokens: 25, reasoningTokens: 19 });
  assert.ok(event.timeToHeadersMs >= 5);
  assert.ok(event.bodyMs >= 7);
  assert.ok(event.durationMs >= Math.max(event.bodyMs, event.timeToHeadersMs));
  for (const secret of sensitive) assert.equal(JSON.stringify(event).includes(secret), false);
});

test('HTTP failures emit once and retain existing auth/quota semantics while exposing numeric HTTP status', async () => {
  const cases = [[401, 'UPSTREAM_AUTH', 502], [403, 'UPSTREAM_AUTH', 502],
    [402, 'UPSTREAM_QUOTA', 503], [429, 'UPSTREAM_QUOTA', 503], [500, 'UPSTREAM_ERROR', 502]];
  for (const [httpStatus, code, status] of cases) {
    const events = [];
    const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async () => ({
      ok: false, status: httpStatus, json: async () => { throw new Error('failed response body must not be read'); }
    }) });
    await assert.rejects(ai.complete({ model: 'deepseek-flash', messages, onMetrics: value => events.push(value) }), { code, status });
    assert.equal(events.length, 1);
    assert.equal(events[0].httpStatus, httpStatus);
    assert.equal(events[0].errorCode, code);
    assert.equal(events[0].bodyMs, null);
    assert.equal(events[0].finishReason, null);
    assert.deepEqual(events[0].usage, {});
  }
});

test('network failure, body parse failure, incomplete content and empty content each emit exactly once', async () => {
  const cases = [
    { code: 'UPSTREAM_NETWORK', headers: false, fetchImpl: async () => { throw Object.assign(new Error('private-network-detail'), { code: 'private-code' }); } },
    { code: 'UPSTREAM_EMPTY', headers: true, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('private-json-detail'); } }) },
    { code: 'UPSTREAM_INCOMPLETE', headers: true, fetchImpl: async () => ({ ok: true, status: 200,
      json: async () => ({ usage: { completion_tokens: 16 }, choices: [{ finish_reason: 'length', message: { content: 'private-fragment' } }] }) }) },
    { code: 'UPSTREAM_EMPTY', headers: true, fetchImpl: async () => ({ ok: true, status: 200,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: ' ', reasoning_content: 'private-reasoning-detail' } }] }) }) }
  ];
  for (const item of cases) {
    const events = [];
    const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: item.fetchImpl });
    await assert.rejects(ai.complete({ model: 'deepseek-flash', messages, onMetrics: value => events.push(value) }), { code: item.code });
    assert.equal(events.length, 1);
    assert.equal(events[0].errorCode, item.code);
    assert.equal(events[0].httpStatus, item.headers ? 200 : null);
    assert.equal(events[0].timeToHeadersMs === null, !item.headers);
    assert.equal(events[0].bodyMs === null, !item.headers);
    assert.doesNotMatch(JSON.stringify(events[0]), /private-|fixture-key/);
  }
});

test('fetch and body cancellation emit once without converting timeouts to quality or network failures', async () => {
  for (const afterHeaders of [false, true]) {
    const events = [];
    const caller = new AbortController();
    const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async (_url, options) => {
      const stalled = () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      return afterHeaders ? { ok: true, status: 200, json: stalled } : stalled();
    } });
    const pending = ai.complete({ model: 'deepseek-flash', messages, signal: caller.signal, onMetrics: value => events.push(value) });
    await new Promise(resolve => setImmediate(resolve));
    caller.abort();
    await assert.rejects(pending, { code: 'UPSTREAM_TIMEOUT', status: 504 });
    assert.equal(events.length, 1);
    assert.equal(events[0].errorCode, 'UPSTREAM_TIMEOUT');
    assert.equal(events[0].httpStatus, afterHeaders ? 200 : null);
    assert.equal(events[0].bodyMs === null, !afterHeaders);
  }
});

test('configuration rejection emits safe metrics once without making a network call', async () => {
  for (const item of [{ apiKey: 'fixture-key', model: 'deepseek-pro', code: 'MODEL_UNAVAILABLE' },
    { apiKey: '', model: 'deepseek-flash', code: 'KEY_MISSING' }]) {
    const events = [];
    const ai = createDeepSeekClient({ apiKey: item.apiKey, fetchImpl: async () => { assert.fail('must not call provider'); } });
    await assert.rejects(ai.complete({ model: item.model, messages, onMetrics: value => events.push(value) }), { code: item.code });
    assert.equal(events.length, 1);
    assert.equal(events[0].errorCode, item.code);
    assert.equal(events[0].httpStatus, null);
    assert.equal(events[0].timeToHeadersMs, null);
    assert.equal(events[0].bodyMs, null);
  }
});

test('numeric usage permits zero but ignores missing, string, fractional, nonfinite and unbounded values', async () => {
  const events = [];
  const usages = [{ prompt_tokens: 0, completion_tokens: '10', completion_tokens_details: { reasoning_tokens: 0 } },
    { prompt_tokens: NaN, completion_tokens: Infinity, completion_tokens_details: { reasoning_tokens: -1 } },
    { prompt_tokens: 1.5, completion_tokens: 1000000001, completion_tokens_details: { reasoning_tokens: null } }, undefined];
  let index = 0;
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async () => ({ ok: true, status: 200,
    json: async () => ({ usage: usages[index++], choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }) }) });
  for (let i = 0; i < usages.length; i++) assert.equal(await ai.complete({ model: 'deepseek-flash', messages, onMetrics: value => events.push(value) }), 'ok');
  assert.equal(events.length, usages.length);
  assert.deepEqual(events.map(event => event.usage), [{ promptTokens: 0, reasoningTokens: 0 }, {}, {}, {}]);
});

test('synchronous or asynchronous telemetry observer failures never change success or provider failure', async () => {
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async () => completed('unchanged answer') });
  assert.equal(await ai.complete({ model: 'deepseek-flash', messages, onMetrics: () => { throw new Error('observer failure'); } }), 'unchanged answer');
  assert.equal(await ai.complete({ model: 'deepseek-flash', messages, onMetrics: () => Promise.reject(new Error('async observer failure')) }), 'unchanged answer');
  await new Promise(resolve => setImmediate(resolve));
  const failed = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(failed.complete({ model: 'deepseek-flash', messages, onMetrics: () => { throw new Error('observer failure'); } }), { code: 'UPSTREAM_QUOTA', status: 503 });
});

test('untrusted finish labels cannot leak arbitrary provider text into metrics', async () => {
  const events = [];
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async () => ({ ok: true, status: 200,
    json: async () => ({ choices: [{ finish_reason: 'private-provider-marker', message: { content: 'private-answer' } }] }) }) });
  await assert.rejects(ai.complete({ model: 'deepseek-flash', messages, onMetrics: value => events.push(value) }), { code: 'UPSTREAM_INCOMPLETE' });
  assert.equal(events.length, 1);
  assert.equal(events[0].finishReason, 'other');
  assert.doesNotMatch(JSON.stringify(events[0]), /private-/);
});

test('metrics observers are request scoped when one provider client has overlapping calls', async () => {
  const first = [], second = [];
  const ai = createDeepSeekClient({ apiKey: 'fixture-key', fetchImpl: async (_url, options) => {
    const isFirst = JSON.parse(options.body).messages[0].content === 'first';
    await new Promise(resolve => setTimeout(resolve, isFirst ? 8 : 2));
    return { ok: true, status: 200, json: async () => ({ usage: { prompt_tokens: isFirst ? 10 : 20 },
      choices: [{ finish_reason: 'stop', message: { content: isFirst ? 'first answer' : 'second answer' } }] }) };
  } });
  const answers = await Promise.all([
    ai.complete({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'first' }], onMetrics: value => first.push(value) }),
    ai.complete({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'second' }], onMetrics: value => second.push(value) })
  ]);
  assert.deepEqual(answers, ['first answer', 'second answer']);
  assert.equal(first.length, 1); assert.equal(second.length, 1);
  assert.equal(first[0].usage.promptTokens, 10);
  assert.equal(second[0].usage.promptTokens, 20);
});
