const crypto = require('node:crypto');
const { createMySqlAuditStore } = require('./mysql-store');
const { createAccounts } = require('./accounts');

// ai_records contains the exact serialized timestamp and cast saved from the
// validated request. Rebuilding that same object order lets us match its hash
// to credit_requests without guessing from IP, answer text, or timestamps.
function legacyAuditHash(row) {
  if (typeof row?.question !== 'string' || typeof row?.model !== 'string' ||
      typeof row?.timestamp_json !== 'string' || typeof row?.cast_json !== 'string') return null;
  try {
    const timestamp = JSON.parse(row.timestamp_json);
    const cast = JSON.parse(row.cast_json);
    if (!timestamp || typeof timestamp !== 'object' || !cast || typeof cast !== 'object') return null;
    const payload = '{"question":' + JSON.stringify(row.question) +
      ',"timestamp":' + row.timestamp_json +
      ',"model":' + JSON.stringify(row.model) +
      ',"cast":' + row.cast_json + '}';
    return crypto.createHash('sha256').update(payload).digest('hex');
  } catch { return null; }
}

async function backfillAccountQuestions(pool) {
  const [[requests], [existing]] = await Promise.all([
    pool.query("SELECT r.id,r.user_id,r.payload_hash,l.created_at AS reserve_at FROM credit_requests r LEFT JOIN credit_ledger l ON l.reference_id=CONCAT('reserve:',r.id) ORDER BY r.id"),
    pool.query('SELECT credit_request_id FROM account_questions')
  ]);
  const linked = new Set(existing.map(row => String(row.credit_request_id)));
  const byHash = new Map();
  for (const row of requests) {
    const hash = String(row.payload_hash);
    if (byHash.has(hash)) byHash.set(hash, null); // Multiple requests are ambiguous, even across accounts.
    else byHash.set(hash, row);
  }
  const pending = new Map([...byHash].filter(([, row]) => row && !linked.has(String(row.id))));
  const result = { unlinked: requests.length - linked.size, uniqueCandidates: pending.size, matched: 0, ambiguous: 0 };
  if (!pending.size) return result;

  let cursor = '0';
  while (pending.size) {
    const [rows] = await pool.execute(
      'SELECT id,created_at,question,model,timestamp_json,cast_json FROM ai_records WHERE id>? ORDER BY id LIMIT 250',
      [cursor]
    );
    if (!rows.length) break;
    for (const row of rows) {
      cursor = String(row.id);
      const hash = legacyAuditHash(row);
      if (!hash) continue;
      if (byHash.has(hash) && !byHash.get(hash)) { result.ambiguous++; continue; }
      const request = pending.get(hash);
      if (!request || !request.reserve_at) continue;
      const timestamp = JSON.parse(row.timestamp_json);
      try {
        await pool.execute(
          'INSERT INTO account_questions (credit_request_id,user_id,question,cast_time,created_at) VALUES (?,?,?,?,?)',
          [request.id, request.user_id, row.question.slice(0, 300),
            String(timestamp.display || '').slice(0, 64), request.reserve_at]
        );
        result.matched++;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
      }
      pending.delete(hash);
    }
    if (rows.length < 250) break;
  }
  return result;
}

if (require.main === module) {
  (async () => {
    const store = createMySqlAuditStore();
    try {
      const accounts = createAccounts({ auditStore: store });
      await accounts.ready();
      const result = await backfillAccountQuestions(store.getPool());
      console.log(JSON.stringify(result));
    } finally { await store.close?.(); }
  })().catch(error => {
    console.error('历史问题精确关联失败:', error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { legacyAuditHash, backfillAccountQuestions };
