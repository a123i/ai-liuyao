const { normalizeAdminLimit, safeJson } = require('./audit');

function noopAuditStore(reason = 'MySQL environment variables are not configured') {
  return {
    enabled: false,
    reason,
    logVisit: async () => {},
    logAIRecord: async () => {},
    listVisits: async () => [],
    listAIRecords: async () => [],
    health: async () => ({ enabled: false, ok: false, message: reason })
  };
}

function parseDatabaseUrl(value) {
  if (!value) return {};
  const url = new URL(value);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(url.pathname.replace(/^\//, ''))
  };
}

function mysqlConfigFromEnv(env = process.env, overrides = {}) {
  const urlConfig = parseDatabaseUrl(overrides.databaseUrl || env.DATABASE_URL || env.MYSQL_URL);
  const config = {
    host: overrides.host || urlConfig.host || env.MYSQL_HOST || env.DB_HOST || env.DATABASE_HOST,
    port: Number(overrides.port || urlConfig.port || env.MYSQL_PORT || env.DB_PORT || 3306),
    user: overrides.user || urlConfig.user || env.MYSQL_USER || env.MYSQL_USERNAME || env.DB_USER || env.DATABASE_USER,
    password: overrides.password ?? urlConfig.password ?? env.MYSQL_PASSWORD ?? env.DB_PASSWORD ?? env.DATABASE_PASSWORD,
    database: overrides.database || urlConfig.database || env.MYSQL_DATABASE || env.MYSQL_DB || env.DB_NAME || env.DATABASE_NAME,
    waitForConnections: true,
    connectionLimit: Number(overrides.connectionLimit || env.MYSQL_CONNECTION_LIMIT || 4),
    connectTimeout: 5000,
    queueLimit: 40,
    timezone: 'Z',
    charset: 'utf8mb4'
  };

  if (overrides.ssl || env.MYSQL_SSL === 'true') {
    config.ssl = overrides.ssl || { rejectUnauthorized: true };
  }

  if (!config.host || !config.user || !config.database) return null;
  return config;
}

async function initTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS visit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    request_id VARCHAR(80) NOT NULL,
    ip VARCHAR(64) NOT NULL,
    method VARCHAR(16) NOT NULL,
    path VARCHAR(255) NOT NULL,
    query_string TEXT NULL,
    referrer TEXT NULL,
    user_agent TEXT NULL,
    accept_language VARCHAR(255) NULL,
    device_type VARCHAR(32) NULL,
    os VARCHAR(64) NULL,
    browser VARCHAR(64) NULL,
    is_wechat TINYINT(1) NOT NULL DEFAULT 0,
    wechat_version VARCHAR(32) NULL,
    INDEX idx_visit_created_at (created_at),
    INDEX idx_visit_ip_created_at (ip, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS ai_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    request_id VARCHAR(80) NOT NULL,
    ip VARCHAR(64) NOT NULL,
    device_type VARCHAR(32) NULL,
    os VARCHAR(64) NULL,
    browser VARCHAR(64) NULL,
    is_wechat TINYINT(1) NOT NULL DEFAULT 0,
    wechat_version VARCHAR(32) NULL,
    user_agent TEXT NULL,
    referrer TEXT NULL,
    question TEXT NULL,
    model VARCHAR(80) NULL,
    success TINYINT(1) NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
    ai_answer LONGTEXT NULL,
    cast_summary_json TEXT NULL,
    cast_json LONGTEXT NULL,
    timestamp_json LONGTEXT NULL,
    INDEX idx_ai_created_at (created_at),
    INDEX idx_ai_ip_created_at (ip, created_at),
    INDEX idx_ai_model_created_at (model, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

function safeDate(value) {
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '');
  return value;
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function createMySqlAuditStore(options = {}) {
  const env = options.env || process.env;
  const config = options.config || mysqlConfigFromEnv(env, options);
  if (!config) return noopAuditStore();

  let pool;
  let initPromise;

  function getPool() {
    if (!pool) {
      const mysql = options.mysql || require('mysql2/promise');
      pool = mysql.createPool(config);
      pool.on?.('connection', connection => {
        // Driver timezone controls serialization; this also fixes SQL timestamp defaults.
        connection.query("SET time_zone = '+00:00'", error => { if (error) connection.destroy(); });
      });
    }
    return pool;
  }

  async function ensureInit() {
    if (options.autoInit === false) return;
    if (!initPromise) initPromise = initTables(getPool()).catch(error => {
      initPromise = null;
      throw error;
    });
    return initPromise;
  }

  async function withDatabase(label, operation, fallback) {
    try {
      await ensureInit();
      return await operation(getPool());
    } catch (error) {
      console.error(`[audit] ${label} failed: ${error?.code || error?.message || error}`);
      if (label === 'listVisits' || label === 'listAIRecords') throw error;
      return fallback;
    }
  }

  return {
    enabled: true,
    ready: ensureInit,
    getPool,
    logVisit(record) {
      return withDatabase('logVisit', pool => pool.execute(
        `INSERT INTO visit_logs
        (request_id, ip, method, path, query_string, referrer, user_agent, accept_language, device_type, os, browser, is_wechat, wechat_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.request_id, record.ip, record.method, record.path, record.query_string,
          record.referrer, record.user_agent, record.accept_language, record.device_type,
          record.os, record.browser, record.is_wechat ? 1 : 0, record.wechat_version
        ]
      ), undefined);
    },
    logAIRecord(record) {
      return withDatabase('logAIRecord', pool => pool.execute(
        `INSERT INTO ai_records
        (request_id, ip, device_type, os, browser, is_wechat, wechat_version, user_agent, referrer,
         question, model, success, error_message, latency_ms, ai_answer, cast_summary_json, cast_json, timestamp_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.request_id, record.ip, record.device_type, record.os, record.browser,
          record.is_wechat ? 1 : 0, record.wechat_version, record.user_agent, record.referrer,
          record.question, record.model, record.success ? 1 : 0, record.error_message,
          record.latency_ms, record.ai_answer, safeJson(record.cast_summary),
          record.cast_json, record.timestamp_json
        ]
      ), undefined);
    },
    listVisits({ limit } = {}) {
      const safeLimit = normalizeAdminLimit(limit);
      return withDatabase('listVisits', async pool => {
        const [rows] = await pool.query(
          `SELECT id, created_at, request_id, ip, method, path, query_string, referrer, user_agent,
                  accept_language, device_type, os, browser, is_wechat, wechat_version
             FROM visit_logs ORDER BY id DESC LIMIT ${safeLimit}`
        );
        return rows.map(row => ({ ...row, created_at: safeDate(row.created_at), is_wechat: Boolean(row.is_wechat) }));
      }, []);
    },
    listAIRecords({ limit } = {}) {
      const safeLimit = normalizeAdminLimit(limit);
      return withDatabase('listAIRecords', async pool => {
        const [rows] = await pool.query(
          `SELECT id, created_at, request_id, ip, device_type, os, browser, is_wechat, wechat_version, user_agent,
                  referrer, question, model, success, error_message, latency_ms, ai_answer,
                  cast_summary_json, cast_json, timestamp_json
             FROM ai_records ORDER BY id DESC LIMIT ${safeLimit}`
        );
        return rows.map(row => ({
          ...row,
          created_at: safeDate(row.created_at),
          is_wechat: Boolean(row.is_wechat),
          success: Boolean(row.success),
          cast_summary: parseJson(row.cast_summary_json)
        }));
      }, []);
    },
    health() {
      return withDatabase('health', async pool => {
        await pool.query('SELECT 1');
        return { enabled: true, ok: true };
      }, { enabled: true, ok: false });
    },
    async close() {
      if (pool) await pool.end();
    }
  };
}

module.exports = {
  createMySqlAuditStore,
  mysqlConfigFromEnv,
  noopAuditStore,
  initTables
};
