const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { validateRequest } = require('../src/divination');
const { createDeepSeekClient } = require('../src/deepseek');
const { createServer } = require('../src/server');
const client = require('../public/ai-divination');
const engine = require('../public/engine');

const source=fs.readFileSync(path.join(__dirname,'../public/iching-data.js'),'utf8').trim();
const textDB=JSON.parse(source.replace(/^const ICHING_TEXT\s*=\s*/, '').replace(/;$/, ''));
const payload = model => {
  const cast=engine.cast([0,1,2,3,1,2],new Date('2026-09-22T03:04:05Z'),textDB);
  return { question:'部署验证',model,timestamp:cast.timestamp,cast };
};

test('only V4.1 Flash is selectable; retired client Flash id is normalized', () => {
  assert.deepEqual(client.MODELS.map(m=>m.id), ['deepseek-flash']);
  assert.equal(client.DEFAULT_MODEL, 'deepseek-flash');
  assert.equal(validateRequest(payload('deepseek-flash')).model, 'deepseek-flash');
  assert.equal(validateRequest(payload('deepseek-v4-flash')).model, 'deepseek-flash');
  assert.throws(()=>validateRequest(payload('deepseek-v4-pro')), /Pro 模型暂未开放/);
  assert.throws(()=>validateRequest(payload('other-model')), /有效模型/);
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  assert.match(source, /id="aiModelPro"[^>]*disabled[^>]*>Pro<small>暂未开放/);
  assert.match(source, /V4\.1 Flash/);
});

test('upstream uses official deepseek-flash ID and never calls Pro', async () => {
  let calls=0;
  const ai=createDeepSeekClient({apiKey:'test-key',fetchImpl:async(url,options)=>{
    calls++;
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    const body=JSON.parse(options.body);
    assert.equal(body.model,'deepseek-flash');
    assert.deepEqual(body.thinking,{type:'disabled'});
    assert.equal(body.stream,false);
    return {ok:true,json:async()=>({choices:[{message:{content:'验证成功'},finish_reason:'stop'}]})};
  }});
  assert.equal(await ai.complete({model:'deepseek-flash',messages:[]}), '验证成功');
  await assert.rejects(ai.complete({model:'deepseek-v4-pro',messages:[]}), {code:'MODEL_UNAVAILABLE'});
  assert.equal(calls,1);
});

test('HTTP rejects Pro before reserving credits or sending an AI request', async t => {
  let calls=0, reserves=0;
  const auditStore={logVisit:async()=>{},logAIRecord:async()=>{},health:async()=>({ok:true})};
  const accounts={settings:{quotaEnabled:true},current:async()=>({id:'test',credits:1}),reserve:async()=>{reserves++;}};
  const server=createServer({auditStore,accounts,env:{},complete:async()=>{calls++;return 'wrong';}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();}));
  const result=await fetch('http://127.0.0.1:'+server.address().port+'/api/divine', {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...payload('deepseek-v4-pro'),requestKey:'pro-disabled-0001'})
  });
  assert.equal(result.status,400);
  assert.match((await result.json()).error,/Pro 模型暂未开放/);
  assert.equal(calls,0);
  assert.equal(reserves,0);
});
