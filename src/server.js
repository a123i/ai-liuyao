const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateLegacyRequest, validateRequest } = require('./divination');
const { createDeepSeekClient, UpstreamError } = require('./deepseek');
const { createGroundedInterpreter } = require('./grounded-interpreter');
const { createRequestTelemetry } = require('./ai-telemetry');
const { adminPage } = require('./admin-page');
const { requestId, extractRequestMeta, aiRecordFromRequest, normalizeAdminLimit } = require('./audit');
const { createMySqlAuditStore } = require('./mysql-store');
const { createAccounts, AccountError, sameSecret, requestToken } = require('./accounts');

const MAX_BODY_BYTES = 65536;
const DEFAULT_PUBLIC_DIR = path.join(__dirname, '..', 'public');
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function sendJson(response, status, body, extra = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new RequestError(415, '请求必须使用 JSON 格式');
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) throw new RequestError(413, '请求内容过大');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RequestError(413, '请求内容过大');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'JSON 格式无效'); }
}
function errorPayload(error) {
  if (error?.code === 'AI_QUALITY_ERROR') return { status: 502, body: {
    error: '本次解读未通过卦象依据校验，请重试；本次不扣次数', code: 'AI_QUALITY_ERROR'
  } };
  if (error instanceof RequestError || error instanceof AccountError || error instanceof UpstreamError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  if (/所测之事|模型|卦盘|起卦时间|请求格式/.test(error?.message || '')) return { status: 400, body: { error: error.message } };
  if (/^(ER_|E(CONN|TIMEDOUT)|PROTOCOL_)/.test(error?.code || '')) return { status: 503, body: { error: '数据库暂时无法连接，请稍后重试', code: 'DATABASE' } };
  return { status: 500, body: { error: '服务器暂时无法完成请求' } };
}
function createServer({ complete, publicDir = DEFAULT_PUBLIC_DIR, auditStore, adminToken, accounts, env = process.env, traceLog = console.info } = {}) {
  const store = auditStore || createMySqlAuditStore({ env });
  const users = accounts || createAccounts({ auditStore: store, env });
  const completeAI = complete || createDeepSeekClient({ apiKey: env.DEEPSEEK_API_KEY, timeoutMs: Math.min(180000, Math.max(1000, Number(env.AI_TIMEOUT_MS) || 90000)) }).complete;
  const interpreter = createGroundedInterpreter({ complete: completeAI,
    timeoutMs: Math.min(85000, Math.max(1000, Number(env.AI_TIMEOUT_MS) || 85000)) });
  const token = adminToken ?? env.ADMIN_TOKEN ?? '';
  const trustProxy = env.TRUST_PROXY === 'true';
  const allowedOrigins = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  const cache = new Map();
  const assets = {
    '/guide/three-coins': ['guide-three-coins.html', 'text/html'],
    '/examples/li-to-shihe': ['example-li-to-shihe.html', 'text/html'],
    '/robots.txt': ['robots.txt', 'text/plain'],
    '/sitemap.xml': ['sitemap.xml', 'application/xml'],
    '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
    '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'],
    '/account-ui.js': ['account-ui.js', 'text/javascript'],
    '/iching-data.js': ['iching-data.js', 'text/javascript'],
    '/ai-divination.js': ['ai-divination.js', 'text/javascript'],
    '/answer-presentation.js': ['answer-presentation.js', 'text/javascript'],
    '/engine.js': ['engine.js', 'text/javascript'], '/shake-controller.js': ['shake-controller.js', 'text/javascript'],
    '/vendor/lunar.js': ['vendor/lunar.js', 'text/javascript'],
    '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
    '/icon.png': ['icon.png', 'image/png']
  };
  async function serve(request, response, asset) {
    const [file, type] = asset;
    let entry = cache.get(file);
    if (!entry || env.NODE_ENV !== 'production') {
      const body = await fs.readFile(path.join(publicDir, file));
      entry = { body, etag: '"' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 24) + '"' };
      cache.set(file, entry);
    }
    response.setHeader('ETag', entry.etag);
    // Revalidate application code so upgrades cannot leave stale HTML/JS pairs.
    response.setHeader('Cache-Control', file.startsWith('vendor/') ? 'public, max-age=86400' : 'public, max-age=0, must-revalidate');
    if (request.headers['if-none-match'] === entry.etag) { response.writeHead(304); return response.end(); }
    response.writeHead(200, { 'Content-Type': type + (type.startsWith('text/') ? '; charset=utf-8' : ''), 'Content-Length': entry.body.length });
    response.end(request.method === 'HEAD' ? undefined : entry.body);
  }
  async function adminCheck(body) {
    if (!token) throw new RequestError(503, '后台口令 ADMIN_TOKEN 尚未配置');
    if (!sameSecret(body?.token || '', token)) throw new RequestError(401, '后台口令不正确');
  }
  function setSession(response, value, secure) {
    response.setHeader('Set-Cookie', 'sixyao_session=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (value ? '2592000' : '0') + (secure ? '; Secure' : ''));
  }
  let activeAI = 0;
  let activeAuth = 0;
  async function handle(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const id = requestId();
    const meta = extractRequestMeta(request, url, id, trustProxy);
    const protocol = trustProxy && request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const sameOrigin = protocol + '://' + request.headers.host;
    const origin = request.headers.origin;
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('X-Request-ID', id);
    response.setHeader('Vary', 'Origin');
    if (origin && origin !== sameOrigin) {
      if (!allowedOrigins.includes(origin)) throw new RequestError(403, '此来源暂不支持访问');
      response.setHeader('Access-Control-Allow-Origin', origin);
      // Cross-origin native clients use a bearer token, not a cross-site cookie.
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Max-Age': '600' });
      return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/healthz') return sendJson(response, 200, { ok: true, version: '12.5.0', ruleVersion: '1.0.0' });
    if (request.method === 'GET' && url.pathname === '/readyz') {
      const db = await store.health();
      return sendJson(response, db.ok ? 200 : 503, { ok: db.ok });
    }
    if (request.method === 'GET' && url.pathname === '/admin') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(adminPage());
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/records') {
      const body = await readJson(request);
      await adminCheck(body);
      const db = await store.health();
      if (!db.ok) return sendJson(response, 503, { error: '数据库未连接成功，无法读取记录；请检查数据库服务及配置', db });
      const limit = normalizeAdminLimit(body.limit);
      const [visits, aiRecords] = await Promise.all([store.listVisits({ limit }), store.listAIRecords({ limit })]);
      return sendJson(response, 200, { visits, aiRecords, db });
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/credits') {
      await adminCheck(await readJson(request));
      return sendJson(response, 200, await users.adminSummary());
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/user-questions') {
      const body = await readJson(request);
      await adminCheck(body);
      return sendJson(response, 200, await users.adminUserQuestions(body));
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/credits/update') {
      // Administrative writes are same-origin only, even for allowed native clients.
      if (origin && origin !== sameOrigin) throw new RequestError(403, '请在本站后台修改次数');
      const body = await readJson(request);
      await adminCheck(body);
      return sendJson(response, 200, await users.adminSetCredits(body));
    }
    if (request.method === 'GET' && url.pathname === '/api/account') {
      return sendJson(response, 200, { user: await users.current(request), ...users.settings });
    }
    if (request.method === 'POST' && ['/api/register', '/api/login'].includes(url.pathname)) {
      const body = await readJson(request);
      if (activeAuth >= 4) throw new RequestError(503, '登录服务繁忙，请稍后重试');
      let result;
      activeAuth++;
      try { result = await (url.pathname === '/api/register' ? users.register(body) : users.login(body)); }
      finally { activeAuth--; }
      setSession(response, result.token, protocol === 'https');
      // Return a token only to an explicitly configured native file-origin client.
      return sendJson(response, 200, { user: result.user, ...(origin === 'null' && allowedOrigins.includes('null') ? { token: result.token } : {}) });
    }
    if (request.method === 'POST' && url.pathname === '/api/logout') {
      await users.logout(request);
      setSession(response, '', protocol === 'https');
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/rewards/ticket') {
      const user = await users.current(request, true);
      return sendJson(response, 200, await users.rewardTicket(user.id));
    }
    if (request.method === 'GET' && url.pathname === '/api/rewards/status') {
      const user = await users.current(request, true);
      return sendJson(response, 200, await users.rewardStatus(user.id, url.searchParams.get('ticket')));
    }
    if (request.method === 'POST' && url.pathname === '/api/visit') {
      await store.logVisit(meta);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/api/rewards/csj/callback') {
      return sendJson(response, 200, await users.grantCSJ(Object.fromEntries(url.searchParams)));
    }
    if (['GET', 'HEAD'].includes(request.method) && assets[url.pathname]) {
      if (request.method === 'GET' && ['/', '/index.html'].includes(url.pathname)) {
        Promise.resolve(store.logVisit(meta)).catch(() => console.error('[audit] visit could not be stored'));
      }
      return serve(request, response, assets[url.pathname]);
    }
    if (url.pathname === '/api/divine' && request.method === 'POST') {
      const startedAt = Date.now();
      const trace = createRequestTelemetry({ requestId: id, log: traceLog });
      let raw;
      try { raw = await readJson(request); }
      catch (error) { trace.finish({ status: 'rejected', code: 'REQUEST_INVALID', stage: 'validation' }); throw error; }
      let input;
      try {
        input = validateRequest(raw);
      } catch (error) {
        // Replaying an answer charged under the old coin rules is read-only.
        // Never let an old or inconsistent cast reach a new AI call or reserve.
        try {
          let legacy;
          try { legacy = validateLegacyRequest(raw); } catch { /* invalid request */ }
          if (legacy && users.settings.quotaEnabled && typeof users.replayCompleted === 'function') {
            const user = await users.current(request);
            if (user) {
              const cached = await users.replayCompleted(user.id, raw.requestKey, legacy);
              if (cached) { trace.finish('cached'); return sendJson(response, 200, cached); }
            }
          }
        } catch (replayError) {
          trace.finish({ status: 'failed', stage: 'validation', code: errorPayload(replayError).body.code || 'INTERNAL_ERROR' });
          throw replayError;
        }
        trace.finish({ status: 'rejected', code: 'AI_QUALITY_ERROR', stage: 'validation' });
        throw error;
      }
      let reservation;
      let counted = false;
      try {
        if (activeAI >= 6) throw Object.assign(new RequestError(503, '当前解读较多，请稍后重试'), { code: 'AI_BUSY' });
        activeAI++;
        counted = true;
        if (users.settings.quotaEnabled) {
          const user = await users.current(request, true);
          reservation = await users.reserve(user.id, raw.requestKey, input);
          if (reservation.cached) { trace.finish('cached'); return sendJson(response, 200, reservation); }
        }
        const answer = await interpreter.complete(input, { onEvent: trace.emit });
        let credits;
        if (reservation) credits = await users.finish(reservation, answer, input.model);
        // Audit failure must not turn a successfully charged answer into a failed response.
          await Promise.resolve().then(() => store.logAIRecord(aiRecordFromRequest({ meta, input, answer, success: true, latencyMs: Date.now() - startedAt }))).catch(() => console.error('[audit] AI record could not be stored'));
        trace.finish('success');
        return sendJson(response, 200, { answer, model: input.model, credits });
      } catch (error) {
        if (reservation && !reservation.cached) await users.refund(reservation).catch(() => console.error('[credits] refund pending recovery'));
        const mapped = errorPayload(error);
          await Promise.resolve().then(() => store.logAIRecord(aiRecordFromRequest({ meta, input, success: false, errorMessage: mapped.body.error, latencyMs: Date.now() - startedAt }))).catch(() => {});
        trace.finish({ status: error?.code === 'UPSTREAM_TIMEOUT' ? 'timeout' : 'failed',
          stage: error?.aiStage || 'request', code: error?.failureCode || mapped.body.code || error?.code || 'INTERNAL_ERROR' });
        return sendJson(response, mapped.status, mapped.body);
      } finally { if (counted) activeAI--; }
    }
    if (url.pathname.startsWith('/api/')) throw new RequestError(405, '请求路径或方法不受支持');
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  }
  const server = http.createServer((request, response) => {
    handle(request, response).catch(error => {
      const mapped = errorPayload(error);
      if (mapped.status >= 500) console.error('[server] request failed:', error.code || error.name);
      if (!response.headersSent && !response.destroyed) sendJson(response, mapped.status, mapped.body);
      else response.end();
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.auditStore = store;
  server.accounts = users;
  return server;
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT) || 3000;
  (async () => {
    if (process.env.REQUIRE_DATABASE === 'true') {
      if (!(await server.auditStore.health()).ok) throw new Error('DATABASE_NOT_READY');
      await server.accounts.ready();
    }
    server.listen(port, '0.0.0.0', () => console.log('测了吗 v12.5 已启动，端口 ' + port));
  })().catch(() => {
    console.error('数据库初始化未完成，请检查配置；进程退出后由容器自动重试。');
    process.exit(1);
  });
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 110000);
    deadline.unref();
    server.close(async () => {
      await server.auditStore.close?.();
      clearTimeout(deadline);
      process.exit(0);
    });
    server.closeIdleConnections();
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
module.exports = { createServer, readJson, MAX_BODY_BYTES };
