const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { once } = require('node:events');
const { adminPage } = require('../src/admin-page');
const { createServer } = require('../src/server');
const presentation = require('../public/answer-presentation');
const html = adminPage();
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const helpers = vm.createContext({ URL, Intl, Date, LiuYaoAnswerPresentation: presentation });
vm.runInContext(script.split('// UI bindings.')[0], helpers);

test('admin page has four readable sections, private login, responsive records and valid client script', () => {
  new vm.Script(script);
  assert.match(html, /测了吗 · 管理后台/);
  for (const view of ['overview','ai','visits','users']) assert.ok(html.includes('data-view="'+view+'"'));
  assert.match(html, /不是全站累计数据/);
  assert.match(html, /<dialog[^>]+aria-labelledby="detailTitle"/);
  assert.match(html, /<input id="token" type="password"/);
  assert.match(html, /@media\(max-width:760px\)/);
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|eval\(/);
});

test('admin dates consistently use Beijing time, including SQL strings and explicit offsets', () => {
  assert.match(helpers.formatTime('2026-09-22 03:04:05.000'), /2026\/09\/22 11:04:05/);
  assert.equal(helpers.formatTime('2026-09-22T03:04:05Z'), helpers.formatTime('2026-09-22T11:04:05+08:00'));
  assert.equal(helpers.formatTime(null), '—');
  assert.equal(helpers.formatTime('bad'), '时间格式异常');
  assert.equal(helpers.yes('0'), false);
  assert.equal(helpers.yes('1'), true);
});

test('search combines with result, balance and WeChat filters without mutating data', () => {
  const ai = [{success:true,question:'学习计划',ai_answer:'稳步调整',model:'deepseek-flash'},{success:false,question:'求职计划',ai_answer:'',model:'deepseek-flash'}];
  assert.equal(helpers.filterRows(ai,'调整','success','ai').length, 1);
  assert.equal(helpers.filterRows(ai,'计划','failure','ai')[0].question, '求职计划');
  assert.equal(helpers.filterRows(ai,'FLASH','all','ai').length, 2);
  assert.equal(helpers.filterRows([{credits:0,username:'A'},{credits:3,username:'B'}],'','empty','users')[0].username, 'A');
  assert.equal(helpers.filterRows([{is_wechat:'0'},{is_wechat:1}],'','wechat','visits').length, 1);
  assert.equal(helpers.filterRows([{reason:'refund',username:'A'}],'退回','refund','ledger').length, 1);
  assert.equal(ai.length, 2);
});

test('pagination clamps page after a filter change and handles empty results', () => {
  const rows=Array.from({length:31},(_,i)=>i);
  assert.equal(helpers.pageSlice(rows,2,15).rows[0],15);
  assert.equal(helpers.pageSlice(rows,9,15).current,3);
  assert.equal(helpers.pageSlice([],9,15).start,0);
  assert.equal(helpers.pageSlice([],9,15).end,0);
});

// Lightweight DOM doubles exercise UI state transitions without a browser or real data.
function clientHarness() {
  class Element {
    constructor(){this.children=[];this.dataset={};this.style={};this.value='';this.textContent='';this.hidden=false;this.open=false;this.events={}}
    append(...nodes){this.children.push(...nodes)}
    replaceChildren(...nodes){this.children=nodes;this.textContent=''}
    setAttribute(name,value){this[name]=value}
    removeAttribute(name){delete this[name]}
    addEventListener(name,callback){this.events[name]=callback}
    focus(){}
    close(){this.open=false;this.events.close?.()}
    showModal(){this.open=true}
  }
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)};
  get('#limit').value='100';get('#token').value='preview';
  let fetcher;
  const copied=[];
  const storage=new Map();
  const context=vm.createContext({Node:Element,URL,Intl,Date,AbortController,setTimeout,clearTimeout,console,crypto:require('node:crypto'),LiuYaoAnswerPresentation:presentation,
    document:{querySelector:get,querySelectorAll:()=>[],createElement:()=>new Element(),body:new Element()},
    navigator:{clipboard:{writeText:async value=>{copied.push(value)}}},
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    fetch:(...args)=>fetcher(...args)
  });
  vm.runInContext(script,context);
  const run=source=>vm.runInContext(source,context);
  return {get,storage,run,copied,setFetch:fn=>{fetcher=fn}};
}

test('admin record details, account answers and copy hide historical proof IDs without rewriting records', async()=>{
  const h=clientHarness();
  const raw='推论（依据：L3.MONTH、L3.DAY、SHI_YING）：工作用神L3官鬼辰土。';
  const row={id:1,success:true,ai_answer:raw,question:'工作如何？'};
  h.run('openAI('+JSON.stringify(row)+')');
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const nodes=descendants(h.get('#detailBody'));
  const shown=nodes.find(node=>node.className==='answer');
  assert.equal(shown.textContent,presentation.toDisplayAnswer(raw));
  await nodes.find(node=>node.textContent==='复制回复').onclick();
  assert.equal(h.copied[0],shown.textContent);
  const item=h.run('questionItem('+JSON.stringify({answer:raw,question:'工作如何？'})+')');
  assert.equal(descendants(item).find(node=>node.className==='answer').textContent,shown.textContent);
  assert.equal(row.ai_answer,raw);
});
const goodRecords={db:{ok:true},visits:[{id:1,ip:'192.0.2.1'}],aiRecords:[]};
const goodCredits={users:[{username:'fixture',credits:1}],ledger:[],rewards:[]};
const response=(data,status=200)=>Promise.resolve({ok:status===200,status,json:async()=>data});

test('partial load clears stale users, reports an error and never claims zero records', async()=>{
  const h=clientHarness();h.setFetch(path=>response(path.endsWith('records')?goodRecords:goodCredits));
  await h.run('loadRecords()');assert.equal(h.run('state.credits.users.length'),1);
  h.setFetch(path=>path.endsWith('records')?response(goodRecords):response({error:'database unavailable'},503));
  await h.run('loadRecords()');h.run("changeView('users')");
  assert.equal(h.run('state.credits'),null);assert.match(h.get('#status').textContent,/部分数据/);
  assert.match(h.get('#resultCount').textContent,/读取失败/);assert.equal(h.get('#tableBody').children.length,0);
});

test('logout clears secrets and data, and an in-flight response cannot reopen the page',async()=>{
  const h=clientHarness();h.setFetch(path=>response(path.endsWith('records')?goodRecords:goodCredits));await h.run('loadRecords()');
  const completions=[];h.setFetch(path=>new Promise(resolve=>completions.push(()=>resolve({ok:true,status:200,json:async()=>path.endsWith('records')?goodRecords:goodCredits}))));
  const pending=h.run('loadRecords()');h.run('logout()');completions.forEach(fn=>fn());await pending;
  assert.equal(h.run('state.token'),'');assert.equal(h.run('state.data'),null);assert.equal(h.storage.size,0);
  assert.equal(h.get('#workspace').hidden,true);assert.equal(h.get('#loginPanel').hidden,false);
});

test('wrong token removes a remembered session, and wholly failed initial load stays locked',async()=>{
  const h=clientHarness();h.setFetch(()=>response({error:'wrong'},401));await h.run('loadRecords()');assert.equal(h.run('state.token'),'');assert.equal(h.storage.size,0);
  h.get('#token').value='preview';h.setFetch(()=>response({error:'database unavailable'},503));await h.run('loadRecords()');assert.equal(h.run('state.data'),null);assert.equal(h.get('#loginPanel').hidden,false);assert.match(h.get('#status').className,/error/);
});

test('credit form requires confirmation, blocks double submit and preserves the retry request key',async()=>{
  const h=clientHarness();h.setFetch(path=>response(path.endsWith('records')?goodRecords:goodCredits));await h.run('loadRecords()');
  h.run("openCredit({id:'11111111-1111-4111-8111-111111111111',username:'fixture',credits:1,credit_revision:'1'})");
  h.get('#creditAmount').value='10';h.get('#creditNote').value='补偿';
  let writes=0;let payload;
  h.setFetch((path,options)=>{writes++;payload=JSON.parse(options.body);return Promise.reject(new Error('network lost'))});
  await h.run('submitCredit()');assert.equal(writes,0);assert.match(h.get('#creditStatus').textContent,/1 次改为 10 次/);
  await h.run('submitCredit()');assert.equal(writes,1);assert.equal(h.run('state.edit.uncertain'),true);
  const key=payload.requestKey;
  await h.run('submitCredit()');assert.equal(writes,2);assert.equal(payload.requestKey,key);
  h.setFetch(path=>path.endsWith('/update')?response({adjustment:{id:key,before_credits:1,after_credits:10}}):response(path.endsWith('records')?goodRecords:goodCredits));
  await h.run('submitCredit()');assert.equal(h.get('#creditDialog').open,false);assert.match(h.get('#status').textContent,/已保存/);
});

test('credit cancel makes no write; 409 is visible; logout ignores pending save results',async()=>{
  const h=clientHarness();h.setFetch(path=>response(path.endsWith('records')?goodRecords:goodCredits));await h.run('loadRecords()');
  const open="openCredit({id:'11111111-1111-4111-8111-111111111111',username:'fixture',credits:1,credit_revision:'1'})";
  h.run(open);h.get('#creditCancel').onclick();assert.equal(h.run('state.edit'),null);
  h.run(open);h.get('#creditAmount').value='5';h.get('#creditNote').value='测试';await h.run('submitCredit()');
  h.setFetch(()=>response({error:'次数已有变动，请刷新',code:'CREDITS_CHANGED'},409));await h.run('submitCredit()');assert.match(h.get('#creditStatus').textContent,/次数已有变动/);
  let resolve;let writes=0;h.setFetch(()=>{writes++;return new Promise(r=>{resolve=r})});
  const pending=h.run('submitCredit()');await h.run('submitCredit()');assert.equal(writes,1);
  h.run('logout()');resolve({ok:true,status:200,json:async()=>({})});await pending;
  assert.equal(h.run('state.edit'),null);assert.equal(h.get('#workspace').hidden,true);assert.equal(h.get('#creditAmount').value,'');
});

test('clicking an account loads only its AI questions, paginates, and shows full replies safely',async()=>{
  const h=clientHarness();h.setFetch(path=>response(path.endsWith('records')?goodRecords:goodCredits));await h.run('loadRecords()');
  const userId='11111111-1111-4111-8111-111111111111';
  const calls=[];h.setFetch((path,options)=>{
    assert.equal(path,'/api/admin/user-questions');
    const body=JSON.parse(options.body);calls.push(body);
    assert.equal(body.userId,userId);assert.equal(body.limit,20);assert.equal(body.token,'preview');
    if(!body.cursor)return response({user:{id:userId,username:'fixture'},items:[{id:'2',created_at:'2026-09-22 03:04:05',question:'<img src=x onerror=alert(1)>',cast_time:'2026-09-22 11:04:05',model:'deepseek-flash',status:'completed',answer:'完整的 AI 回复'}],nextCursor:'2'});
    assert.equal(body.cursor,'2');
    return response({user:{id:userId,username:'fixture'},items:[{id:'1',created_at:'2026-09-21 03:04:05',question:'第二个问题',status:'failed',answer:''}],nextCursor:null});
  });
  await h.run("openUserQuestions({id:'"+userId+"',username:'fixture'})");
  assert.equal(h.get('#detailTitle').textContent,'用户提问记录');
  assert.equal(h.run('state.userQuestions.loaded'),1);
  assert.equal(h.run('state.userQuestions.more.hidden'),false);
  const first=h.run('state.userQuestions.list.children[0]');
  assert.equal(first.children[1].textContent,'<img src=x onerror=alert(1)>');
  assert.equal(first.children[3].children[1].textContent,'完整的 AI 回复');
  await h.run('loadUserQuestions(state.userQuestions)');
  assert.equal(h.run('state.userQuestions.loaded'),2);
  assert.equal(h.run('state.userQuestions.more.hidden'),true);
  assert.equal(calls.length,2);
  h.get('#detailDialog').close();assert.equal(h.run('state.userQuestions'),null);
});

test('admin HTTP remains no-store and both record endpoints require the original token', async t => {
  const store={enabled:true,logVisit:async()=>{},logAIRecord:async()=>{},health:async()=>({ok:true}),listVisits:async()=>[],listAIRecords:async()=>[]};
  const server=createServer({auditStore:store,accounts:{adminSummary:async()=>({users:[],ledger:[],rewards:[]}),adminUserQuestions:async()=>({user:{id:'fixture',username:'fixture'},items:[],nextCursor:null})},adminToken:'admin-test-only',env:{}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections()}));
  const url='http://127.0.0.1:'+server.address().port;
  const page=await fetch(url+'/admin');assert.equal(page.headers.get('cache-control'),'no-store');assert.match(await page.text(),/用户与次数/);
  for(const endpoint of ['/api/admin/records','/api/admin/credits','/api/admin/user-questions']){
    const post=token=>fetch(url+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    assert.equal((await post('wrong')).status,401);
    assert.equal((await post('admin-test-only')).status,200);
  }
});
