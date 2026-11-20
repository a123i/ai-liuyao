const crypto = require('node:crypto');

const LINE_NAMES = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];

function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function firstHeader(request, name) {
  const headers = request?.headers || {};
  const value = headers[name.toLowerCase()] ?? headers[name] ?? '';
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function limitString(value, max = 2000) {
  const text = String(value ?? '');
  return text.length > max ? text.slice(0, max) : text;
}

function redactQuery(search) {
  const query = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  for (const key of [...query.keys()]) {
    if (/token|password|secret|key|authorization|code|ticket|sign/i.test(key)) query.set(key, '[redacted]');
  }
  return query.toString();
}
function safeReferrer(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin + url.pathname;
  } catch { return ''; }
}

function clientIp(request, trustProxy = false) {
  // Only our reverse proxy supplies this header. Direct requests must not forge visit IPs.
  const realIp = trustProxy ? firstHeader(request, 'x-real-ip') : '';
  const candidate = (realIp || request?.socket?.remoteAddress || '').trim();
  return candidate.replace(/^::ffff:/, '') || '';
}

function parseUserAgent(userAgent) {
  const ua = String(userAgent || '');
  const isWechat = /MicroMessenger/i.test(ua);
  const wechatVersion = ua.match(/MicroMessenger\/([0-9.]+)/i)?.[1] || '';
  let os = 'Unknown';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let deviceType = 'desktop';
  if (/iPad|Tablet|PlayBook/i.test(ua)) deviceType = 'tablet';
  else if (/Mobile|iPhone|Android|MicroMessenger/i.test(ua)) deviceType = 'mobile';

  let browser = 'Unknown';
  if (isWechat) browser = 'WeChat';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\/|CriOS\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\/|FxiOS\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  return { device_type: deviceType, os, browser, is_wechat: isWechat, wechat_version: wechatVersion };
}

function extractRequestMeta(request, url, id = requestId(), trustProxy = false) {
  const userAgent = limitString(firstHeader(request, 'user-agent'), 4000);
  const parsed = parseUserAgent(userAgent);
  return {
    request_id: id,
    ip: limitString(clientIp(request, trustProxy), 64),
    method: limitString(request?.method || '', 16),
    path: limitString(url?.pathname || '', 255),
    query_string: limitString(redactQuery(url?.search), 2000),
    referrer: limitString(safeReferrer(firstHeader(request, 'referer') || firstHeader(request, 'referrer')), 4000),
    user_agent: userAgent,
    accept_language: limitString(firstHeader(request, 'accept-language'), 255),
    ...parsed
  };
}

function safeJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function pillarText(label, pillar) {
  if (!pillar?.text) return '';
  const kong = Array.isArray(pillar.kong) ? pillar.kong.join('') : '';
  return `${label} ${pillar.text}${kong ? `（${kong}）` : ''}`;
}

function summarizeCastForRecord(cast) {
  const timestamp = cast?.timestamp || {};
  const pillars = timestamp.pillars || {};
  const moving = Array.isArray(cast?.moving)
    ? cast.moving.map((flag, index) => flag ? LINE_NAMES[index] : '').filter(Boolean).join('、')
    : '';

  return {
    cast_time: limitString(timestamp.display || '', 128),
    pillars: [
      pillarText('年', pillars.year),
      pillarText('月', pillars.month),
      pillarText('日', pillars.day),
      pillarText('时', pillars.hour)
    ].filter(Boolean).join(' '),
    day: limitString(cast?.day?.text || '', 32),
    day_kong: Array.isArray(cast?.kong) ? cast.kong.join('') : '',
    ben_name: limitString(cast?.ben?.name || '', 64),
    ben_palace: limitString(cast?.ben?.palace || '', 32),
    ben_gong_type: limitString(cast?.ben?.gongType || '', 32),
    chg_name: limitString(cast?.chg?.name || '', 64),
    chg_palace: limitString(cast?.chg?.palace || '', 32),
    chg_gong_type: limitString(cast?.chg?.gongType || '', 32),
    moving_lines: moving
  };
}

function aiRecordFromRequest({ meta, input, rawPayload, answer = '', success, errorMessage = '', latencyMs = 0 }) {
  const source = input || rawPayload || {};
  const cast = source.cast || null;
  const timestamp = source.timestamp || cast?.timestamp || null;
  return {
    ...meta,
    question: limitString(source.question || '', 4000),
    model: limitString(source.model || '', 80),
    success: Boolean(success),
    error_message: limitString(errorMessage || '', 4000),
    ai_answer: limitString(answer || '', 200000),
    latency_ms: Math.max(0, Number(latencyMs) || 0),
    cast_summary: summarizeCastForRecord(cast),
    cast_json: safeJson(cast),
    timestamp_json: safeJson(timestamp)
  };
}

function normalizeAdminLimit(value) {
  if (value === undefined || value === null || value === '') return 100;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(500, Math.max(1, parsed));
}

module.exports = {
  requestId,
  extractRequestMeta,
  parseUserAgent,
  summarizeCastForRecord,
  aiRecordFromRequest,
  normalizeAdminLimit,
  safeJson
};
