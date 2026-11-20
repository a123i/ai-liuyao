const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

class AccountError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function sameSecret(a, b) {
  return crypto.timingSafeEqual(Buffer.from(sha(String(a))), Buffer.from(sha(String(b))));
}
function accountInput(body) {
  const username = String(body?.username || '').trim().toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[a-z0-9_]{4,32}$/.test(username)) throw new AccountError(400, 'USERNAME', '账号使用 4–32 位字母、数字或下划线');
  if (password.length < 10 || password.length > 128) throw new AccountError(400, 'PASSWORD', '密码请使用 10–128 个字符');
  return { username, password };
}
async function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64);
  return salt + ':' + key.toString('hex');
}
async function passwordMatches(password, encoded) {
  const salt = String(encoded || '').split(':')[0] || 'nonexistent-user-salt';
  return sameSecret(await passwordHash(password, salt), encoded || '');
}
function requestToken(request) {
  const bearer = String(request.headers.authorization || '').match(/^Bearer ([a-f0-9]{64})$/);
  if (bearer) return bearer[1];
  return String(request.headers.cookie || '').match(/(?:^|;\s*)sixyao_session=([a-f0-9]{64})(?:;|$)/)?.[1] || '';
}
const positiveInt = (value, fallback, max) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
};

function adminCreditInput(body) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!body || typeof body.userId !== 'string' || !uuid.test(body.userId) ||
      typeof body.requestKey !== 'string' || !uuid.test(body.requestKey) ||
      !Number.isInteger(body.credits) || body.credits < 0 || body.credits > 1000000 ||
      !Number.isInteger(body.expectedCredits) || body.expectedCredits < 0 ||
      typeof body.expectedRevision !== 'string' || !/^\d{1,20}$/.test(body.expectedRevision) ||
      typeof body.note !== 'string' || !body.note.trim() || Array.from(body.note.trim()).length > 200) {
    throw new AccountError(400, 'INVALID_ADJUSTMENT', '请填写 0–1000000 的整数次数及 1–200 字的修改备注，并刷新用户列表后重试');
  }
  return { userId: body.userId, requestKey: body.requestKey, credits: body.credits,
    expectedCredits: body.expectedCredits, expectedRevision: body.expectedRevision, note: body.note.trim() };
}

function adminQuestionInput(body) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!body || typeof body.userId !== 'string' || !uuid.test(body.userId) ||
      (body.cursor !== undefined && body.cursor !== null && !/^[1-9]\d{0,19}$/.test(String(body.cursor)))) {
    throw new AccountError(400, 'INVALID_USER_QUERY', '用户或翻页标识无效，请刷新后重试');
  }
  const requested = Number(body.limit);
  return { userId: body.userId, cursor: body.cursor == null ? null : String(body.cursor),
    limit: Number.isInteger(requested) ? Math.max(1, Math.min(50, requested)) : 20 };
}

function createAccounts({ auditStore, env = process.env }) {
  let readyPromise;
  const quotaEnabled = env.QUOTA_ENABLED !== 'false';
  const welcome = positiveInt(env.WELCOME_CREDITS, 3, 100);
  const reward = positiveInt(env.REWARD_CREDITS, 1, 100) || 1;
  const dailyLimit = positiveInt(env.REWARD_DAILY_LIMIT, 10, 1000) || 10;
  const provider = env.REWARD_PROVIDER === 'csj' && env.CSJ_REWARD_SECURITY_KEY ? 'csj' : 'disabled';
  const schemas = [
    'CREATE TABLE IF NOT EXISTS app_users (id CHAR(36) PRIMARY KEY, username VARCHAR(32) NOT NULL UNIQUE, password_hash VARCHAR(180) NOT NULL, credits INT NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS app_sessions (token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME(3) NOT NULL, INDEX idx_sessions_expiry (expires_at), INDEX idx_sessions_user (user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS credit_requests (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id CHAR(36) NOT NULL, request_key VARCHAR(80) NOT NULL, payload_hash CHAR(64) NOT NULL, status VARCHAR(16) NOT NULL, charged INT NOT NULL DEFAULT 1, answer LONGTEXT NULL, model VARCHAR(80) NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uq_credit_request (user_id, request_key), INDEX idx_credit_pending (status, updated_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS account_questions (credit_request_id BIGINT UNSIGNED PRIMARY KEY, user_id CHAR(36) NOT NULL, question TEXT NOT NULL, cast_time VARCHAR(64) NOT NULL DEFAULT \'\', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX idx_account_questions_user (user_id, credit_request_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS credit_ledger (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id CHAR(36) NOT NULL, delta INT NOT NULL, reason VARCHAR(32) NOT NULL, reference_id VARCHAR(100) NOT NULL UNIQUE, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX idx_ledger_user (user_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS admin_credit_adjustments (id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, before_credits INT NOT NULL, after_credits INT NOT NULL, expected_revision VARCHAR(20) NOT NULL, note VARCHAR(200) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX idx_adjustments_user (user_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS reward_tickets (id CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, provider VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT \'pending\', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), expires_at DATETIME(3) NOT NULL, INDEX idx_tickets_user (user_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS reward_events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, provider VARCHAR(16) NOT NULL, transaction_id VARCHAR(180) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, ticket_id CHAR(64) NOT NULL UNIQUE, user_id CHAR(36) NOT NULL, credits INT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uq_reward_transaction (provider, transaction_id), INDEX idx_rewards_user (user_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ];
  async function ready() {
    if (!auditStore.enabled || !auditStore.getPool) throw new AccountError(503, 'DATABASE', '账号服务暂时不可用，请稍后重试');
    if (!readyPromise) readyPromise = (async () => {
      await auditStore.ready();
      for (const sql of schemas) await auditStore.getPool().query(sql);
    })().catch(error => { readyPromise = null; throw error; });
    return readyPromise;
  }
  async function transaction(fn) {
    await ready();
    const db = await auditStore.getPool().getConnection();
    try {
      // A callback may first look up its ticket before waiting for the user lock.
      // Fresh reads after the lock must see the preceding callback's committed grant.
      await db.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await db.beginTransaction();
      const result = await fn(db);
      await db.commit();
      return result;
    } catch (error) {
      await db.rollback().catch(() => {});
      throw error;
    } finally { db.release(); }
  }
  async function lockUser(db, userId) {
    const [rows] = await db.execute('SELECT id, username, credits FROM app_users WHERE id=? FOR UPDATE', [userId]);
    if (!rows[0]) throw new AccountError(401, 'LOGIN_REQUIRED', '请先登录');
    return rows[0];
  }
  async function changeCredit(db, userId, delta, reason, reference) {
    await db.execute('UPDATE app_users SET credits=credits+? WHERE id=?', [delta, userId]);
    await db.execute('INSERT INTO credit_ledger (user_id,delta,reason,reference_id) VALUES (?,?,?,?)', [userId, delta, reason, reference]);
  }
  async function session(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await auditStore.getPool().execute('INSERT INTO app_sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY))', [sha(token), userId]);
    return token;
  }
  async function register(body) {
    const { username, password } = accountInput(body);
    const hash = await passwordHash(password);
    const id = crypto.randomUUID();
    try {
      await transaction(async db => {
        await db.execute('INSERT INTO app_users (id,username,password_hash,credits) VALUES (?,?,?,0)', [id, username, hash]);
        await changeCredit(db, id, welcome, 'welcome', 'welcome:' + id);
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw new AccountError(409, 'USERNAME_TAKEN', '这个账号已被使用，请换一个');
      throw error;
    }
    return { user: { id, username, credits: welcome }, token: await session(id) };
  }
  async function login(body) {
    const { username, password } = accountInput(body);
    await ready();
    const [rows] = await auditStore.getPool().execute('SELECT id,username,password_hash,credits FROM app_users WHERE username=?', [username]);
    const user = rows[0];
    if (!await passwordMatches(password, user?.password_hash)) throw new AccountError(401, 'LOGIN_FAILED', '账号或密码不正确');
    return { user: { id: user.id, username: user.username, credits: user.credits }, token: await session(user.id) };
  }
  async function current(request, required = false) {
    const token = requestToken(request);
    if (!token) {
      if (required) throw new AccountError(401, 'LOGIN_REQUIRED', '登录后可使用 AI 解读，首次注册赠送 ' + welcome + ' 次');
      return null;
    }
    await ready();
    const [rows] = await auditStore.getPool().execute('SELECT u.id,u.username,u.credits FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)', [sha(token)]);
    if (!rows[0] && required) throw new AccountError(401, 'LOGIN_REQUIRED', '登录已过期，请重新登录');
    if (!rows[0]) return null;
    await recoverStale(rows[0].id);
    const [fresh] = await auditStore.getPool().execute('SELECT id,username,credits FROM app_users WHERE id=?', [rows[0].id]);
    return fresh[0] || null;
  }
  async function logout(request) {
    const token = requestToken(request);
    if (token) {
      await ready();
      await auditStore.getPool().execute('DELETE FROM app_sessions WHERE token_hash=?', [sha(token)]);
    }
  }
  async function recoverStale(userId) {
    // Commit crash recovery separately, even if the following retry is rejected.
    await transaction(async db => {
      await lockUser(db, userId);
      // Recover interrupted calls only after the upstream deadline has safely passed.
      const [stale] = await db.execute('SELECT id,charged FROM credit_requests WHERE user_id=? AND status=\'pending\' AND updated_at<DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE) FOR UPDATE', [userId]);
      for (const row of stale) {
        await db.execute('UPDATE credit_requests SET status=\'failed\',updated_at=UTC_TIMESTAMP(3) WHERE id=?', [row.id]);
        await changeCredit(db, userId, row.charged, 'refund', 'refund:' + row.id);
      }
    });
  }
  async function reserve(userId, key, payload) {
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(key || '')) throw new AccountError(400, 'REQUEST_KEY', '请求标识无效，请刷新后重试');
    const hash = sha(JSON.stringify(payload));
    await recoverStale(userId);
    return transaction(async db => {
      const user = await lockUser(db, userId);
      const [existing] = await db.execute('SELECT * FROM credit_requests WHERE user_id=? AND request_key=?', [userId, key]);
      const previous = existing[0];
      if (previous) {
        if (previous.payload_hash !== hash) throw new AccountError(409, 'REQUEST_CONFLICT', '请求内容已变化，请重新发起解读');
        if (previous.status === 'completed') return { cached: true, answer: previous.answer, model: previous.model, credits: user.credits };
        if (previous.status === 'pending') throw new AccountError(409, 'IN_PROGRESS', '这次解读仍在进行，请稍候重试，不会重复扣次数');
        throw new AccountError(409, 'REQUEST_FINISHED', '上次请求已结束，请重新尝试');
      }
      const [pending] = await db.execute('SELECT id FROM credit_requests WHERE user_id=? AND status=\'pending\' LIMIT 1', [userId]);
      if (pending.length) throw new AccountError(409, 'IN_PROGRESS', '你已有解读正在进行，请稍候');
      if (user.credits < 1) throw new AccountError(402, 'NO_CREDITS', 'AI 解读次数不足，可通过观看激励广告获取');
      const [insert] = await db.execute('INSERT INTO credit_requests (user_id,request_key,payload_hash,status,charged) VALUES (?,?,?,\'pending\',1)', [userId, key, hash]);
      await db.execute('INSERT INTO account_questions (credit_request_id,user_id,question,cast_time) VALUES (?,?,?,?)',
        [insert.insertId, userId, String(payload?.question || '').slice(0, 300), String(payload?.timestamp?.display || '').slice(0, 64)]);
      await changeCredit(db, userId, -1, 'ai_reserve', 'reserve:' + insert.insertId);
      return { id: insert.insertId, userId, cached: false };
    });
  }
  async function replayCompleted(userId, key, payload) {
    // Old clients may retry a result that was already charged before a ruleset
    // update. This path can only read the exact completed request; it must not
    // reserve a credit or send the legacy cast to AI again.
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(key || '')) return null;
    await ready();
    const [rows] = await auditStore.getPool().execute(
      "SELECT payload_hash,status,answer,model FROM credit_requests WHERE user_id=? AND request_key=? LIMIT 1",
      [userId, key]
    );
    const previous = rows[0];
    if (!previous || previous.status !== 'completed' || previous.payload_hash !== sha(JSON.stringify(payload))) return null;
    const [users] = await auditStore.getPool().execute('SELECT credits FROM app_users WHERE id=?', [userId]);
    if (!users[0]) return null;
    return { cached: true, answer: previous.answer, model: previous.model, credits: users[0].credits };
  }
  async function finish(reservation, answer, model) {
    return transaction(async db => {
      const user = await lockUser(db, reservation.userId);
      const [rows] = await db.execute('SELECT status,charged FROM credit_requests WHERE id=? AND user_id=? FOR UPDATE', [reservation.id, reservation.userId]);
      if (rows[0]?.status !== 'pending') throw new AccountError(409, 'REQUEST_FINISHED', '请求已结束，请重新读取记录');
      await db.execute('UPDATE credit_requests SET status=\'completed\',answer=?,model=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [answer, model, reservation.id]);
      return user.credits;
    });
  }
  async function refund(reservation) {
    return transaction(async db => {
      await lockUser(db, reservation.userId);
      const [rows] = await db.execute('SELECT status,charged FROM credit_requests WHERE id=? AND user_id=? FOR UPDATE', [reservation.id, reservation.userId]);
      if (rows[0]?.status === 'pending') {
        await db.execute('UPDATE credit_requests SET status=\'failed\',updated_at=UTC_TIMESTAMP(3) WHERE id=?', [reservation.id]);
        await changeCredit(db, reservation.userId, rows[0].charged, 'refund', 'refund:' + reservation.id);
      }
    });
  }
  async function rewardTicket(userId) {
    if (provider === 'disabled') throw new AccountError(503, 'ADS_UNAVAILABLE', '激励广告暂未开放，请稍后再试');
    return transaction(async db => {
      await lockUser(db, userId);
      // Serialize per-user issuance and callback grants to enforce the daily cap.
      const [count] = await db.execute('SELECT COUNT(*) AS n FROM reward_events WHERE user_id=? AND created_at>=DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)), INTERVAL 8 HOUR)', [userId]);
      if (Number(count[0].n) >= dailyLimit) throw new AccountError(429, 'REWARD_LIMIT', '今日广告奖励次数已用完，明天再来吧');
      const [pending] = await db.execute('SELECT id FROM reward_tickets WHERE user_id=? AND provider=? AND status=\'pending\' AND expires_at>UTC_TIMESTAMP(3) ORDER BY created_at DESC LIMIT 1', [userId, provider]);
      const id = pending[0]?.id || crypto.randomBytes(32).toString('hex');
      if (!pending.length) await db.execute('INSERT INTO reward_tickets (id,user_id,provider,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE))', [id, userId, provider]);
      return { ticket: id, provider, userId, reward };
    });
  }
  async function grantCSJ(params) {
    const trans = String(params.trans_id || '');
    const ticket = String(params.extra || '');
    if (provider !== 'csj' || !/^[\x21-\x7e]{1,180}$/.test(trans) || !/^[a-f0-9]{64}$/.test(ticket) ||
        !sameSecret(String(params.sign || '').toLowerCase(), sha(env.CSJ_REWARD_SECURITY_KEY + ':' + trans))) {
      throw new AccountError(403, 'INVALID_REWARD', '广告验证失败');
    }
    return transaction(async db => {
      const [tickets] = await db.execute('SELECT user_id FROM reward_tickets WHERE id=?', [ticket]);
      if (!tickets[0]) throw new AccountError(400, 'INVALID_TICKET', '广告请求不存在');
      const userId = tickets[0].user_id;
      if (String(params.user_id || '') !== userId) return { isValid: false };
      await lockUser(db, userId);
      const [events] = await db.execute('SELECT ticket_id FROM reward_events WHERE provider=\'csj\' AND transaction_id=?', [trans]);
      if (events[0]) return { isValid: events[0].ticket_id === ticket };
      const [valid] = await db.execute('SELECT id FROM reward_tickets WHERE id=? AND provider=\'csj\' AND status=\'pending\' AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE', [ticket]);
      if (!valid.length) return { isValid: false };
      const [count] = await db.execute('SELECT COUNT(*) AS n FROM reward_events WHERE user_id=? AND created_at>=DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)), INTERVAL 8 HOUR)', [userId]);
      if (Number(count[0].n) >= dailyLimit) return { isValid: false };
      // Never trust reward_amount sent by a browser or SDK.
      await db.execute('INSERT INTO reward_events (provider,transaction_id,ticket_id,user_id,credits) VALUES (\'csj\',?,?,?,?)', [trans, ticket, userId, reward]);
      await db.execute('UPDATE reward_tickets SET status=\'rewarded\' WHERE id=?', [ticket]);
      await changeCredit(db, userId, reward, 'ad_reward', 'reward:' + ticket);
      return { isValid: true };
    });
  }
  async function adminSetCredits(body) {
    const input = adminCreditInput(body);
    return transaction(async db => {
      // Match reserve/refund/reward lock order. A stale admin page must never overwrite
      // an intervening charge, even if a refund restored the same numeric balance.
      const [rows] = await db.execute('SELECT id,username,credits FROM app_users WHERE id=? FOR UPDATE', [input.userId]);
      const user = rows[0];
      if (!user) throw new AccountError(404, 'USER_NOT_FOUND', '用户不存在，请刷新列表');
      const [previous] = await db.execute('SELECT * FROM admin_credit_adjustments WHERE id=?', [input.requestKey]);
      if (previous[0]) {
        const p = previous[0];
        if (p.user_id !== input.userId || p.after_credits !== input.credits || p.before_credits !== input.expectedCredits || p.expected_revision !== input.expectedRevision || p.note !== input.note) {
          throw new AccountError(409, 'ADJUSTMENT_CONFLICT', '这次操作已被使用，请刷新后重新修改');
        }
        return { user, adjustment: p, replayed: true };
      }
      const [[revision]] = await db.execute('SELECT CAST(COALESCE(MAX(id),0) AS CHAR) AS value FROM credit_ledger WHERE user_id=?', [input.userId]);
      if (user.credits !== input.expectedCredits || revision.value !== input.expectedRevision) {
        throw new AccountError(409, 'CREDITS_CHANGED', '用户次数已有变动，请关闭窗口、刷新列表后重新修改');
      }
      const [pending] = await db.execute("SELECT id FROM credit_requests WHERE user_id=? AND status='pending' LIMIT 1", [input.userId]);
      if (pending.length) throw new AccountError(409, 'AI_IN_PROGRESS', '该用户正在进行 AI 解读，请等待结束后刷新再修改');
      if (user.credits === input.credits) throw new AccountError(400, 'NO_CHANGE', '新次数与当前次数相同，无需修改');
      await db.execute('INSERT INTO admin_credit_adjustments (id,user_id,before_credits,after_credits,expected_revision,note) VALUES (?,?,?,?,?,?)',
        [input.requestKey, input.userId, user.credits, input.credits, input.expectedRevision, input.note]);
      await changeCredit(db, input.userId, input.credits - user.credits, 'admin_adjust', 'admin:' + input.requestKey);
      return { user: { ...user, credits: input.credits }, adjustment: { id: input.requestKey, before_credits: user.credits, after_credits: input.credits, note: input.note }, replayed: false };
    });
  }
  async function adminSummary() {
    await ready();
    const pool = auditStore.getPool();
    const [[users], [ledger], [rewards]] = await Promise.all([
      pool.query('SELECT u.id,u.username,u.credits,u.created_at,(SELECT CAST(COALESCE(MAX(l.id),0) AS CHAR) FROM credit_ledger l WHERE l.user_id=u.id) AS credit_revision FROM app_users u ORDER BY u.created_at DESC LIMIT 100'),
      pool.query("SELECT l.id,u.username,l.delta,l.reason,l.created_at,a.before_credits,a.after_credits,a.note FROM credit_ledger l JOIN app_users u ON u.id=l.user_id LEFT JOIN admin_credit_adjustments a ON l.reason='admin_adjust' AND a.id=SUBSTRING(l.reference_id,7) ORDER BY l.id DESC LIMIT 100"),
      pool.query('SELECT e.id,u.username,e.provider,e.credits,e.created_at FROM reward_events e JOIN app_users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 100')
    ]);
    return { users, ledger, rewards };
  }
  async function adminUserQuestions(body) {
    const input = adminQuestionInput(body);
    await ready();
    const pool = auditStore.getPool();
    const [[users], [rows]] = await Promise.all([
      pool.execute('SELECT id,username FROM app_users WHERE id=?', [input.userId]),
      pool.execute(`SELECT q.credit_request_id AS id,q.created_at,q.question,q.cast_time,
                           r.status,r.model,r.answer
                      FROM account_questions q
                      JOIN credit_requests r ON r.id=q.credit_request_id AND r.user_id=q.user_id
                     WHERE q.user_id=?${input.cursor ? ' AND q.credit_request_id<?' : ''}
                     ORDER BY q.credit_request_id DESC LIMIT ${input.limit + 1}`,
        input.cursor ? [input.userId, input.cursor] : [input.userId])
    ]);
    if (!users[0]) throw new AccountError(404, 'USER_NOT_FOUND', '用户不存在，请刷新列表');
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(row => ({ ...row, id: String(row.id) }));
    return { user: users[0], items, nextCursor: hasMore ? items.at(-1).id : null };
  }
  async function rewardStatus(userId, ticket) {
    await ready();
    const [rows] = await auditStore.getPool().execute('SELECT status FROM reward_tickets WHERE id=? AND user_id=?', [String(ticket || ''), userId]);
    return { rewarded: rows[0]?.status === 'rewarded' };
  }
  return { ready, register, login, current, logout, reserve, replayCompleted, finish, refund, rewardTicket, rewardStatus, grantCSJ, adminSummary, adminSetCredits, adminUserQuestions,
    settings: { quotaEnabled, welcomeCredits: welcome, rewardCredits: reward, rewardDailyLimit: dailyLimit, rewardProvider: provider } };
}
module.exports = { createAccounts, AccountError, sameSecret, passwordHash, passwordMatches, requestToken, accountInput, adminCreditInput, adminQuestionInput };
