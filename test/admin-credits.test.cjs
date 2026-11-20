const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const crypto=require('node:crypto');
const {adminCreditInput,adminQuestionInput}=require('../src/accounts');
const {createServer}=require('../src/server');
const input=()=>({userId:crypto.randomUUID(),requestKey:crypto.randomUUID(),credits:10,expectedCredits:1,expectedRevision:'1',note:'活动赠送'});

test('admin credit input strictly validates integers, identity, revision and bounded notes',()=>{
  assert.equal(adminCreditInput({...input(),credits:0,note:'  补偿  '}).note,'补偿');
  for(const credits of [-1,1.2,1000001,'10',null,true,NaN])assert.throws(()=>adminCreditInput({...input(),credits}),{code:'INVALID_ADJUSTMENT'});
  for(const patch of [{userId:'x'},{requestKey:''},{expectedRevision:1},{expectedRevision:'-1'},{expectedCredits:'1'},{note:' '},{note:'文'.repeat(201)}])assert.throws(()=>adminCreditInput({...input(),...patch}),{status:400});
  assert.throws(()=>adminCreditInput(null),{status:400});
});

test('admin question input validates user identity and bounded pagination',()=>{
  const userId=crypto.randomUUID();
  assert.deepEqual(adminQuestionInput({userId}),{userId,cursor:null,limit:20});
  assert.deepEqual(adminQuestionInput({userId,cursor:'123',limit:999}),{userId,cursor:'123',limit:50});
  for(const patch of [{userId:'x'},{cursor:'0'},{cursor:'-1'},{cursor:'1 OR 1=1'}]){
    assert.throws(()=>adminQuestionInput({userId,...patch}),{code:'INVALID_USER_QUERY'});
  }
});

test('admin user questions endpoint requires admin token and returns only queried account data',async t=>{
  const userId=crypto.randomUUID();
  let calls=0;
  const server=createServer({auditStore:{},adminToken:'test-admin-only',accounts:{adminUserQuestions:async body=>{
    calls++;
    assert.equal(body.userId,userId);
    return {user:{id:userId,username:'fixture'},items:[{question:'我的提问',answer:'模拟回答'}],nextCursor:null};
  }},env:{}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections()}));
  const url='http://127.0.0.1:'+server.address().port+'/api/admin/user-questions';
  const post=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({userId})).status,401);
  assert.equal((await post({userId,token:'wrong'})).status,401);
  assert.equal(calls,0);
  const response=await post({userId,token:'test-admin-only'});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const result=await response.json();
  assert.equal(result.user.username,'fixture');
  assert.equal(result.items[0].question,'我的提问');
  assert.equal(calls,1);
});

test('admin write route requires token and JSON; rejects cross-origin even if allowlisted',async t=>{
  let writes=0;
  const server=createServer({auditStore:{},adminToken:'test-admin-only',accounts:{adminSetCredits:async body=>{writes++;return {user:{credits:body.credits}}}},env:{ALLOWED_ORIGINS:'https://allowed.example'}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections()}));
  const base='http://127.0.0.1:'+server.address().port,url=base+'/api/admin/credits/update';
  const post=(body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post(input())).status,401);
  assert.equal((await post({...input(),token:'bad'})).status,401);
  assert.equal((await post({...input(),token:'test-admin-only'},{Origin:'https://allowed.example'})).status,403);
  assert.equal((await post({...input(),token:'test-admin-only'},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await fetch(url)).status,405);
  assert.equal(writes,0);
  const success=await post({...input(),token:'test-admin-only'},{Origin:base});
  assert.equal(success.status,200);assert.equal(success.headers.get('Cache-Control'),'no-store');assert.equal(writes,1);
});
