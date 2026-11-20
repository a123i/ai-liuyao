(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AIDivination = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MODELS = [
    { id: 'deepseek-flash', label: 'V4.1 Flash', hint: '快速' }
  ];
  const DEFAULT_MODEL = MODELS[0].id;

  function buildPayload({ question, timestamp, model, cast }) {
    return {
      question: String(question || '').trim(),
      timestamp,
      model: MODELS.some(item => item.id === model) ? model : DEFAULT_MODEL,
      cast
    };
  }

  async function requestDivination(payload, fetchImpl = fetch) {
    const response = await fetchImpl('/api/divine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) throw new Error(data.error || 'AI 服务暂时不可用，请稍后重试');
    return data;
  }

  return { MODELS, DEFAULT_MODEL, buildPayload, requestDivination };
});
