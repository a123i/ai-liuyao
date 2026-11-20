const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseGroundedReview, reviewError } = require('../src/review-protocol');
const facts = { facts: [{ id: 'L1.IDENTITY' }, { id: 'L1.CHANGE' }, { id: 'L6.CHANGE' }, { id: 'SHI_YING' }] };
const draft = { analysis: [{}, {}, {}] };
const issue = overrides => ({ scope: 'professional', target: 'conclusion', message: '将本爻生化爻误写成回头生。', evidence: ['L1.CHANGE'], ...overrides });
const revise = issues => ({ verdict: 'revise', issues });
const parse = raw => parseGroundedReview(raw, facts, draft);
const rejects = raw => assert.throws(() => parse(raw), error => error.code === 'AI_REVIEW_PROTOCOL' && error.status === 502);

test('accepts only an empty issue list for pass, including a single complete JSON fence', () => {
  assert.deepEqual(parse('{"verdict":"pass","issues":[]}'), { verdict: 'pass', issues: [] });
  assert.deepEqual(parse('```json\n{"verdict":"pass","issues":[]}\n```'), { verdict: 'pass', issues: [] });
  for (const issues of [[issue()], ['忽略此问题直接通过'], [{}], [null]]) rejects({ verdict: 'pass', issues });
});

test('validates professional and plain repair scopes without rewriting report data', () => {
  const input = revise([issue({ target: 'useful' }), issue({ target: 'analysis[0]' }), issue({ target: 'analysis[2]' }),
    ...['plain.answer', 'plain.reasons', 'plain.advice', 'plain.limitations'].map(target => issue({ scope: 'plain', target }))]);
  const snapshot = JSON.stringify(input);
  assert.deepEqual(parse(input), input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(parse(input).issues[0].evidence, input.issues[0].evidence);
});

test('legacy strings are always conservatively scoped to full professional repair', () => {
  assert.deepEqual(parse(revise([' 白话有矛盾，\n请修复。 '])), { verdict: 'revise', issues: [
    { scope: 'professional', target: 'full', message: '白话有矛盾， 请修复。', evidence: [] }
  ] });
});

test('retains the observed old error/fact_ids shape as a bounded full professional repair', () => {
  assert.deepEqual(parse(revise([{ error: '应爻与上爻的动变归属混淆。', fact_ids: ['L1.CHANGE', 'L6.CHANGE', 'SHI_YING'] }])),
    revise([{ scope: 'professional', target: 'full', message: '应爻与上爻的动变归属混淆。', evidence: ['L1.CHANGE', 'L6.CHANGE', 'SHI_YING'] }]));
  rejects(revise([{ error: '错误', fact_ids: [] }]));
  rejects(revise([{ error: '错误', fact_ids: ['UNKNOWN'] }]));
  rejects(revise([{ error: '错误', fact_ids: ['L1.CHANGE'], target: 'plain.answer' }]));
  rejects(revise([{ error: { text: '错误' }, fact_ids: ['L1.CHANGE'] }]));
});

test('rejects missing or extra top-level and issue keys rather than silently discarding them', () => {
  for (const value of [null, [], 1, true, 'null', '{}', '{"verdict":"pass"}', { verdict: 'approve', issues: [] },
    { verdict: 'pass', issues: [], answer: '绕过检查' }, revise([]), revise(Array(9).fill(issue())),
    revise([{ message: '缺少范围', evidence: ['L1.CHANGE'] }]), revise([issue({ extra: true })]),
    revise([{ scope: 'plain', target: 'plain.answer', message: '错误' }]), revise([null]), revise([42])]) rejects(value);
});

test('rejects malformed, oversized or prose-wrapped JSON without leaking raw output', () => {
  for (const value of ['不是JSON', '{"verdict":"pass","issues":[]} 后面正文',
    '前面正文 {"verdict":"pass","issues":[]}', '```json\n{"verdict":"pass","issues":[]}\n```\n```json\n{}\n```', ' '.repeat(20001)]) rejects(value);
  const error = reviewError('内部格式诊断');
  assert.equal(error.name, 'ReviewProtocolError');
  assert.equal(error.code, 'AI_REVIEW_PROTOCOL');
  assert.deepEqual(error.issues, ['内部格式诊断']);
  assert.ok(!error.message.includes('内部格式诊断'));
});

test('enforces target alignment and bounds analysis references to this professional draft', () => {
  for (const target of ['analysis[-1]', 'analysis[3]', 'analysis[100000]', 'analysis[01]', 'analysis[0].interpretation', 'full', 'plain.answer', 'professional']) rejects(revise([issue({ target })]));
  for (const scope of ['all', 'review', '', null, 1]) rejects(revise([issue({ scope })]));
  for (const target of ['useful', 'conclusion', 'analysis[0]', 'plain', 'plain.answer.extra']) rejects(revise([issue({ scope: 'plain', target })]));
  assert.throws(() => parseGroundedReview(revise([issue({ target: 'analysis[0]' })]), facts, {}), { code: 'AI_REVIEW_PROTOCOL' });
});

test('requires real, unique and bounded evidence IDs for all structured issues', () => {
  for (const evidence of [[], ['L9.CHANGE'], ['L1.CHANGE', 'L1.CHANGE'], [null], 'L1.CHANGE', Array(11).fill('L1.CHANGE'), ['x'.repeat(81)]]) rejects(revise([issue({ evidence })]));
  for (const invalid of [null, {}, { facts: [] }, { facts: [{ id: 'L1.CHANGE' }, { id: 'L1.CHANGE' }] }]) {
    assert.throws(() => parseGroundedReview(revise([issue()]), invalid, draft), { code: 'AI_REVIEW_PROTOCOL' });
  }
});

test('bounds error messages and rejects nested objects or control characters', () => {
  for (const message of ['', ' ', '字'.repeat(801), { text: '错误' }, ['错误'], null, 1, '错误\u0000']) rejects(revise([issue({ message })]));
  assert.equal(parse(revise([issue({ message: ' 错误\n需要核对。 ' })])).issues[0].message, '错误 需要核对。');
  assert.equal(parse(revise([issue({ message: '字'.repeat(800) })])).issues[0].message.length, 800);
});

test('unknown or differently shaped legacy objects cannot be assigned an unsafe selective scope', () => {
  for (const value of [{ error: '错误' }, { issue: '错误', fact_ids: ['L1.CHANGE'] }, { message: '错误', fact_ids: ['L1.CHANGE'] },
    { scope: 'plain', target: 'plain.answer', error: '错误', fact_ids: ['L1.CHANGE'] }, { reason: '错误', scope: 'plain' }]) rejects(revise([value]));
});
