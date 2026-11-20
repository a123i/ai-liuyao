'use strict';

const { performance } = require('node:perf_hooks');

// This is deliberately a closed schema. Model output, user questions, raw
// errors, headers and credentials must never enter operational trace logs.
const EVENTS = new Set([
  'stage_start', 'stage_end', 'stage_error', 'validation_error',
  'review_rejected', 'repair_start', 'repair_end', 'provider_metrics',
  'stage_skipped'
]);
const STAGES = new Set([
  'request', 'professional', 'plain', 'review', 'professional_patch',
  'professional_repair', 'plain_repair', 'review_format', 'review_repair',
  'review_recheck', 'validation', 'render'
]);
const STATUSES = new Set([
  'started', 'running', 'success', 'failed', 'error', 'rejected', 'passed',
  'revise', 'timeout', 'cancelled', 'completed', 'skipped', 'ok', 'cached', 'unknown'
]);
const CODES = new Set([
  'AI_QUALITY_ERROR', 'AI_REVIEW_PROTOCOL', 'AI_PATCH_PROTOCOL',
  'AI_REPAIR_EXHAUSTED', 'AI_REPAIR_LIMIT', 'UPSTREAM_TIMEOUT', 'UPSTREAM_NETWORK',
  'UPSTREAM_AUTH', 'UPSTREAM_QUOTA', 'UPSTREAM_BALANCE',
  'UPSTREAM_RATE_LIMIT', 'UPSTREAM_ERROR', 'UPSTREAM_EMPTY',
  'UPSTREAM_INCOMPLETE', 'MODEL_UNAVAILABLE', 'KEY_MISSING',
  'INTERNAL_ERROR', 'DATABASE', 'UNKNOWN_ERROR', 'AI_BUSY', 'REQUEST_INVALID',
  'LOGIN_REQUIRED', 'NO_CREDITS', 'IN_PROGRESS', 'REQUEST_KEY', 'REQUEST_CONFLICT', 'REQUEST_FINISHED'
]);
const REPAIR_SCOPES = new Set([
  'none', 'professional', 'plain', 'review', 'review_format', 'full', 'protocol'
]);
const NUMBER_FIELDS = {
  call: [1, 32],
  duration_ms: [0, 3600000],
  issue_count: [0, 8],
  repair_count: [0, 8],
  http_status: [100, 599],
  time_to_headers_ms: [0, 3600000],
  body_ms: [0, 3600000],
  prompt_tokens: [0, 10000000],
  completion_tokens: [0, 10000000],
  reasoning_tokens: [0, 10000000]
};
const INTEGER_FIELDS = new Set([
  'call', 'issue_count', 'repair_count', 'http_status',
  'prompt_tokens', 'completion_tokens', 'reasoning_tokens'
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FALLBACK_ID = /^req_\d{10,16}_[a-f0-9]{1,24}$/i;

function safeRequestId(value) {
  return typeof value === 'string' && value.length <= 80 &&
    (UUID.test(value) || FALLBACK_ID.test(value)) ? value : '[unavailable]';
}

function own(value, key) {
  try { return Object.hasOwn(value, key) ? value[key] : undefined; }
  catch { return undefined; }
}

function safeNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const [min, max] = NUMBER_FIELDS[field];
  if (value < min || value > max || (INTEGER_FIELDS.has(field) && !Number.isInteger(value))) return undefined;
  return INTEGER_FIELDS.has(field) ? value : Math.round(value);
}

function createRequestTelemetry({ requestId, log = console.info, now = () => performance.now() } = {}) {
  let lastClock = 0;
  function clock() {
    try {
      const value = now();
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) lastClock = value;
    } catch { /* Diagnostics cannot change an AI result. */ }
    return lastClock;
  }
  const started = clock();
  let lastElapsed = 0;
  let finished = false;
  const id = safeRequestId(requestId);

  function write(input, event) {
    lastElapsed = Math.min(3600000, Math.max(lastElapsed, 0, Math.round(clock() - started)));
    const record = { schema_version: 1, request_id: id, event, elapsed_ms: lastElapsed };
    const stage = own(input, 'stage');
    const status = own(input, 'status');
    const code = own(input, 'code');
    const scope = own(input, 'repair_scope');
    if (STAGES.has(stage)) record.stage = stage;
    if (STATUSES.has(status)) record.status = status;
    if (CODES.has(code)) record.code = code;
    if (REPAIR_SCOPES.has(scope)) record.repair_scope = scope;
    for (const field of Object.keys(NUMBER_FIELDS)) {
      const value = safeNumber(own(input, field), field);
      if (value !== undefined) record[field] = value;
    }
    try {
      if (typeof log === 'function') {
        const returned = log('[ai_trace] ' + JSON.stringify(record));
        // A custom async logger is equally non-authoritative as console.info.
        Promise.resolve(returned).catch(() => {});
      }
    } catch { /* A failed logger must not alter charging or user output. */ }
    return true;
  }

  function emit(input) {
    if (finished || !input || typeof input !== 'object' || Array.isArray(input)) return false;
    const event = own(input, 'event');
    if (!EVENTS.has(event)) return false;
    return write(input, event);
  }

  function finish(input) {
    if (finished) return false;
    finished = true;
    const value = typeof input === 'string' ? { status: input } :
      input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const record = { status: STATUSES.has(own(value, 'status')) ? own(value, 'status') : 'unknown' };
    for (const key of ['stage', 'code', 'repair_scope', ...Object.keys(NUMBER_FIELDS)]) record[key] = own(value, key);
    // Caller-supplied event/request_id/schema/elapsed fields cannot override us.
    return write(record, 'request_end');
  }

  return { emit, finish };
}

module.exports = { createRequestTelemetry };
