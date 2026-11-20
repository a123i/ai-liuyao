const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const mysql = require('mysql2/promise');
const { createAccounts } = require('../src/accounts');
const { createMySqlAuditStore } = require('../src/mysql-store');
const { createServer } = require('../src/server');
const { validateRequest } = require('../src/divination');
const { groundedComplete } = require('./grounded-fixture.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../public/engine');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../public/iching-data.js'),'utf8')+'\nthis.data=ICHING_TEXT;',context);

function httpPayload() {
  const cast=engine.cast([0,1,2,3,1,2],new Date('2026-09-22T03:04:05Z'),context.data);
  // The VM text data contains cross-realm arrays. Reproduce the actual JSON
  // wire representation before the low-level AI fixture revalidates the cast.
  return JSON.parse(JSON.stringify({question:'最近学习安排如何调整？',model:'deepseek-flash',timestamp:cast.timestamp,cast,requestKey:'http-request-0001'}));
}

test('MySQL HTTP fixture is canonical JSON before the upstream mock revalidates it', () => {
  assert.doesNotThrow(() => validateRequest(httpPayload()));
});

test('real MySQL: transactional credits, retry, refunds, reward replay and HTTP integration', {skip:!process.env.MYSQL_TEST_PORT}, async t=>{
  // Isolated, newly created schema on loopback only. Never uses production MYSQL_* variables.
  const admin=await mysql.createConnection({host:'127.0.0.1',port:Number(process.env.MYSQL_TEST_PORT),user:'root',password:process.env.MYSQL_TEST_PASSWORD||'',timezone:'Z'});
  const database='sixyao_test_'+crypto.randomBytes(8).toString('hex');
  await admin.query('CREATE DATABASE `'+database+'`');
  const store=createMySqlAuditStore({config:{host:'127.0.0.1',port:Number(process.env.MYSQL_TEST_PORT),user:'root',password:process.env.MYSQL_TEST_PASSWORD||'',database,timezone:'Z',connectionLimit:8}});
  t.after(async()=>{await store.close();await admin.query('DROP DATABASE `'+database+'`');await admin.end();});
  const env={QUOTA_ENABLED:'true',WELCOME_CREDITS:'1',REWARD_PROVIDER:'csj',CSJ_REWARD_SECURITY_KEY:'integration-test-only',REWARD_DAILY_LIMIT:'2'};
  const accounts=createAccounts({auditStore:store,env});
  const pool=store.getPool();
  const payload={question:'test',model:'test'};
  let alice;
  const request=token=>({headers:{cookie:'sixyao_session='+token}});
  const credits=async user=>(await accounts.current(request(user.token),true)).credits;
  const callback=(ticket,trans,overrides={})=>({user_id:ticket.userId,extra:ticket.ticket,trans_id:trans,sign:crypto.createHash('sha256').update(env.CSJ_REWARD_SECURITY_KEY+':'+trans).digest('hex'),...overrides});

  await t.test('welcome once, salted password, session token hashed, login/logout',async()=>{
    alice=await accounts.register({username:'alice_test',password:'test-password-123'});
    assert.equal(alice.user.credits,1);
    await assert.rejects(accounts.register({username:'alice_test',password:'test-password-123'}),{code:'USERNAME_TAKEN'});
    await assert.rejects(accounts.login({username:'alice_test',password:'wrong-password-123'}),{code:'LOGIN_FAILED'});
    const login=await accounts.login({username:'alice_test',password:'test-password-123'});
    assert.equal(login.user.id,alice.user.id);
    assert.equal(login.user.credits,1);
    const [[session]]=await pool.query('SELECT token_hash FROM app_sessions LIMIT 1');
    assert.notEqual(session.token_hash,alice.token);
    await accounts.logout(request(login.token));
    assert.equal(await accounts.current(request(login.token)),null);
  });
  await t.test('concurrent same request charged once; cache reuse costs zero',async()=>{
    const outcomes=await Promise.allSettled([accounts.reserve(alice.user.id,'same-request-0001',payload),accounts.reserve(alice.user.id,'same-request-0001',payload)]);
    const fulfilled=outcomes.filter(x=>x.status==='fulfilled');
    assert.equal(fulfilled.length,1);
    assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'IN_PROGRESS');
    assert.equal(await credits(alice),0);
    await accounts.finish(fulfilled[0].value,'real persisted answer','test');
    const cached=await accounts.reserve(alice.user.id,'same-request-0001',payload);
    assert.equal(cached.cached,true);assert.equal(cached.answer,'real persisted answer');assert.equal(cached.credits,0);
    await assert.rejects(accounts.reserve(alice.user.id,'same-request-0001',{question:'changed'}),{code:'REQUEST_CONFLICT'});
    await assert.rejects(accounts.reserve(alice.user.id,'different-request-0001',payload),{code:'NO_CREDITS'});
  });
  await t.test('signed reward only; duplicate and changed transaction cannot double grant; daily cap',async()=>{
    const ticket=await accounts.rewardTicket(alice.user.id);
    assert.equal((await accounts.rewardTicket(alice.user.id)).ticket,ticket.ticket);
    await assert.rejects(accounts.grantCSJ(callback(ticket,'ad-1',{sign:'fake'})),{code:'INVALID_REWARD'});
    assert.deepEqual(await accounts.grantCSJ(callback(ticket,'ad-1',{user_id:'someone-else'})),{isValid:false});
    const grants=await Promise.all([accounts.grantCSJ(callback(ticket,'ad-1',{reward_amount:'999999'})),accounts.grantCSJ(callback(ticket,'ad-1'))]);
    assert.ok(grants.every(x=>x.isValid));
    assert.equal(await credits(alice),1);
    assert.deepEqual(await accounts.grantCSJ(callback(ticket,'ad-other')),{isValid:false});
    const ticket2=await accounts.rewardTicket(alice.user.id);
    assert.deepEqual(await accounts.grantCSJ(callback(ticket2,'ad-1')),{isValid:false});
    assert.deepEqual(await accounts.grantCSJ(callback(ticket2,'ad-2')),{isValid:true});
    assert.equal(await credits(alice),2);
    await assert.rejects(accounts.rewardTicket(alice.user.id),{code:'REWARD_LIMIT'});
  });
  await t.test('failure refund is idempotent; abandoned request restores on account refresh',async()=>{
    const reservation=await accounts.reserve(alice.user.id,'refund-request-0001',payload);
    assert.equal(await credits(alice),1);
    await Promise.all([accounts.refund(reservation),accounts.refund(reservation)]);
    assert.equal(await credits(alice),2);
    const abandoned=await accounts.reserve(alice.user.id,'abandoned-request-001',payload);
    await pool.execute('UPDATE credit_requests SET updated_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 11 MINUTE) WHERE id=?',[abandoned.id]);
    assert.equal(await credits(alice),2);
    await accounts.refund(abandoned);
    assert.equal(await credits(alice),2);
  });
  await t.test('expiry and ownership enforced; ledger equals balance after reopening store',async()=>{
    const bob=await accounts.register({username:'bob_test',password:'test-password-123'});
    const ticket=await accounts.rewardTicket(bob.user.id);
    await pool.execute('UPDATE reward_tickets SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[ticket.ticket]);
    assert.deepEqual(await accounts.grantCSJ(callback(ticket,'ad-expired')),{isValid:false});
    assert.deepEqual(await accounts.rewardStatus(alice.user.id,ticket.ticket),{rewarded:false});
    const reopened=createAccounts({auditStore:store,env});
    assert.equal((await reopened.current(request(alice.token))).credits,2);
    const [[ledger]]=await pool.execute('SELECT SUM(delta) AS total FROM credit_ledger WHERE user_id=?',[alice.user.id]);
    assert.equal(Number(ledger.total),2);
    assert.equal((await accounts.adminSummary()).users.length,2);
  });
  await t.test('different concurrent AI requests cannot both reserve for one account',async()=>{
    const outcomes=await Promise.allSettled([accounts.reserve(alice.user.id,'concurrent-key-0001',payload),accounts.reserve(alice.user.id,'concurrent-key-0002',payload)]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'IN_PROGRESS');
    await accounts.refund(outcomes.find(x=>x.status==='fulfilled').value);
    assert.equal(await credits(alice),2);
  });
  await t.test('HTTP successful answer audit + charged once, upstream failure refunded',async()=>{
    let calls=0,fail=false;
    const raw=httpPayload();
    const cast=raw.cast;
    const checkedComplete=groundedComplete(raw,{onCall:()=>{calls++;}});
    const server=createServer({auditStore:store,accounts,env,adminToken:'test-admin',complete:async request=>{
      if(fail){calls++;throw new Error('mock upstream failure');}
      return checkedComplete(request);
    }});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const url='http://127.0.0.1:'+server.address().port;
      const post=body=>fetch(url+'/api/divine',{method:'POST',headers:{'Content-Type':'application/json',cookie:'sixyao_session='+alice.token},body:JSON.stringify(body)});
      const ok=await post(raw);assert.equal(ok.status,200);const completed=await ok.json();assert.equal(completed.credits,1);
      assert.match(completed.answer,/^一、专业分析/);assert.match(completed.answer,/二、通俗解读/);
      assert.equal((await post(raw)).status,200);assert.equal(calls,3);
      fail=true;
      assert.equal((await post({...raw,requestKey:'http-failure-0001'})).status,500);
      assert.equal(await credits(alice),1);
      const records=await store.listAIRecords();
      assert.equal(records.length,2);
      assert.equal(records.find(x=>x.success).ai_answer,completed.answer);
      const questions=await accounts.adminUserQuestions({userId:alice.user.id,limit:2});
      assert.equal(questions.user.username,'alice_test');
      assert.equal(questions.items.length,2);
      assert.equal(questions.items[0].question,raw.question);
      assert.equal(questions.items[0].cast_time,cast.timestamp.display);
      assert.equal(questions.items[0].status,'failed');
      assert.equal(questions.items[1].status,'completed');
      assert.equal(questions.items[1].answer,completed.answer);
      assert.ok(questions.nextCursor);
      const older=await accounts.adminUserQuestions({userId:alice.user.id,cursor:questions.nextCursor,limit:2});
      assert.ok(older.items.every(item=>Number(item.id)<Number(questions.nextCursor)));
      const bob=(await accounts.adminSummary()).users.find(item=>item.username==='bob_test');
      assert.deepEqual((await accounts.adminUserQuestions({userId:bob.id})).items,[]);
      const r=await fetch(url+'/api/admin/credits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'test-admin'})});
      assert.equal(r.status,200);assert.equal((await r.json()).users.length,2);
    }finally{await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});}
  });
});
