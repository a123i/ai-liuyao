const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { createAccounts } = require('../src/accounts');
const { createMySqlAuditStore } = require('../src/mysql-store');

test('new-account allowance defaults to three, with explicit overrides preserved', async () => {
  const accounts = env => createAccounts({ auditStore: {}, env });
  assert.equal(accounts({}).settings.welcomeCredits, 3);
  assert.equal(accounts({ WELCOME_CREDITS: '3' }).settings.welcomeCredits, 3);
  assert.equal(accounts({ WELCOME_CREDITS: '1' }).settings.welcomeCredits, 1);
  assert.equal(accounts({ WELCOME_CREDITS: '0' }).settings.welcomeCredits, 0);
  assert.equal(accounts({ WELCOME_CREDITS: 'invalid' }).settings.welcomeCredits, 3);
  await assert.rejects(accounts({}).current({ headers: {} }, true), error =>
    error.code === 'LOGIN_REQUIRED' && error.message.includes('3 次'));
});

test('real MySQL: three initial credits are granted once, existing balances are unchanged',
  { skip: !process.env.MYSQL_TEST_PORT }, async t => {
    // This uses a disposable schema in the isolated verification container only.
    const config = { host: '127.0.0.1', port: Number(process.env.MYSQL_TEST_PORT),
      user: 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: 'Z' };
    const root = await mysql.createConnection(config);
    const database = 'sixyao_welcome_test_' + crypto.randomBytes(8).toString('hex');
    await root.query('CREATE DATABASE `' + database + '`');
    const store = createMySqlAuditStore({ config: { ...config, database, connectionLimit: 4 } });
    t.after(async () => {
      await store.close();
      await root.query('DROP DATABASE `' + database + '`');
      await root.end();
    });
    const oldAccounts = createAccounts({ auditStore: store, env: { WELCOME_CREDITS: '1' } });
    const existing = await oldAccounts.register({ username: 'existing_user', password: 'fixture-password-only' });
    const accounts = createAccounts({ auditStore: store, env: {} });
    const credentials = { username: 'new_user', password: 'fixture-password-only' };
    const fresh = await accounts.register(credentials);
    assert.equal(fresh.user.credits, 3);
    await assert.rejects(accounts.register(credentials), { code: 'USERNAME_TAKEN' });
    assert.equal((await accounts.login(credentials)).user.credits, 3);
    const request = token => ({ headers: { cookie: 'sixyao_session=' + token } });
    assert.equal((await accounts.current(request(existing.token), true)).credits, 1);
    const [[ledger]] = await store.getPool().execute(
      'SELECT COUNT(*) AS n, SUM(delta) AS total FROM credit_ledger WHERE user_id=? AND reason=?',
      [fresh.user.id, 'welcome']);
    assert.equal(ledger.n, 1);
    assert.equal(Number(ledger.total), 3);
    for (let i = 0; i < 3; i++) {
      const reserved = await accounts.reserve(fresh.user.id, 'welcome-test-request-' + i, { question: 'fixture' });
      await accounts.finish(reserved, 'fixture answer', 'test');
      assert.equal((await accounts.current(request(fresh.token), true)).credits, 2 - i);
    }
    await assert.rejects(accounts.reserve(fresh.user.id, 'welcome-test-exhausted', { question: 'fixture' }),
      { code: 'NO_CREDITS' });
    assert.equal((await accounts.login(credentials)).user.credits, 0);
    const [[unchanged]] = await store.getPool().execute('SELECT credits FROM app_users WHERE id=?', [existing.user.id]);
    assert.equal(unchanged.credits, 1);
  });
