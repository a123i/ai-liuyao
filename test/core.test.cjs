const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../src/server');
const { createMySqlAuditStore } = require('../src/mysql-store');
const { createAccounts, passwordHash, passwordMatches, requestToken } = require('../src/accounts');
const { extractRequestMeta } = require('../src/audit');
const { createShakeController } = require('../public/shake-controller');
const engine = require('../public/engine');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/iching-data.js'),'utf8') + '\nthis.data=ICHING_TEXT;', context);
function input() {
  const cast = engine.cast([0,1,2,3,1,2], new Date('2026-09-22T03:04:05Z'), context.data);
  return { question:'最近学习安排如何调整？',model:'deepseek-flash',timestamp:cast.timestamp,cast };
}
function store() {
  return { enabled:false,logVisit:async()=>{},logAIRecord:async()=>{},health:async()=>({ok:false}),listVisits:async()=>[],listAIRecords:async()=>[] };
}
async function listening(t, options) {
  const server = createServer(options);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();}));
  return { server, url:'http://127.0.0.1:'+server.address().port };
}
test('same password gets unique hashes and invalid password never matches',async()=>{
  const a=await passwordHash('correct-long-password'),b=await passwordHash('correct-long-password');
  assert.notEqual(a,b);
  assert.equal(await passwordMatches('correct-long-password',a),true);
  assert.equal(await passwordMatches('different-password',a),false);
});
test('only trusted proxy supplies client IP',()=>{
  const req={headers:{'x-forwarded-for':'8.8.8.8','x-real-ip':'1.1.1.1'},socket:{remoteAddress:'::ffff:127.0.0.1'}};
  assert.equal(extractRequestMeta(req,new URL('http://localhost')).ip,'127.0.0.1');
  assert.equal(extractRequestMeta(req,new URL('http://localhost'),'r',true).ip,'1.1.1.1');
});
test('access metadata redacts URL credentials and removes referrer query',()=>{
  const req={headers:{referer:'https://example.test/page?token=secret#private'},socket:{remoteAddress:'127.0.0.1'}};
  const meta=extractRequestMeta(req,new URL('https://localhost/?api_key=secret&source=friend'));
  assert.ok(!meta.query_string.includes('secret'));
  assert.ok(meta.query_string.includes('source=friend'));
  assert.equal(meta.referrer,'https://example.test/page');
});
test('quota is on by default and can only be disabled explicitly',()=>{
  assert.equal(createAccounts({auditStore:store(),env:{}}).settings.quotaEnabled,true);
  assert.equal(createAccounts({auditStore:store(),env:{QUOTA_ENABLED:'false'}}).settings.quotaEnabled,false);
});
test('six stops freeze time only at the final stop',()=>{
  let captures=0;
  const shake=createShakeController({random:()=>0.6,captureTime:()=>{captures++;return {display:'frozen'};}});
  shake.start();
  for(let i=0;i<5;i++){shake.stopNext();assert.equal(captures,0);}
  shake.stopNext();
  assert.equal(captures,1);
  shake.tick();shake.stopNext();
  assert.equal(shake.snapshot().completedAt.display,'frozen');
  assert.equal(captures,1);
});
test('initialization recovers after database becomes reachable',async()=>{
  let calls=0,fail=true;
  const pool={query:async()=>{calls++;if(fail)throw Object.assign(new Error('offline'),{code:'ETIMEDOUT'});}};
  const audit=createMySqlAuditStore({config:{host:'unused'},mysql:{createPool:()=>pool}});
  await assert.rejects(audit.ready());
  fail=false;
  await audit.ready();
  assert.equal(calls,3);
});
test('CORS is explicit, secrets are not static assets, ETag revalidates',async t=>{
  const {url}=await listening(t,{auditStore:store(),env:{},complete:async()=> 'ok'});
  const home=await fetch(url);
  assert.equal(home.status,200);
  assert.match(await home.text(),/account-ui.js/);
  assert.equal((await fetch(url,{headers:{'If-None-Match':home.headers.get('etag')}})).status,304);
  assert.equal((await fetch(url+'/.env')).status,404);
  assert.equal((await fetch(url+'/api/account',{headers:{origin:'https://untrusted.test'}})).status,403);
  assert.equal((await fetch(url+'/api/divine',{method:'POST',headers:{'Content-Type':'text/plain'},body:'x'})).status,415);
});
test('quota mode requires a real session, never trusts browser credits',async t=>{
  let calls=0;
  const {url}=await listening(t,{auditStore:store(),env:{QUOTA_ENABLED:'true'},complete:async()=>{calls++;return 'ok';}});
  const r=await fetch(url+'/api/divine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input(),credits:100,requestKey:'0123456789012345'})});
  assert.equal(r.status,401);assert.equal(calls,0);
});
test('disabled ad provider cannot issue or grant fake rewards',async()=>{
  const accounts=createAccounts({auditStore:store(),env:{}});
  await assert.rejects(accounts.rewardTicket('x'),{code:'ADS_UNAVAILABLE'});
  await assert.rejects(accounts.grantCSJ({trans_id:'x',extra:'a'.repeat(64),sign:'fake'}),{code:'INVALID_REWARD'});
});
test('database failure is visible in admin, not silently shown as no records',async t=>{
  const {url}=await listening(t,{auditStore:store(),adminToken:'only-for-tests',env:{},complete:async()=> 'ok'});
  const r=await fetch(url+'/api/admin/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'only-for-tests'})});
  assert.equal(r.status,503);
  assert.match((await r.json()).error,/数据库/);
});
module.exports={input,listening};
