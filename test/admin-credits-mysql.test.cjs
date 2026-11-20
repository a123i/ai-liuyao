const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const {createAccounts}=require('../src/accounts');
const {createMySqlAuditStore}=require('../src/mysql-store');

test('real MySQL: administrator changes are atomic, audited, stale-safe and replay-safe',{skip:!process.env.MYSQL_TEST_PORT},async t=>{
  const config={host:'127.0.0.1',port:Number(process.env.MYSQL_TEST_PORT),user:'root',password:process.env.MYSQL_TEST_PASSWORD||'',timezone:'Z'};
  const root=await mysql.createConnection(config),database='sixyao_admin_test_'+crypto.randomBytes(8).toString('hex');
  await root.query('CREATE DATABASE `'+database+'`');
  const store=createMySqlAuditStore({config:{...config,database,connectionLimit:8}}),accounts=createAccounts({auditStore:store,env:{}}),pool=store.getPool();
  t.after(async()=>{await store.close();await root.query('DROP DATABASE `'+database+'`');await root.end()});
  const registered=await accounts.register({username:'admin_credit_fixture',password:'fixture-password-only'}),id=registered.user.id;
  const snapshot=async()=>(await accounts.adminSummary()).users.find(u=>u.id===id);
  const command=async(credits)=>{const u=await snapshot();return {userId:id,requestKey:crypto.randomUUID(),credits,expectedCredits:u.credits,expectedRevision:u.credit_revision,note:'测试修改 <b>不执行 HTML</b>'}};
  let first;
  await t.test('increase, decrease, zero and maximum are recorded with before/after and notes',async()=>{
    first=await command(10);const result=await accounts.adminSetCredits(first);assert.equal(result.user.credits,10);
    let summary=await accounts.adminSummary();assert.equal(summary.ledger[0].reason,'admin_adjust');assert.equal(summary.ledger[0].before_credits,3);assert.equal(summary.ledger[0].after_credits,10);assert.equal(summary.ledger[0].note,first.note);
    for(const amount of [3,0,1000000,10]){await accounts.adminSetCredits(await command(amount));assert.equal((await snapshot()).credits,amount)}
    await assert.rejects(accounts.adminSetCredits(await command(10)),{code:'NO_CHANGE'});
    await assert.rejects(accounts.adminSetCredits({...await command(1),userId:crypto.randomUUID()}),{code:'USER_NOT_FOUND'});
  });
  await t.test('retry after subsequent consumption does not restore old credits',async()=>{
    const r=await accounts.reserve(id,'admin-after-save-0001',{question:'fixture'});await accounts.finish(r,'fixture answer','test');
    assert.equal((await snapshot()).credits,9);
    const retry=await accounts.adminSetCredits(first);assert.equal(retry.replayed,true);assert.equal(retry.user.credits,9);assert.equal((await snapshot()).credits,9);
    await assert.rejects(accounts.adminSetCredits({...first,credits:20}),{code:'ADJUSTMENT_CONFLICT'});
  });
  await t.test('a changed balance, ABA refund and pending AI are rejected',async()=>{
    const old=await command(20);const reservation=await accounts.reserve(id,'admin-pending-0001',{question:'fixture'});
    await assert.rejects(accounts.adminSetCredits(old),{code:'CREDITS_CHANGED'});
    await assert.rejects(accounts.adminSetCredits(await command(20)),{code:'AI_IN_PROGRESS'});
    await accounts.refund(reservation);assert.equal((await snapshot()).credits,old.expectedCredits);
    await assert.rejects(accounts.adminSetCredits(old),{code:'CREDITS_CHANGED'});
  });
  await t.test('concurrent updates from same snapshot allow only one; same request writes once',async()=>{
    const a=await command(30),b={...a,requestKey:crypto.randomUUID(),credits:40};
    const outcomes=await Promise.allSettled([accounts.adminSetCredits(a),accounts.adminSetCredits(b)]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'CREDITS_CHANGED');
    const cmd=await command(50),results=await Promise.all([accounts.adminSetCredits(cmd),accounts.adminSetCredits(cmd)]);
    assert.equal(results.filter(r=>r.replayed).length,1);
    const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM credit_ledger WHERE reference_id=?',['admin:'+cmd.requestKey]);assert.equal(count.n,1);
  });
  await t.test('failed ledger write rolls back balance and adjustment; persisted ledger sums match',async()=>{
    const cmd=await command(60),before=await snapshot();
    // Deliberately collide the ledger reference in this isolated schema to force rollback.
    await pool.execute('INSERT INTO credit_ledger (user_id,delta,reason,reference_id) VALUES (?,0,?,?)',[id,'test_collision','admin:'+cmd.requestKey]);
    cmd.expectedRevision=(await snapshot()).credit_revision;
    await assert.rejects(accounts.adminSetCredits(cmd),{code:'ER_DUP_ENTRY'});
    assert.equal((await snapshot()).credits,before.credits);
    const [[adjust]]=await pool.execute('SELECT COUNT(*) AS n FROM admin_credit_adjustments WHERE id=?',[cmd.requestKey]);assert.equal(adjust.n,0);
    const [[sum]]=await pool.execute('SELECT SUM(delta) AS balance FROM credit_ledger WHERE user_id=?',[id]);assert.equal(Number(sum.balance),before.credits);
    const reopened=createAccounts({auditStore:store,env:{}});assert.equal((await reopened.adminSummary()).users[0].credits,before.credits);
  });
});
