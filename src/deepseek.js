const { performance } = require('node:perf_hooks');

class UpstreamError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = status;
  }
}

const METRIC_ERROR_CODES = new Set([
  'MODEL_UNAVAILABLE', 'KEY_MISSING', 'UPSTREAM_TIMEOUT', 'UPSTREAM_NETWORK',
  'UPSTREAM_AUTH', 'UPSTREAM_QUOTA', 'UPSTREAM_ERROR', 'UPSTREAM_EMPTY', 'UPSTREAM_INCOMPLETE'
]);
const FINISH_REASONS = new Set(['stop', 'length', 'content_filter', 'tool_calls', 'function_call']);
function elapsed(start) { return Math.max(0, Math.round(performance.now() - start)); }
function numericUsage(data) {
  const result = {};
  const add = (name, value) => {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000000) result[name] = value;
  };
  add('promptTokens', data?.usage?.prompt_tokens);
  add('completionTokens', data?.usage?.completion_tokens);
  add('reasoningTokens', data?.usage?.completion_tokens_details?.reasoning_tokens);
  return result;
}
function emitMetrics(callback, metrics) {
  if (typeof callback !== 'function') return;
  try {
    // Do not wait on an observer; even rejected asynchronous observers must not
    // change the result, deadline, or the caller's charging/refund behavior.
    Promise.resolve(callback(metrics)).catch(() => {});
  } catch { /* telemetry is best-effort */ }
}

function createDeepSeekClient({ apiKey, fetchImpl = fetch, timeoutMs = 90000 }) {
  return {
    async complete({ model, messages, responseFormat, temperature = 0.6, maxTokens = 3000, signal,
      thinking = false, reasoningEffort = 'low', onMetrics }) {
      const started = performance.now();
      const metrics = { durationMs: 0, timeToHeadersMs: null, bodyMs: null,
        httpStatus: null, errorCode: null, finishReason: null, usage: {} };
      try {
      if (model !== 'deepseek-flash') {
        throw new UpstreamError('MODEL_UNAVAILABLE', 400, '该模型暂未开放，请使用 V4.1 Flash');
      }
      if (!apiKey) {
        throw new UpstreamError('KEY_MISSING', 503, '服务尚未配置');
      }

      let response;
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      try {
        response = await fetchImpl('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          signal: requestSignal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            ...(thinking ? { reasoning_effort: reasoningEffort } : { temperature }),
            thinking: { type: thinking ? 'enabled' : 'disabled' },
            max_tokens: maxTokens,
            ...(responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {})
          })
        });
        metrics.timeToHeadersMs = elapsed(started);
        if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) metrics.httpStatus = response.status;
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        throw new UpstreamError(
          timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK',
          timedOut ? 504 : 502,
          timedOut ? 'AI 服务响应超时，请稍后重试' : 'AI 服务暂时不可用'
        );
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new UpstreamError('UPSTREAM_AUTH', 502, 'AI 服务鉴权失败');
        }
        if (response.status === 402 || response.status === 429) {
          throw new UpstreamError('UPSTREAM_QUOTA', 503, 'AI 服务额度不足或繁忙');
        }
        throw new UpstreamError('UPSTREAM_ERROR', 502, 'AI 服务暂时不可用');
      }

      let data;
      const bodyStarted = performance.now();
      try {
        data = await response.json();
      } catch (error) {
        if (requestSignal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          throw new UpstreamError('UPSTREAM_TIMEOUT', 504, 'AI 服务响应超时，本次不扣次数，请稍后重试');
        }
        throw new UpstreamError('UPSTREAM_EMPTY', 502, 'AI 服务未返回有效内容');
      } finally {
        metrics.bodyMs = elapsed(bodyStarted);
      }
      const choice = data?.choices?.[0];
      // Only counts and fixed protocol labels are observed. In particular,
      // message.content, reasoning_content, headers and request data never enter
      // telemetry, even when supplied as extra provider response fields.
      metrics.usage = numericUsage(data);
      metrics.finishReason = choice?.finish_reason == null ? null
        : FINISH_REASONS.has(choice.finish_reason) ? choice.finish_reason : 'other';
      // A non-empty fragment is not a completed interpretation. In particular,
      // length means max_tokens cut the answer short; callers must refund it.
      if (choice?.finish_reason !== 'stop') {
        throw new UpstreamError('UPSTREAM_INCOMPLETE', 502, 'AI 解读未完整生成，本次不扣次数，请重试');
      }
      const answer = choice?.message?.content?.trim();
      if (!answer) {
        throw new UpstreamError('UPSTREAM_EMPTY', 502, 'AI 服务未返回有效内容');
      }
      return answer;
      } catch (error) {
        metrics.errorCode = METRIC_ERROR_CODES.has(error?.code) ? error.code : 'UNEXPECTED_ERROR';
        throw error;
      } finally {
        metrics.durationMs = elapsed(started);
        emitMetrics(onMetrics, metrics);
      }
    }
  };
}

module.exports = { createDeepSeekClient, UpstreamError };
