'use strict';

const { qualityError } = require('./interpretation-contract');

const ID = /^[A-Z][A-Z0-9_.-]{0,79}$/i;
const PLAIN_TARGETS = new Set(['plain.answer', 'plain.reasons', 'plain.advice', 'plain.limitations']);
const MAX_RAW_LENGTH = 20000;

function reviewError(diagnostic) {
  // Diagnostics are application data for the format-repair step, never a raw
  // response or a new instruction. Retain the public, non-sensitive message.
  const error = qualityError(diagnostic);
  error.name = 'ReviewProtocolError';
  error.code = 'AI_REVIEW_PROTOCOL';
  return error;
}

function fail(diagnostic) { throw reviewError(diagnostic); }

function exactObject(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path}必须是JSON对象`);
  const own = Object.keys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
    fail(`${path}字段不符合核校协议`);
  }
}

function parseJson(raw) {
  if (typeof raw !== 'string') return raw;
  if (raw.length > MAX_RAW_LENGTH) fail('核校JSON超过长度上限');
  let source = raw.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(source);
  if (fence) source = fence[1];
  try { return JSON.parse(source); }
  catch { fail('核校结果必须是完整JSON，不得夹带额外正文'); }
}

function message(value, path) {
  if (typeof value !== 'string' || !value.trim() || value.length > 800 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    fail(`${path}必须是1至800字的错误说明字符串`);
  }
  return value.trim().replace(/\s+/g, ' ');
}

function factIndex(bundle) {
  if (!bundle || !Array.isArray(bundle.facts) || !bundle.facts.length || bundle.facts.length > 256) fail('核校事实表缺失或无效');
  const ids = new Set();
  for (const fact of bundle.facts) {
    if (typeof fact?.id !== 'string' || !ID.test(fact.id) || ids.has(fact.id)) fail('核校事实表编号无效或重复');
    ids.add(fact.id);
  }
  return ids;
}

function evidence(value, path, ids) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) fail(`${path}须引用1至10个事实编号`);
  const seen = new Set();
  return value.map(id => {
    if (typeof id !== 'string' || !ID.test(id) || !ids.has(id) || seen.has(id)) fail(`${path}包含未知、重复或无效事实编号`);
    seen.add(id);
    return id;
  });
}

function target(scope, value, draft, path) {
  if (scope === 'plain') {
    if (!PLAIN_TARGETS.has(value)) fail(`${path}与plain核校范围不一致`);
    return value;
  }
  if (scope !== 'professional') fail(`${path}的scope仅允许professional或plain`);
  if (value === 'useful' || value === 'conclusion') return value;
  const match = typeof value === 'string' && /^analysis\[(0|[1-9]\d*)\]$/.exec(value);
  if (!match || !Array.isArray(draft?.analysis) || Number(match[1]) >= draft.analysis.length) {
    fail(`${path}必须指向useful、conclusion或当前有效analysis下标`);
  }
  return value;
}

function parseGroundedReview(raw, bundle, draft) {
  const input = parseJson(raw);
  exactObject(input, ['verdict', 'issues'], 'review');
  if (!['pass', 'revise'].includes(input.verdict)) fail('review.verdict仅允许pass或revise');
  if (!Array.isArray(input.issues)) fail('review.issues必须是数组');
  if (input.verdict === 'pass') {
    if (input.issues.length) fail('pass的issues必须为空，不得忽略任何核校问题');
    return { verdict: 'pass', issues: [] };
  }
  if (!input.issues.length || input.issues.length > 8) fail('revise须包含1至8项核校问题');
  const ids = factIndex(bundle);
  const issues = input.issues.map((issue, index) => {
    const path = `review.issues[${index}]`;
    if (typeof issue === 'string') {
      // Legacy text provides no reliable selective-edit scope. Escalate to a
      // complete professional repair, never infer that it is plain-only.
      return { scope: 'professional', target: 'full', message: message(issue, path), evidence: [] };
    }
    if (issue && typeof issue === 'object' && !Array.isArray(issue) && Object.hasOwn(issue, 'error')) {
      // Observed old reviewer shape. Exact keys + validated fact IDs preserve
      // its semantic report without silently guessing a selective target.
      exactObject(issue, ['error', 'fact_ids'], path);
      return { scope: 'professional', target: 'full', message: message(issue.error, `${path}.error`),
        evidence: evidence(issue.fact_ids, `${path}.fact_ids`, ids) };
    }
    exactObject(issue, ['scope', 'target', 'message', 'evidence'], path);
    return { scope: issue.scope, target: target(issue.scope, issue.target, draft, path),
      message: message(issue.message, `${path}.message`), evidence: evidence(issue.evidence, `${path}.evidence`, ids) };
  });
  return { verdict: 'revise', issues };
}

module.exports = { parseGroundedReview, reviewError };
