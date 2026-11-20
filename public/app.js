const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const TAGS=['初','二','三','四','五','上'];
const STOP_LABELS=['停下初爻（1/6）','停下二爻（2/6）','停下三爻（3/6）','停下四爻（4/6）','停下五爻（5/6）','停下上爻（6/6）'];
const shake=ShakeController.createShakeController({
  random:Math.random,
  captureTime:()=>LiuYao.castTimestamp(new Date())
});
// coins[i] = 三枚硬币是否为背 [bool,bool,bool], index0=初爻
let coins=shake.snapshot().coins;
let shakeTimer=null;
let lastShakeTap=0;
let renderVersion=0;
let selectedModel=AIDivination.DEFAULT_MODEL;
const COPY_ICON='<svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><rect x=\'9\' y=\'9\' width=\'13\' height=\'13\' rx=\'2\'></rect><path d=\'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\'></path></svg>';
let latestCastCopyText='';
let latestAIAnswer='';
let mode='manual';   // 'manual' 手动点选 | 'shake' 随机摇卦
let manualCoinTouched=false;
const LOCK_MSG='已经开始随机摇卦，请勿手动点击改变卦象，如需手动点击，请点击清空按钮。';
let questionConfirmed=false;   // 是否已确认“所测之事”
const NEED_Q_MSG='请先填写并「确认所测之事」，之后才能摇卦或手动选卦。';
function questionText(){return $('#q').value.trim();}

function barHTML(yang,move){
  const cls=yang?'yang':'yin';
  const mk=move?(yang?'<span class=mk>○</span>':'<span class=mk>×</span>'):'<span class=mk></span>';
  if(yang) return '<span class="bar yang"><i></i></span>'+mk;
  return '<span class="bar yin"><i></i><i></i></span>'+mk;
}
function backsOf(i){return coins[i].filter(Boolean).length;}
function yaoOf(i){const b=backsOf(i);return{yang:(b===1||b===3)?1:0,move:(b===3||b===0)};}

// Vector coin faces: the square opening stays transparent on either side.
function coinFaceHTML(i,c,back){
  const id='coin-metal-'+i+'-'+c+'-'+(back?'back':'front');
  const decoration=back
    ? '<g fill="none" stroke="#72502a" stroke-width="2.2" stroke-linecap="round"><path d="M34 24q16-12 32 0M34 76q16 12 32 0M24 34q-12 16 0 32M76 34q12 16 0 32"/><path d="M36 29q14-8 28 0M36 71q14 8 28 0M29 36q-8 14 0 28M71 36q8 14 0 28"/></g><g fill="#72502a"><circle cx="50" cy="25" r="2.4"/><circle cx="50" cy="75" r="2.4"/><circle cx="25" cy="50" r="2.4"/><circle cx="75" cy="50" r="2.4"/></g>'
    : '<g fill="#60401f" font-family="serif" font-size="17" font-weight="700" text-anchor="middle"><text x="50" y="32">乾</text><text x="50" y="82">隆</text><text x="25" y="57">通</text><text x="75" y="57">宝</text></g>';
  return '<span class="coin-face coin-'+(back?'back':'front')+'"><svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="1" y2="1"><stop stop-color="'+(back?'#dec18a':'#f0d499')+'"/><stop offset=".48" stop-color="'+(back?'#ae8144':'#cba15e')+'"/><stop offset="1" stop-color="#846030"/></linearGradient></defs><path d="M50 5a45 45 0 1 1 0 90a45 45 0 1 1 0-90ZM40 40v20h20V40Z" fill="url(#'+id+')" fill-rule="evenodd" stroke="#e3bd76" stroke-width="1.5"/><circle cx="50" cy="50" r="40.5" fill="none" stroke="#76512a" stroke-width="1.8"/><circle cx="50" cy="50" r="37.5" fill="none" stroke="#ffe2a5" stroke-opacity=".4"/><rect x="38" y="38" width="24" height="24" rx="1" fill="none" stroke="#775126" stroke-width="2"/>'+decoration+'</svg></span>';
}

function renderCoins(state){
  state=state||(mode==='shake'?shake.snapshot():{phase:'idle',stopped:0});
  const box=$('#coinBox');
  box.className=mode==='manual'?'manual':'';
  if(!box.children.length){
    for(let i=5;i>=0;i--){
      const row=document.createElement('div');
      row.dataset.line=i;
      row.innerHTML='<div class="tag">'+TAGS[i]+'爻</div><div class="coins"></div><div class="yao-prev"></div>';
      for(let c=0;c<3;c++){
        const coin=document.createElement('button');
        coin.type='button';
        coin.dataset.coin=c;
        coin.innerHTML='<span class="coin-rotor" aria-hidden="true">'+coinFaceHTML(i,c,false)+coinFaceHTML(i,c,true)+'</span>';
        coin.onclick=()=>onCoinClick(i,c);
        row.querySelector('.coins').appendChild(coin);
      }
      box.appendChild(row);
    }
  }
  for(const row of box.children){
    const i=Number(row.dataset.line);
    const rolling=state.phase==='rolling'&&i===state.stopped;
    const waiting=state.phase==='rolling'&&i>state.stopped;
    row.className='row'+(i<state.stopped?' stopped':'')+(rolling?' rolling':'')+(waiting?' waiting':'');
    row.setAttribute('aria-busy',String(rolling));
    for(const el of row.querySelector('.coins').children){
      const c=Number(el.dataset.coin);
      const label=coins[i][c]?'背面（背，阳）':'正面（字，阴）';
      el.className='coin'+(coins[i][c]?' bei':'');
      el.disabled=mode!=='manual'||!questionConfirmed;
      el.setAttribute('aria-label',TAGS[i]+'爻，第'+(c+1)+'枚铜钱，'+(rolling?'翻转中':waiting?'待摇':label));
      el.setAttribute('aria-pressed',String(coins[i][c]));
    }
    const y=yaoOf(i),b=backsOf(i);
    const preview=rolling?'<span class="coin-state">翻转中</span>':waiting?'<span class="coin-state">待摇</span>':barHTML(y.yang,y.move)+'<br>'+(['老阴','少阳','少阴','老阳'][b]);
    const previewKey=rolling?'rolling':waiting?'waiting':String(b);
    const target=row.querySelector('.yao-prev');
    if(target.dataset.preview!==previewKey){target.innerHTML=preview;target.dataset.preview=previewKey;}
  }
  const progress=$('#shakeProgress');
  progress.setAttribute('aria-label','已停定 '+state.stopped+' / 6 爻');
  [...progress.children].forEach((el,i)=>el.classList.toggle('done',i<state.stopped));
}

// 手动点选铜钱；摇卦进行中点击则提示锁定
function onCoinClick(i,c){
  if(mode==='shake'){ toast(LOCK_MSG); return; }
  if(!questionConfirmed){ toast(NEED_Q_MSG); $('#q').focus(); return; }
  coins[i][c]=!coins[i][c];
  manualCoinTouched=true;
  invalidateResult();
  renderCoins({phase:'idle',stopped:0});
}

function invalidateResult(){
  renderVersion++;
  latestCastCopyText='';
  latestAIAnswer='';
  $('#result').classList.add('hidden');
}

function stopShakeTimer(){
  if(shakeTimer!==null){clearInterval(shakeTimer);shakeTimer=null;}
}
function startShakeTimer(){
  stopShakeTimer();
  if(document.hidden)return;
  shakeTimer=setInterval(()=>{shake.tick();syncShakeView();},110);
}
function shakeButtonText(state){
  if(state.phase==='idle')return '开始摇卦';
  if(state.phase==='complete')return '重新摇卦';
  return STOP_LABELS[state.stopped];
}
function shakeStatusText(state){
  if(state.phase==='complete'&&state.timeError)return '六爻已停定，但无法读取起卦时间，请重新摇卦';
  if(state.phase==='complete')return `六爻已停定 · 起卦时间 ${state.completedAt.display}（北京时间）`;
  if(state.stopped===0)return '初爻铜钱正在翻转，点击「停下初爻」定格（1/6）';
  return `${TAGS[state.stopped-1]}爻已定格 · ${TAGS[state.stopped]}爻正在翻转，请点击停下（${state.stopped+1}/6）`;
}
function syncShakeView(){
  const state=shake.snapshot();
  coins=state.coins;
  renderCoins(state);
  $('#rnd').textContent=shakeButtonText(state);
  $('#shakeStatus').textContent=shakeStatusText(state);
  $('#go').disabled=!(state.phase==='complete'&&state.completedAt);
  $('#q').disabled=state.phase==='rolling';
}
// 切回手动模式（默认）
function renderManual(){
  mode='manual';
  renderCoins({phase:'idle',stopped:0});
  $('#rnd').textContent='开始摇卦';
  $('#rnd').disabled=!questionConfirmed;
  $('#go').disabled=!questionConfirmed;
  $('#shakeStatus').textContent=questionConfirmed?'手动点击铜钱定卦，或点「开始摇卦」随机起卦':'请先填写并「确认所测之事」';
  $('#manualTimeWrap').classList.remove('hidden');
}
function handleShake(){
  if(performance.now()-lastShakeTap<220)return;
  lastShakeTap=performance.now();
  if(navigator.vibrate)navigator.vibrate(12);
  if(mode==='manual'){               // 由手动进入随机摇卦
    if(!questionConfirmed){ toast(NEED_Q_MSG); $('#q').focus(); return; }
    mode='shake';
    $('#manualTimeWrap').classList.add('hidden');
    shake.start();
    invalidateResult();
    startShakeTimer();
    syncShakeView();
    return;
  }
  const current=shake.snapshot();
  if(current.phase!=='rolling'){      // complete 后再点 = 重新摇卦
    shake.start();
    invalidateResult();
    startShakeTimer();
  }else{
    shake.tick();
    const next=shake.stopNext();
    if(next.phase==='complete')stopShakeTimer();
  }
  syncShakeView();
}
function clearAll(){
  renderVersion++;
  $('#q').disabled=false;
  stopShakeTimer();
  shake.reset();
  coins=shake.snapshot().coins;        // 重置为全字
  manualCoinTouched=false;
  latestCastCopyText='';
  latestAIAnswer='';
  $('#result').classList.add('hidden');
  renderManual();
}

function yaoName(pos,yang){
  const digit=yang?'九':'六';
  return pos===1||pos===6?TAGS[pos-1]+digit:digit+TAGS[pos-1];
}

function lineCellBen(l){
  const fu = l.fu ? `<div class="fu">${l.fu.liuqin}${l.fu.gan}${l.fu.zhi}</div>` : '';
  const sy = l.shi?'<span class="sy s">世</span>':(l.ying?'<span class="sy y">应</span>':'');
  const kong = l.kong?'<span class="kong">空</span>':'';
  return `<td>${l.liushen}</td>`+
         `<td class="fu">${l.fu?(l.fu.liuqin+l.fu.gan+l.fu.zhi):''}</td>`+
         `<td class="lq ${l.move?'move':''}">${l.liuqin}</td>`+
         `<td class="gz">${l.gan}${l.zhi}<span class="wx">${l.wx}</span> ${kong}</td>`+
         `<td>${barHTML(l.yang,l.move)}</td>`+
         `<td>${sy}</td>`;
}
function lineCellChg(l){
  if(!l) return '<td></td><td></td><td></td>';
  if(!l.move) return `<td class="lq">—</td><td class="gz">—</td><td>${barHTML(l.yang,false)}</td>`;
  return `<td class="lq">${l.liuqin}</td>`+
         `<td class="gz">${l.gan}${l.zhi}<span class="wx">${l.wx}</span></td>`+
         `<td>${barHTML(l.yang,false)}</td>`;
}

function renderTimestamp(timestamp){
  const labels={year:'年柱',month:'月柱',day:'日柱',hour:'时柱'};
  const cards=Object.entries(labels).map(([key,label])=>{
    const pillar=timestamp.pillars[key];
    return `<div class="pillar-card" data-pillar="${key}"><span>${label}</span><b>${pillar.text}</b><small>旬空：${pillar.kong.join('')}</small></div>`;
  }).join('');
  return `<div class="cast-time"><div class="cast-time-title">起卦时间：${timestamp.display}（北京时间）</div><div class="pillar-grid">${cards}</div></div>`;
}

function toast(msg){
  const old=$('.toast');
  if(old) old.remove();
  const el=document.createElement('div');
  el.className='toast';
  el.setAttribute('role','status');
  el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),1800);
}

async function copyText(text,label){
  if(!text){toast(`${label}暂无内容`);return;}
  try{
    await navigator.clipboard.writeText(text);
    toast(`${label}已复制`);
  }catch{
    const textarea=document.createElement('textarea');
    textarea.value=text;
    textarea.setAttribute('readonly','');
    textarea.style.position='fixed';
    textarea.style.left='-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    let copied=false;
    try{copied=document.execCommand('copy');}finally{textarea.remove();}
    toast(copied?`${label}已复制`:'暂时无法复制，请长按内容选择复制');
  }
}

function pillarCopyText(timestamp){
  const labels={year:'年',month:'月',day:'日',hour:'时'};
  return Object.entries(labels).map(([key,label])=>{
    const p=timestamp.pillars[key];
    return `${label}${p.text}（旬空${p.kong.join('')}）`;
  }).join(' ');
}

function buildCastCopyText(res){
  const lines=[];
  const q=questionText();
  if(q) lines.push(`所测之事：${q}`);
  lines.push(`起卦时间：${res.timestamp.display}（北京时间）`);
  lines.push(`四柱：${pillarCopyText(res.timestamp)}`);
  lines.push(`日辰：${res.day.text}　旬空：${res.kong.join('')}`);
  lines.push(`本卦：${res.ben.name}（${res.ben.palace}宫·${res.ben.gongType}）`);
  if(res.hasMove&&res.chg) lines.push(`变卦：${res.chg.name}（${res.chg.palace}宫·${res.chg.gongType}）`);
  lines.push(`本卦卦辞：${res.ben.guaci}`);
  if(res.hasMove&&res.chg) lines.push(`变卦卦辞：${res.chg.guaci}`);
  const movers=[];
  res.ben.lines.forEach((l,i)=>{if(l.move)movers.push(`${yaoName(l.pos,l.yang)}：${res.ben.yaoci[i]||''}`);});
  if(movers.length) lines.push('动爻：',...movers);
  lines.push('六爻排盘（自上而下）：');
  for(let p=5;p>=0;p--){
    const l=res.ben.lines[p];
    const c=res.hasMove&&res.chg?res.chg.lines[p]:null;
    const fu=l.fu?` 伏神${l.fu.liuqin}${l.fu.gan}${l.fu.zhi}`:'';
    const sy=l.shi?' 世':(l.ying?' 应':'');
    const move=l.move?' 动':'';
    const kong=l.kong?' 空':'';
    const chg=l.move&&c?` → ${c.liuqin}${c.gan}${c.zhi}${c.wx}`:'';
    lines.push(`${TAGS[p]}爻 ${l.liushen}${fu} ${l.liuqin}${l.gan}${l.zhi}${l.wx}${kong}${sy}${move}${chg}`);
  }
  return lines.join('\n');
}

function buildAllCopyText(){
  return latestCastCopyText+(latestAIAnswer?`\n\nAI 解卦：\n${latestAIAnswer}`:'');
}

function render(res){
  renderVersion++;
  const r=$('#result'); r.classList.remove('hidden');
  latestCastCopyText=buildCastCopyText(res);
  latestAIAnswer='';
  let html=`<div class="cast-time-wrap">${renderTimestamp(res.timestamp)}<button type="button" class="copy-icon-btn" id="copyCast" title="复制排盘" aria-label="复制排盘">${COPY_ICON}</button></div>`;
  // 表头
  const showChg=res.hasMove;
  html+='<div class="card"><div class="pan-wrap" tabindex="0" role="region" aria-label="六爻排盘表，可左右滑动"><table class="pan"><thead><tr>'+
        '<th>六神</th><th>伏神</th><th>六亲</th><th>干支</th><th>本卦</th><th>世应</th>'+
        (showChg?'<th>六亲</th><th>干支</th><th>变卦</th>':'')+'</tr></thead><tbody>';
  for(let p=5;p>=0;p--){            // 上->初
    const lb=res.ben.lines[p];
    const lc=showChg?res.chg.lines[p]:null;
    html+='<tr>'+lineCellBen(lb)+(showChg?lineCellChg(lc):'')+'</tr>';
  }
  html+='</tbody></table></div><div class="pan-scroll-hint">左右滑动查看完整排盘</div></div>';

  // 卦名行
  const ben=res.ben;
  const benTitle=`${ben.name}（${ben.palace}宫·${ben.gongType}）`;
  let chgTitle = res.hasMove ? `${res.chg.name}（${res.chg.palace}宫·${res.chg.gongType}）` : '';
  html+=`<div class="txt"><h3>${benTitle}${res.hasMove?' → '+chgTitle:''}</h3>`;
  html+=`<div class="gua">本卦卦辞：${ben.guaci}</div>`;

  // 用九用六
  const allMove=res.moving.every(Boolean);
  if(ben.key==='111111'&&allMove&&ben.yongText) html+=`<div class="gua">${ben.yongText}</div>`;
  if(ben.key==='000000'&&allMove&&ben.yongText) html+=`<div class="gua">${ben.yongText}</div>`;

  // 动爻爻辞
  const movers=[];
  res.ben.lines.forEach((l,i)=>{ if(l.move) movers.push(i); });
  if(movers.length){
    html+='<h3>动爻（重点参考）</h3>';
    movers.forEach(i=>{
      const l=res.ben.lines[i];
      html+=`<div class="yao"><b>${yaoName(l.pos,l.yang)}</b>　${ben.yaoci[i]}</div>`;
    });
  }else{
    html+='<div class="src">（六爻皆静：按纳甲六爻法仍应取用神，参看世应、月建日辰及旺衰生克；卦辞仅供辅助参考。）</div>';
  }
  // 变卦卦辞
  if(res.hasMove){
    html+=`<div class="gua" style="margin-top:8px">变卦卦辞：${res.chg.guaci}</div>`;
  }
  // 全部爻辞
  html+='<details><summary>展开全部爻辞</summary>';
  res.ben.lines.forEach((l,i)=>{
    html+=`<div class="yao" style="border-color:var(--line)"><b>${yaoName(l.pos,l.yang)}</b>　${ben.yaoci[i]}</div>`;
  });
  html+='</details>';

  // 断卦提示
  html+='<details><summary>断卦小提示</summary><div class="hint">'+
    '本卦呈现当前卦象；变卦反映动爻变化后的卦象，不等于确定的最终结果。<br>'+
    '世爻代表求测者(我)，应爻代表对方/对方之事；世应生合比克见关系。<br>'+
    '用神依所测之事取：测财取妻财，测官运官鬼，测父母长辈文书取父母，测子女晚辈取子孙，测兄弟同辈取兄弟。<br>'+
    '老阳老阴为动爻；旬空须结合用神、旺衰、动静及冲合判断，不宜机械视为无效。<br>'+
    '六神配爻辅断情绪与外应。本程序只排盘列辞，断语仍需结合所问之事与传统断法。'+
    '</div></details>';

  html+='</div>';
  html+=`<div class="card ai-card" id="aiCard">
    <button type="button" class="copy-icon-btn hidden" id="copyAI" title="复制 AI 解卦" aria-label="复制 AI 解卦">${COPY_ICON}</button>
    <h3>AI 联网解卦</h3>
    <div class="ai-lead">选择模型后，结合所测之事与本次卦盘生成解读</div>
    <div class="model-picker" aria-label="选择解卦模型">
      <button type="button" id="aiModelFlash" class="model-choice" data-model="deepseek-flash" aria-pressed="false">V4.1 Flash<small>快速 · 更省</small></button>
      <button type="button" id="aiModelPro" class="model-choice" data-model="deepseek-v4-pro" aria-pressed="false" aria-disabled="true" disabled>Pro<small>暂未开放</small></button>
    </div>
    <button type="button" class="act primary" id="aiGo">开始 AI 解卦</button>
    <div id="aiStatus" class="ai-status" role="status"></div>
    <div id="aiAnswer" class="ai-answer hidden"></div>
    <button type="button" class="act gold-outline copy-all" id="copyAll">复制完整排盘</button>
  </div>`;
  r.innerHTML=html;
  $('#copyCast').onclick=()=>copyText(latestCastCopyText,'排盘');
  $('#copyAll').onclick=()=>copyText(buildAllCopyText(),'排盘与解读');
  bindAI(res);
  r.scrollIntoView({behavior:'smooth',block:'start'});
}

function bindAI(res){
  const buttons=$$('.model-choice'),goButton=$('#aiGo'),status=$('#aiStatus'),answer=$('#aiAnswer'),copyAI=$('#copyAI');
  const version=renderVersion;
  let busy=false;
  let requestKey='';
  const modelLabel=()=> 'V4.1 Flash';
  function syncModelButtons(){
    buttons.forEach(button=>{
      const active=button.dataset.model===selectedModel;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
  }
  buttons.forEach(button=>button.onclick=()=>{
    if(busy||button.disabled||!AIDivination.MODELS.some(model=>model.id===button.dataset.model))return;
    selectedModel=button.dataset.model;
    requestKey='';
    try{localStorage.setItem('sixyao-model',selectedModel);}catch{}
    syncModelButtons();
  });
  syncModelButtons();
  goButton.onclick=async()=>{
    if(busy)return;
    busy=true;
    goButton.disabled=true;
    const controls=[...buttons,...$$('#coinBox button'),$('#manualTime'),$('#go'),$('#rnd'),$('#clr'),$('#q'),$('#qConfirm')];
    const saved=controls.map(el=>el.disabled);
    let timer;
    let aiSubmitted=false;
    controls.forEach(el=>el.disabled=true);
    try{
      if(!await SixYaoAccount.beforeAI(Boolean(requestKey)))return;
      if(version!==renderVersion)return;
      const question=questionText();
      if(!question){throw new Error('请先填写所测之事');}
      const model=selectedModel;
      const startedAt=Date.now();
      controls.forEach(el=>el.disabled=true);
      goButton.textContent='解读与核校中…';
      status.className='ai-status loading';
      status.textContent=modelLabel(model)+' 正在依据卦象解读并核校…';
      timer=setInterval(()=>{
        if(version===renderVersion)status.textContent='解读与核校已等待 '+Math.floor((Date.now()-startedAt)/1000)+' 秒，请稍候…';
      },5000);
      requestKey=requestKey||(crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''));
      const payload=AIDivination.buildPayload({question,timestamp:res.timestamp,model,cast:res});
      payload.requestKey=requestKey;
      aiSubmitted=true;
      const data=await SixYaoAccount.api('/api/divine',{method:'POST',body:JSON.stringify(payload),timeoutMs:120000});
      if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('回复未完整接收，请再次点击读取本次结果');
      if(version!==renderVersion)return;
      // Apply the same presentation to new answers and read-only cached replies.
      // Copies use exactly the visible text; historical database values stay intact.
      const displayedAnswer=LiuYaoAnswerPresentation.toDisplayAnswer(data.answer);
      if(!displayedAnswer.trim())throw new Error('回复显示异常，请刷新后重新读取本次结果');
      latestAIAnswer=displayedAnswer;
      answer.textContent=latestAIAnswer;
      answer.classList.remove('hidden');
      copyAI.classList.remove('hidden');
      $('#copyAll').textContent='复制完整排盘与 AI 解读';
      status.textContent='解读完成 · '+modelLabel(data.model||model)+(typeof data.credits==='number'?' · 剩余 '+data.credits+' 次':'');
      status.className='ai-status';
      requestKey='';
      await SixYaoAccount.refresh().catch(()=>{});
    }catch(error){
      if(version!==renderVersion)return;
      status.textContent=error.name==='TimeoutError'?'等待超时，可再次点击查询本次结果，不会重复扣次。':(error.message||'网络暂时不可用，请重试');
      status.className='ai-status error';
      if(latestAIAnswer)status.textContent+='；下方保留的是上一次成功回复。';
      // A network retry retains its key; an explicit server failure was refunded.
      if(aiSubmitted && error.status && !['IN_PROGRESS','DATABASE'].includes(error.code))requestKey='';
      if(['LOGIN_REQUIRED','NO_CREDITS'].includes(error.code))SixYaoAccount.refresh().then(()=>SixYaoAccount.open()).catch(()=>{});
      // Keep any previous successful answer visible when a new attempt fails.
    }finally{
      clearInterval(timer);
      controls.forEach((el,i)=>el.disabled=saved[i]);
      goButton.disabled=false;
      goButton.textContent=latestAIAnswer?'重新解卦':'开始 AI 解卦';
      busy=false;
    }
  };
  copyAI.onclick=()=>copyText(latestAIAnswer,'AI 解卦');
}

function go(){
  if(!questionConfirmed){ toast(NEED_Q_MSG); $('#q').focus(); return; }
  if(mode==='manual'){
    const clickedAt=new Date();
    if(!manualCoinTouched&&!window.confirm('六爻铜钱仍是默认全正面，排盘会得到六爻皆老阴。确定要按此卦排盘吗？'))return;
    const v=$('#manualTime').value;
    const when=v?new Date(v+'+08:00'):clickedAt;
    if(isNaN(when.getTime())){
      $('#shakeStatus').textContent='起卦时间无效，请重新选择手动起卦时间';
      return;
    }
    const backs=[]; for(let i=0;i<6;i++)backs.push(backsOf(i));
    render(LiuYao.cast(backs,when,ICHING_TEXT));
    return;
  }
  const state=shake.snapshot();
  if(state.phase!=='complete'||!state.completedAt){
    $('#shakeStatus').textContent='请先按提示完成六次停爻';
    return;
  }
  coins=state.coins;
  const backs=[]; for(let i=0;i<6;i++)backs.push(backsOf(i));
  const res=LiuYao.cast(backs,state.completedAt,ICHING_TEXT);
  render(res);
}

function confirmQuestion(){
  if(!questionText()){
    $('#qHint').textContent='请先填写所测之事，再点「确认所测之事」。';
    $('#q').focus();
    return;
  }
  questionConfirmed=true;
  $('#q').blur();
  try{sessionStorage.setItem('sixyao-question',questionText());}catch{}
  $('#qConfirm').textContent='已确认（修改内容需重新确认）';
  $('#qHint').textContent='已确认所测之事，可开始摇卦或手动点击选卦。';
  if(mode==='manual') renderManual();
}
function onQuestionInput(){
  if(!questionConfirmed) return;
  questionConfirmed=false;
  clearAll();
  $('#qConfirm').textContent='确认所测之事';
  $('#qHint').textContent='内容已修改，请重新「确认所测之事」。';
  if(mode==='manual') renderManual();
}

// init：默认进入手动模式（未确认所测之事，按钮置灰）
(function(){
  try{
    const saved=localStorage.getItem('sixyao-model');
    if(AIDivination.MODELS.some(model=>model.id===saved))selectedModel=saved;
    $('#q').value=sessionStorage.getItem('sixyao-question')||'';
  }catch{}
  $('#q').addEventListener('keydown',event=>{if(event.key==='Enter')confirmQuestion();});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)stopShakeTimer();
    else if(shake.snapshot().phase==='rolling')startShakeTimer();
  });
  $('#manualTime').addEventListener('input',invalidateResult);
  $('#coinLegend').innerHTML='<span><i class="legend-face" aria-hidden="true">'+coinFaceHTML('legend',0,false)+'</i>正面 · 字（阴）</span><span><i class="legend-face" aria-hidden="true">'+coinFaceHTML('legend',1,true)+'</i>背面 · 花纹（阳）</span>';
  renderManual();
  $('#go').onclick=go;
  $('#rnd').onclick=handleShake;
  $('#clr').onclick=clearAll;
  $('#qConfirm').onclick=confirmQuestion;
  $('#q').addEventListener('input',onQuestionInput);
})();
