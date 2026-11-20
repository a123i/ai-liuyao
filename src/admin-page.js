function adminPage() {
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>测了吗 · 管理后台</title>
<link rel="icon" href="/icon.png">
<style>
:root{--bg:#f5f5f2;--paper:#fff;--ink:#252a30;--muted:#666e79;--line:#e4e6e9;--gold:#8b6323;--gold-bg:#faf1df;--green:#16634c;--red:#b12f36}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
button,input,select{font:inherit}button,a,input,select{-webkit-tap-highlight-color:transparent}
button{cursor:pointer;border:1px solid var(--line);background:white;color:var(--ink);padding:9px 15px;border-radius:8px;min-height:42px;font-weight:600}button:hover:not(:disabled){background:#f1f3f5;border-color:#bac0c8}button:disabled{opacity:.5;cursor:not-allowed}
button.primary{background:#2c302f;color:#fff;border-color:#2c302f}button.primary:hover:not(:disabled){background:#464b47}button.link{color:var(--gold);border:0;background:transparent;padding:6px 8px;white-space:nowrap}
a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}input,select{border:1px solid #cdd1d7;border-radius:8px;padding:10px 12px;background:white;color:var(--ink);min-height:44px;max-width:100%}input::placeholder{color:#7c838d}
:focus-visible{outline:3px solid #c19953;outline-offset:3px}h1,h2,h3,p{margin:0}h1{font-size:27px;letter-spacing:-.5px;line-height:1.3}h2{font-size:18px}h3{font-size:16px}.muted{color:var(--muted);font-size:13px}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;overflow-wrap:anywhere}.break{overflow-wrap:anywhere}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.shell{display:grid;grid-template-columns:214px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;padding:30px 18px;display:flex;flex-direction:column;background:#252821;color:#fff}.brand{display:flex;gap:11px;align-items:center;padding:0 10px 28px}.brand img{width:37px;height:37px;border-radius:10px}.brand strong{display:block;font-size:22px;letter-spacing:2px;color:#ecd1a0}.brand small{color:#c5c9bf;font-size:12px;letter-spacing:1px}.nav{display:grid;gap:8px}.nav button{display:flex;align-items:center;gap:12px;border:0;background:none;color:#ced1c9;text-align:left;padding:12px 14px;font-weight:500}.nav button:hover:not(:disabled){background:#353a30}.nav button[aria-current="page"]{background:#f6e6c8;color:#332917;font-weight:700}.nav .nav-symbol{width:22px;font-size:18px;text-align:center}.side-note{margin-top:auto;padding:25px 12px 0;color:#c5c9bf;font-size:12px}.side-note strong{display:block;color:#eee;margin-bottom:6px}
.nav button[aria-current="page"]:hover:not(:disabled){background:#efdbb6;color:#332917}
.account-name{font-weight:700;text-align:left;white-space:normal;overflow-wrap:anywhere}.user-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.user-actions .link{padding:6px 4px}.question-list{display:grid;gap:12px;margin-top:16px}.question-item{padding:16px 18px;border:1px solid var(--line);border-radius:10px;background:#fcfcfa}.question-item-head{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.question-item .question-full{font-size:16px;margin:10px 0}.question-item details{margin-top:10px;border-top:1px solid var(--line);padding-top:10px}.question-item .answer{margin-top:10px;font-size:14px;padding:14px}.question-list-status{margin-top:14px}.question-more{margin-top:14px}
.main{padding:32px 38px 38px;min-width:0;max-width:1580px;width:100%;margin:0 auto}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.topbar .muted{margin-top:6px}.top-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.top-actions a{font-size:13px;color:var(--muted);padding:8px}.panel{background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 2px 4px #1b242403}.login-panel{padding:30px;max-width:680px;margin:48px auto}.login-panel h2{font-size:23px}.login-panel p{margin:10px 0 22px}.login-form{display:flex;gap:10px;align-items:end}.login-form label{display:grid;gap:7px;flex:1;font-weight:600;font-size:13px}.login-form button{min-height:45px}.login-panel .muted{margin:16px 0}
.status{padding:12px 16px;background:#edf6f1;border:1px solid #cfdfd5;color:var(--green);border-radius:9px;font-size:13px;margin-bottom:18px;overflow-wrap:anywhere}.status.error{background:#fff0ef;border-color:#ecc9c7;color:var(--red)}.status.neutral{background:#eef2f7;border-color:#dae1ea;color:#485469}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px;flex-wrap:wrap}.range-control{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted)}.range-control select{font-size:13px;padding:7px 32px 7px 10px;min-height:38px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:14px 0 24px}.stat{padding:22px;position:relative;overflow:hidden}.stat:before{content:"";position:absolute;left:0;top:23px;height:25px;width:3px;background:#bd914c}.stat-label{font-size:13px;color:var(--muted)}.stat-value{font-size:34px;font-weight:700;line-height:1.35;margin:8px 0 5px;font-variant-numeric:tabular-nums}.stat-value small{font-size:14px;font-weight:400;margin-left:6px}.overview-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 22px;border-bottom:1px solid var(--line)}.recent-list{padding:0 22px}.recent-item{padding:17px 0;border-bottom:1px solid #eceef0;display:flex;gap:16px;align-items:center}.recent-item:last-child{border:0}.recent-content{flex:1;min-width:0}.recent-item .muted{margin-top:6px}.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.note-list{padding:8px 22px 20px}.note-list p{font-size:14px;color:var(--muted);margin-top:14px}.note-list strong{color:var(--ink)}.footnote{font-size:12px;color:var(--muted);margin-top:20px}
.section-top{padding:21px 22px 0}.section-top p{margin-top:5px}.filters{display:flex;align-items:end;gap:12px;padding:20px 22px;border-bottom:1px solid var(--line);flex-wrap:wrap}.filters label{display:grid;gap:6px;font-size:12px;color:var(--muted)}.filters .search-field{flex:1;min-width:220px}.filters input{width:100%}.subnav{display:flex;gap:6px;margin-top:18px;flex-wrap:wrap}.subnav button{font-size:13px;padding:7px 12px;min-height:37px;background:#f5f6f7;border-color:transparent}.subnav button[aria-pressed="true"]{background:var(--gold-bg);color:var(--gold);border-color:#e9d4ac}.table-scroll{width:100%;overflow-x:auto}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:14px}th{background:#f8f9fa;font-size:12px;color:#5e6570;font-weight:600;text-align:left;padding:13px 18px;border-bottom:1px solid var(--line)}td{padding:17px 18px;border-bottom:1px solid #edefef;vertical-align:top;overflow-wrap:anywhere}tbody tr:hover{background:#fcfcfa}td .muted{margin-top:3px}tbody tr:last-child td{border-bottom:0}.time{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:13px}.badge{display:inline-block;padding:3px 9px;border-radius:6px;font-size:12px;line-height:1.6;font-weight:600;background:#edf0f3;color:#546172;white-space:nowrap}.badge.good{background:#e7f4ed;color:#126345}.badge.bad{background:#fdebea;color:#a62d35}.badge.gold{background:var(--gold-bg);color:var(--gold)}.amount{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums}.positive{color:#146548}.negative{color:#ad343d}.empty{padding:50px 22px;text-align:center;color:var(--muted)}.empty strong{display:block;font-size:16px;color:var(--ink);margin-bottom:8px}.empty.error strong{color:var(--red)}.pagination{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:17px 22px;border-top:1px solid var(--line);font-size:13px;color:var(--muted);flex-wrap:wrap}.pager-actions{display:flex;gap:12px;align-items:center}.pager-actions button{min-height:36px;padding:6px 12px;font-size:13px}
dialog{padding:0;border:1px solid var(--line);border-radius:16px;width:min(880px,calc(100% - 32px));max-height:calc(100dvh - 48px);box-shadow:0 30px 100px #0003;background:white;color:var(--ink)}dialog::backdrop{background:#19232b80;backdrop-filter:blur(3px)}.dialog-head{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:15px;background:white;padding:20px 26px;border-bottom:1px solid var(--line)}.dialog-body{padding:24px 26px 32px}.detail-section{margin-top:24px}.detail-section:first-child{margin-top:0}.detail-section h3{margin-bottom:12px}.detail-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;padding:20px;background:#f7f8f9;border-radius:10px;margin:18px 0}.detail-meta dt{color:var(--muted);font-size:12px}.detail-meta dd{margin:5px 0 0;font-size:14px;overflow-wrap:anywhere}.question-full{white-space:pre-wrap;overflow-wrap:anywhere;font-size:19px;line-height:1.7;font-weight:600}.answer{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.95;font-size:16px;padding:22px 24px;background:#faf9f6;border:1px solid #ece7db;border-radius:10px}.copy-row{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px}.copy-row h3{margin:0}.json-details{margin-top:16px;border:1px solid var(--line);border-radius:8px;padding:14px}summary{cursor:pointer;color:#59616b;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f5f7;border-radius:6px;padding:15px;font-size:12px;line-height:1.7;max-height:340px;overflow:auto}.copy-notice{font-size:12px;color:var(--muted);margin-top:6px}.cast-summary{background:#f6f7f8;padding:18px 20px;border-radius:9px}.cast-summary p+p{margin-top:7px}
@media(min-width:1500px){.main{padding-left:48px;padding-right:48px}}
@media(max-width:1100px){.shell{grid-template-columns:186px minmax(0,1fr)}.main{padding:26px 22px}.stats{gap:10px}.stat{padding:18px 16px}.overview-grid{grid-template-columns:1fr}th,td{padding-left:12px;padding-right:12px}}
@media(max-width:760px){.shell{display:block}.sidebar{height:auto;position:static;padding:16px}.brand{padding:0 4px 14px}.brand img{width:32px;height:32px}.brand strong{font-size:20px}.brand small{display:none}.nav{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.nav button{justify-content:center;padding:10px 3px;gap:4px;font-size:12px;min-height:44px}.nav .nav-symbol,.side-note{display:none}.main{padding:22px 14px}.topbar{align-items:flex-start;gap:12px}.topbar h1{font-size:23px}.top-actions{gap:6px;justify-content:flex-end}.top-actions button{padding:7px 10px;font-size:12px;min-height:38px}.top-actions a{display:none}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stat-value{font-size:28px}.stat{padding:16px}.toolbar{align-items:flex-start;gap:10px}.login-panel{margin:12px auto;padding:22px}.login-form{display:grid}.panel-heading,.section-top{padding:18px 16px}.recent-list,.note-list{padding-left:16px;padding-right:16px}.filters{padding:16px;gap:10px}.filters .search-field{min-width:100%}.filters label:not(.search-field){flex:1}.filters select{width:100%}.table-scroll{overflow:visible}table,tbody,tr,td{display:block;width:100%}thead{display:none}tbody{padding:0 16px}tbody tr{padding:16px 0;border-bottom:1px solid var(--line)}tbody tr:last-child{border-bottom:0}td{border:0;padding:5px 0;display:grid;grid-template-columns:78px minmax(0,1fr);gap:10px}td:before{content:attr(data-label);font-size:12px;color:var(--muted);padding-top:2px}td .cell-body{min-width:0}.pagination{padding:16px}.pager-actions{gap:8px}.detail-meta{grid-template-columns:repeat(2,minmax(0,1fr));padding:15px;gap:14px}.dialog-head{padding:16px}.dialog-head h2{font-size:17px}.dialog-body{padding:18px 16px}.answer{padding:17px;font-size:15px}.question-full{font-size:17px}dialog{width:calc(100% - 16px);max-height:calc(100dvh - 20px);border-radius:12px}.footnote{line-height:1.8}}
@media(prefers-reduced-motion:no-preference){button{transition:background .15s,border-color .15s}}
</style>
</head>
<body>
<div class="shell" id="adminApp">
  <aside class="sidebar">
    <div class="brand"><img src="/icon.png" alt=""><div><strong>测了吗</strong><small>管理后台</small></div></div>
    <nav class="nav" aria-label="后台导航">
      <button data-view="overview" aria-current="page"><span class="nav-symbol" aria-hidden="true">▦</span>数据概览</button>
      <button data-view="ai"><span class="nav-symbol" aria-hidden="true">✦</span>AI 解读</button>
      <button data-view="visits"><span class="nav-symbol" aria-hidden="true">◎</span>访问记录</button>
      <button data-view="users"><span class="nav-symbol" aria-hidden="true">☷</span>用户与次数</button>
    </nav>
    <div class="side-note"><strong>账号与记录管理</strong>修改次数需要确认，并保留流水。<br>所有时间均为北京时间。</div>
  </aside>
  <main class="main">
    <header class="topbar"><div><h1 id="pageTitle">数据概览</h1><p class="muted" id="pageIntro">使用情况与最近动态，一目了然。</p></div><div class="top-actions"><a href="/" target="_blank" rel="noopener">打开网站 ↗</a><button id="refresh" hidden>刷新数据</button><button id="logout" hidden>退出后台</button></div></header>
    <div id="status" class="status neutral" role="status" aria-live="polite">请输入后台口令，验证后查看数据。</div>
    <section id="loginPanel" class="panel login-panel">
      <h2>欢迎回来</h2><p class="muted">验证管理员身份后，查看访问、AI 解读和用户次数记录。</p>
      <form id="loginForm" class="login-form"><label for="token">后台口令<input id="token" type="password" placeholder="输入 ADMIN_TOKEN" autocomplete="current-password" required></label><button id="load" class="primary" type="submit">进入后台</button></form>
      <p class="muted">使用原有后台口令。口令仅在当前标签页会话中保留，退出时清除。</p>
    </section>
    <div id="workspace" hidden>
      <div class="toolbar"><p class="muted" id="updatedAt">尚未加载</p><div class="range-control"><label for="limit">访问 / 解读加载范围</label><select id="limit"><option value="50">最近 50 条 / 类</option><option value="100" selected>最近 100 条 / 类</option><option value="200">最近 200 条 / 类</option><option value="500">最近 500 条 / 类</option></select></div></div>
      <section id="overview" aria-label="数据概览"><p class="muted">以下统计基于本次已加载记录，不是全站累计数据。</p><div class="stats" id="stats"></div><div class="overview-grid"><section class="panel"><div class="panel-heading"><h2>最近 AI 解读</h2><button class="link" data-view="ai">查看解读记录 →</button></div><div id="recentAI" class="recent-list"></div></section><section class="panel"><div class="panel-heading"><h2>数据说明</h2><span class="badge gold">操作留痕</span></div><div class="note-list"><p><strong>按用户查问题</strong><br>进入「用户与次数」，点击账号名称即可查看该用户的问题及解读回复。</p><p><strong>管理剩余次数</strong><br>进入「用户与次数」，点击「修改次数」；修改记录可在「次数流水」查看。</p><p><strong>查访问来源</strong><br>进入「访问记录」，按 IP、设备、页面路径搜索。</p><p>独立 IP 不等于独立用户；微信标记仅表示在微信内打开，不代表已获取微信昵称。</p></div></section></div></section>
      <section id="recordsPanel" class="panel" hidden aria-labelledby="tableTitle"><div class="section-top"><h2 id="tableTitle"></h2><p class="muted" id="tableHint"></p><div class="subnav" id="userTabs" hidden aria-label="用户记录分类"><button data-kind="users" aria-pressed="true">账号列表</button><button data-kind="ledger" aria-pressed="false">次数流水</button><button data-kind="rewards" aria-pressed="false">广告奖励</button></div></div>
        <div class="filters"><label class="search-field" for="search">搜索当前列表<input id="search" type="search" placeholder="搜索" autocomplete="off"></label><label id="filterLabel" for="filter">筛选<select id="filter"></select></label><label for="pageSize">每页显示<select id="pageSize"><option value="15">15 条</option><option value="30">30 条</option><option value="50">50 条</option></select></label><button id="resetFilters">重置</button></div>
        <div class="table-scroll" id="tableWrap"><table><caption class="sr-only" id="tableCaption"></caption><thead id="tableHead"></thead><tbody id="tableBody"></tbody></table></div>
        <div id="emptyState" class="empty" hidden></div>
        <div class="pagination"><span id="resultCount" role="status" aria-live="polite"></span><div class="pager-actions"><button id="prevPage">上一页</button><span id="pageLabel"></span><button id="nextPage">下一页</button></div></div>
      </section>
      <p class="footnote">记录按时间倒序显示。搜索、筛选和分页仅作用于已加载记录；账号、次数流水及广告奖励分别最多加载最近 100 条。广告奖励次数不等于广告收入。</p>
    </div>
  </main>
</div>
<dialog id="detailDialog" aria-labelledby="detailTitle"><div class="dialog-head"><div><h2 id="detailTitle">记录详情</h2><p class="muted" id="detailSubtitle"></p></div><button id="closeDetail" autofocus>关闭</button></div><div id="detailBody" class="dialog-body"></div></dialog>
<dialog id="creditDialog" aria-labelledby="creditTitle" style="max-width:560px">
  <div class="dialog-head"><div><h2 id="creditTitle">修改剩余次数</h2><p class="muted" id="creditUser"></p></div><button id="closeCredit" type="button">关闭</button></div>
  <form id="creditForm" class="dialog-body">
    <p id="creditBefore" class="amount"></p><p class="muted">填写修改后的总次数，不是增加量。仅影响 AI 解读，摇卦与排盘仍免费。</p>
    <label style="display:grid;gap:8px;margin:20px 0">修改后剩余次数<input id="creditAmount" type="number" min="0" max="1000000" step="1" required inputmode="numeric"></label>
    <label style="display:grid;gap:8px;margin:20px 0">修改备注<input id="creditNote" maxlength="200" required placeholder="例如：活动赠送、客服补偿、余额纠正"></label>
    <p id="creditStatus" class="status neutral" role="status" aria-live="polite">修改将记录在次数流水中。</p>
    <div class="top-actions"><button id="creditSave" type="submit" class="primary">下一步：核对修改</button><button id="creditBack" type="button" hidden>返回修改</button><button id="creditCancel" type="button">取消</button></div>
  </form>
</dialog>
<script src="/answer-presentation.js"></script>
<script>
'use strict';
function text(value){return value==null?'':String(value)}
function displayAnswer(value){return LiuYaoAnswerPresentation.toDisplayAnswer(text(value))}
function yes(value){return value===true||value===1||value==='1'}
function formatTime(value){
  if(!value)return '—';
  const raw=String(value),normalized=raw.includes('T')?raw:raw.replace(' ','T');
  const date=new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)?normalized:normalized+'Z');
  return Number.isNaN(date.getTime())?'时间格式异常':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date);
}
function modelName(value){return ({'deepseek-flash':'V4.1 Flash','deepseek-v4-flash':'V4 Flash（历史）','deepseek-v4-pro':'V4 Pro（历史）'})[value]||text(value)||'未记录'}
function reasonName(value){return ({welcome:'注册赠送',ai_reserve:'AI 解读扣除',refund:'失败退回',ad_reward:'广告奖励',admin_adjust:'管理员修改'})[value]||text(value)||'未记录'}
function deviceName(value){return ({mobile:'手机',tablet:'平板',desktop:'电脑',unknown:'未知设备'})[value]||text(value)||'未知设备'}
function sourceName(value){if(!value)return '直接访问 / 来源未记录';try{return new URL(value).hostname||'来源未记录'}catch{return text(value)}}
function prettyJson(value){try{return JSON.stringify(typeof value==='string'?JSON.parse(value):value,null,2)}catch{return text(value)}}
function filterRows(rows,query,filter,kind){
  const q=text(query).trim().toLocaleLowerCase();
  return rows.filter(row=>{
    if(kind==='ai'&&filter!=='all'&&yes(row.success)!==(filter==='success'))return false;
    if(kind==='visits'&&filter!=='all'&&yes(row.is_wechat)!==(filter==='wechat'))return false;
    if(kind==='users'&&filter==='empty'&&Number(row.credits)!==0)return false;
    if(kind==='users'&&filter==='available'&&!(Number(row.credits)>0))return false;
    if(kind==='ledger'&&filter!=='all'&&row.reason!==filter)return false;
    const values=kind==='ai'?[row.question,row.ip,row.ai_answer,row.model,modelName(row.model),row.cast_summary?.ben_name,row.cast_summary?.chg_name]:kind==='visits'?[row.ip,row.path,row.query_string,row.referrer,row.os,row.browser,deviceName(row.device_type),yes(row.is_wechat)?'微信':'']:kind==='ledger'?[row.username,row.reason,reasonName(row.reason),row.note]:[row.username,row.provider];
    return !q||values.map(text).join(' ').toLocaleLowerCase().includes(q);
  });
}
function pageSlice(rows,page,size){const total=Math.max(1,Math.ceil(rows.length/size));const current=Math.min(Math.max(1,page),total);return {rows:rows.slice((current-1)*size,current*size),current,total,start:rows.length?(current-1)*size+1:0,end:Math.min(current*size,rows.length)}}
// UI bindings. Keep all database content as text, never interpolated HTML.
const $=selector=>document.querySelector(selector);
const state={view:'overview',kind:'users',data:null,credits:null,recordError:'',creditError:'',page:1,query:'',filter:'all',size:15,busy:false,token:'',controller:null,generation:0,edit:null,userQuestions:null};
const titles={overview:['数据概览','使用情况与最近动态，一目了然。'],ai:['AI 解读记录','先看问题与结果，再展开阅读完整解读。'],visits:['访问记录','按时间查看访问 IP、设备和来源。'],users:['用户与次数','查看账号余额、次数变动与广告奖励。']};
function el(tag,value,className){const node=document.createElement(tag);if(value!=null)node.textContent=text(value);if(className)node.className=className;return node}
function button(label,action,className='link'){const node=el('button',label,className);node.type='button';node.onclick=action;return node}
function badge(label,type=''){return el('span',label,'badge '+type)}
function stack(first,second,className=''){const node=el('div',null,className);node.append(first instanceof Node?first:el('div',first));if(second)node.append(el('div',second,'muted'));return node}
function td(label,value){const node=el('td');node.dataset.label=label;const body=el('div',null,'cell-body');body.append(value instanceof Node?value:el('span',value));node.append(body);return node}
function timeNode(value){const parts=formatTime(value).split(' ');return stack(parts[0],parts.slice(1).join(' '),'time')}
function notify(message,type=''){const node=$('#status');node.textContent=message;node.className='status '+type}
function storage(action,value){try{if(action==='get')return sessionStorage.getItem('adminToken')||'';if(action==='set')sessionStorage.setItem('adminToken',value);if(action==='clear')sessionStorage.removeItem('adminToken')}catch{}return ''}
function clearData(){state.edit?.controller?.abort();state.edit=null;state.userQuestions?.controller?.abort();state.userQuestions=null;if($('#creditDialog').open)$('#creditDialog').close();state.data=null;state.credits=null;state.recordError='';state.creditError='';$('#stats').replaceChildren();$('#recentAI').replaceChildren();$('#tableBody').replaceChildren();$('#detailBody').replaceChildren();$('#emptyState').replaceChildren();if($('#detailDialog').open)$('#detailDialog').close()}
function logout(message='已退出后台，当前页面的数据和口令已清除。'){
  state.generation++;state.controller?.abort();state.controller=null;state.busy=false;state.token='';storage('clear');clearData();$('#token').value='';$('#load').disabled=false;$('#load').textContent='进入后台';$('#refresh').disabled=false;$('#limit').disabled=false;$('#refresh').hidden=true;$('#logout').hidden=true;$('#workspace').hidden=true;$('#loginPanel').hidden=false;notify(message,'neutral');$('#token').focus();
}
async function request(path,token,signal,payload={}){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:Number($('#limit').value),...payload,token}),signal,cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||'请求失败，请稍后重试'),{status:response.status,code:data.code});
  if(path.endsWith('/records')&&(!data.db?.ok||!Array.isArray(data.visits)||!Array.isArray(data.aiRecords)))throw new Error('访问与解读数据未就绪，请稍后刷新');
  if(path.endsWith('/credits')&&(!Array.isArray(data.users)||!Array.isArray(data.ledger)||!Array.isArray(data.rewards)))throw new Error('用户与次数数据未就绪，请稍后刷新');
  return data;
}
async function loadRecords(){
  if(state.busy||$('#creditDialog').open)return;
  const token=state.token||$('#token').value.trim();if(!token){notify('请先输入后台口令。','error');$('#token').focus();return}
  state.busy=true;const generation=++state.generation;const controller=new AbortController();state.controller=controller;
  $('#load').disabled=true;$('#load').textContent='正在验证…';$('#refresh').disabled=true;$('#limit').disabled=true;$('#workspace').setAttribute('aria-busy','true');notify('正在读取最新记录…','neutral');
  const timeout=setTimeout(()=>controller.abort(),20000);
  const results=await Promise.allSettled([request('/api/admin/records',token,controller.signal),request('/api/admin/credits',token,controller.signal)]);
  clearTimeout(timeout);if(generation!==state.generation)return;
  state.busy=false;state.controller=null;$('#load').disabled=false;$('#load').textContent='进入后台';$('#refresh').disabled=false;$('#limit').disabled=false;$('#workspace').setAttribute('aria-busy','false');
  if(results.some(r=>r.status==='rejected'&&r.reason.status===401)){logout('后台口令不正确或已失效，请重新输入。');notify('后台口令不正确或已失效，请重新输入。','error');return}
  clearData();
  const message=r=>r.reason?.name==='AbortError'?'请求超时，请检查网络后刷新':r.reason?.message||'网络连接失败，请稍后刷新';
  if(results[0].status==='fulfilled')state.data=results[0].value;else state.recordError=message(results[0]);
  if(results[1].status==='fulfilled')state.credits=results[1].value;else state.creditError=message(results[1]);
  if(!state.data&&!state.credits&&!state.token){notify(state.recordError||state.creditError,'error');return}
  state.token=token;storage('set',token);$('#token').value='';$('#loginPanel').hidden=true;$('#workspace').hidden=false;$('#refresh').hidden=false;$('#logout').hidden=false;state.page=1;
  $('#updatedAt').textContent='本次读取：'+formatTime(new Date().toISOString())+'（北京时间）';
  const errors=[state.recordError?'访问 / 解读：'+state.recordError:'',state.creditError?'用户 / 次数：'+state.creditError:''].filter(Boolean);
  notify(errors.length?'部分数据未能读取。'+errors.join('；'):'数据库连接正常 · 已读取最新记录 · 修改次数会保留流水',errors.length?'error':'');render();
}
function empty(container,title,description,error=false){container.replaceChildren(el('strong',title),el('span',description));container.className='empty'+(error?' error':'')}
function renderOverview(){
  const data=state.data,credits=state.credits,ai=data?.aiRecords||[],visits=data?.visits||[];
  const unique=new Set(visits.map(r=>r.ip).filter(Boolean)).size,success=ai.filter(r=>yes(r.success)).length;
  const stats=[['已加载访问记录',data?visits.length:'—','条','按加载范围统计'],['记录中的独立 IP',data?unique:'—','个','不等于独立用户人数'],['已加载 AI 解读',data?ai.length:'—','条',data?'成功 '+success+' · 失败 '+(ai.length-success):'数据读取失败'],['已加载账号',credits?credits.users.length:'—','个','最多显示最近 100 个账号']];
  $('#stats').replaceChildren(...stats.map(([label,value,unit,note])=>{const card=el('article',null,'panel stat');const n=el('div',value,'stat-value');n.append(el('small',unit));card.append(el('p',label,'stat-label'),n,el('p',note,'muted'));return card}));
  const list=$('#recentAI');list.replaceChildren();list.className='recent-list';
  if(!data){empty(list,'解读记录读取失败',state.recordError||'请刷新后重试',true);return}
  if(!ai.length){empty(list,'暂无 AI 解读记录','用户提交 AI 解读后，记录会显示在这里。');return}
  ai.slice(0,5).forEach(row=>{const item=el('div',null,'recent-item'),body=el('div',null,'recent-content');body.append(el('div',row.question||'未记录问题','clamp'),el('div',formatTime(row.created_at)+' · '+modelName(row.model),'muted'));item.append(badge(yes(row.success)?'成功':'失败',yes(row.success)?'good':'bad'),body,button('详情',()=>openAI(row)));list.append(item)});
}
function currentKind(){return state.view==='users'?state.kind:state.view}
function config(){return {
  ai:{title:'AI 解读列表',hint:'问题、回复、IP 或卦名均可搜索。完整回复在详情中阅读。',placeholder:'搜索问题 / 回复 / IP / 卦名',filters:[['all','全部结果'],['success','解读成功'],['failure','解读失败']],headers:['提交时间','用户问题','结果','模型 / 耗时','访问 IP / 设备','操作'],widths:['15%','30%','9%','16%','20%','10%']},
  visits:{title:'访问列表',hint:'同一个 IP 可能产生多条访问记录；来源为空不一定代表手动输入网址。',placeholder:'搜索 IP / 设备 / 页面 / 来源',filters:[['all','全部访问'],['wechat','微信内访问'],['other','非微信访问']],headers:['访问时间','IP 地址','设备 / 浏览器','访问页面','来源','操作'],widths:['16%','18%','19%','19%','18%','10%']},
  users:{title:'用户与次数',hint:'点击账号查看该用户的问题和回复；点击「修改次数」调整余额，保存前需要确认并填写备注。',placeholder:'搜索账号名称',filters:[['all','全部账号'],['available','还有次数'],['empty','次数为 0']],headers:['账号','剩余 AI 次数','注册时间','操作'],widths:['32%','20%','25%','23%']},
  ledger:{title:'用户与次数',hint:'正数表示增加，负数表示扣除；管理员修改会显示修改前后次数及备注。',placeholder:'搜索账号 / 原因 / 修改备注',filters:[['all','全部原因'],['welcome','注册赠送'],['ai_reserve','AI 解读扣除'],['refund','失败退回'],['ad_reward','广告奖励'],['admin_adjust','管理员修改']],headers:['变动时间','账号','次数变动','原因 / 备注'],widths:['23%','25%','18%','34%']},
  rewards:{title:'用户与次数',hint:'只显示已发放的广告奖励。奖励次数不是广告收入，收益以广告平台结算为准。',placeholder:'搜索账号 / 广告平台',filters:[],headers:['发放时间','账号','奖励次数','广告平台'],widths:['27%','33%','16%','24%']}
  }[currentKind()]}
function changeView(view){if(!titles[view])return;state.view=view;state.query='';state.filter='all';state.page=1;$('#search').value='';setupView();render()}
function setupView(){const [title,intro]=titles[state.view];$('#pageTitle').textContent=title;$('#pageIntro').textContent=intro;document.querySelectorAll('.nav [data-view]').forEach(n=>{if(n.dataset.view===state.view)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current')});$('#overview').hidden=state.view!=='overview';$('#recordsPanel').hidden=state.view==='overview';if(state.view==='overview')return;const c=config();$('#tableTitle').textContent=c.title;$('#tableHint').textContent=c.hint;$('#search').placeholder=c.placeholder;$('#userTabs').hidden=state.view!=='users';document.querySelectorAll('[data-kind]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.kind===state.kind)));$('#filterLabel').hidden=!c.filters.length;$('#filter').replaceChildren(...c.filters.map(([value,label])=>{const option=el('option',label);option.value=value;return option}));$('#filter').value=state.filter;}
function renderRow(row,kind,headers){
  let values;
  if(kind==='ai')values=[timeNode(row.created_at),el('div',row.question||'未记录问题','clamp'),badge(yes(row.success)?'成功':'失败',yes(row.success)?'good':'bad'),stack(modelName(row.model),Number(row.latency_ms)>0?(Number(row.latency_ms)/1000).toFixed(1)+' 秒':'耗时未记录'),stack(el('span',row.ip||'未记录','mono'),deviceName(row.device_type)),button('查看详情',()=>openAI(row))];
  else if(kind==='visits')values=[timeNode(row.created_at),el('span',row.ip||'未记录','mono'),stack((yes(row.is_wechat)?'微信 · ':'')+deviceName(row.device_type),[row.os,row.browser].filter(Boolean).join(' / ')),stack(el('div',row.path||'/','mono clamp'),row.method||'GET'),el('div',sourceName(row.referrer),'clamp'),button('查看详情',()=>openVisit(row))];
  else if(kind==='users'){const actions=el('div',null,'user-actions');actions.append(button('查看问题',()=>openUserQuestions(row)),button('修改次数',()=>openCredit(row)));values=[button(row.username,()=>openUserQuestions(row),'link account-name'),stack(el('span',row.credits,'amount'),Number(row.credits)===0?'暂无可用次数':'次可用'),timeNode(row.created_at),actions]}
  else if(kind==='ledger')values=[timeNode(row.created_at),row.username,stack(el('span',(Number(row.delta)>0?'+':'')+text(row.delta),'amount '+(Number(row.delta)>0?'positive':'negative')),row.reason==='admin_adjust'?row.before_credits+' → '+row.after_credits+' 次':''),stack(reasonName(row.reason),row.note)];
  else values=[timeNode(row.created_at),row.username,el('span','+'+text(row.credits),'amount positive'),row.provider||'未记录'];
  const tr=el('tr');values.forEach((value,i)=>tr.append(td(headers[i],value)));return tr;
}
function renderTable(){
  const kind=currentKind(),c=config(),isRecord=kind==='ai'||kind==='visits',available=isRecord?state.data:state.credits,error=isRecord?state.recordError:state.creditError;
  const rows=kind==='ai'?state.data?.aiRecords||[]:kind==='visits'?state.data?.visits||[]:state.credits?.[kind]||[];
  const filtered=filterRows(rows,state.query,state.filter,kind),page=pageSlice(filtered,state.page,state.size);state.page=page.current;
  const hr=el('tr');c.headers.forEach((label,i)=>{const th=el('th',label);th.scope='col';th.style.width=c.widths[i];hr.append(th)});$('#tableHead').replaceChildren(hr);$('#tableCaption').textContent=c.title+'，按时间倒序';$('#tableBody').replaceChildren(...page.rows.map(r=>renderRow(r,kind,c.headers)));
  $('#tableWrap').hidden=!filtered.length;$('#emptyState').hidden=!!filtered.length;
  if(!available)empty($('#emptyState'),'数据读取失败',error||'请点击刷新数据后重试。',true);
  else if(!rows.length)empty($('#emptyState'),'暂无记录',kind==='rewards'?'尚无已发放的广告奖励。':'此类记录产生后会显示在这里。');
  else if(!filtered.length)empty($('#emptyState'),'没有匹配的记录','试试其他关键词，或点击「重置」清除筛选。');
  $('#resultCount').textContent=!available?'读取失败，不能据此判断是否有记录':'显示 '+page.start+'–'+page.end+' 条 · 匹配 '+filtered.length+' 条 / 已加载 '+rows.length+' 条';
  $('#pageLabel').textContent=page.current+' / '+page.total;$('#prevPage').disabled=page.current<=1;$('#nextPage').disabled=page.current>=page.total;
}
function render(){renderOverview();if(state.view!=='overview')renderTable()}
function metaGrid(pairs){const dl=el('dl',null,'detail-meta');pairs.forEach(([label,value])=>{const wrap=el('div');wrap.append(el('dt',label),el('dd',value||'—'));dl.append(wrap)});return dl}
function section(title){const s=el('section',null,'detail-section');s.append(el('h3',title));return s}
function jsonDetails(title,value){const d=el('details',null,'json-details');d.append(el('summary',title),el('pre',prettyJson(value)));return d}
function openDialog(title,subtitle,nodes){$('#detailTitle').textContent=title;$('#detailSubtitle').textContent=subtitle;$('#detailBody').replaceChildren(...nodes);$('#detailDialog').showModal();$('#detailDialog').scrollTop=0;document.body.style.overflow='hidden'}
function openAI(row){
  const summary=row.cast_summary||{},question=section('用户问题');question.append(el('p',row.question||'未记录问题','question-full'));
  const meta=metaGrid([['提交时间（北京）',formatTime(row.created_at)],['解读结果',yes(row.success)?'成功':'失败'],['使用模型',modelName(row.model)],['访问 IP',row.ip],['设备 / 浏览器',[deviceName(row.device_type),row.os,row.browser].filter(Boolean).join(' / ')],['响应耗时',Number(row.latency_ms)>0?(Number(row.latency_ms)/1000).toFixed(1)+' 秒':'未记录']]);
  const cast=section('排盘摘要'),castText=el('div',null,'cast-summary');
  castText.append(el('p',[summary.ben_name,summary.chg_name?'→ '+summary.chg_name:''].filter(Boolean).join(' ')||'未记录卦名'),el('p','起卦时间：'+(summary.cast_time||'未记录')),el('p','动爻：'+(summary.moving_lines||(row.cast_json?'无动爻或未记录':'未记录'))));
  if(summary.pillars)castText.append(el('p','四柱 / 旬空：'+summary.pillars));cast.append(castText);
  const answer=section('AI 回复'),heading=el('div',null,'copy-row'),copyStatus=el('p','','copy-notice');copyStatus.setAttribute('role','status');
  const visibleAnswer=displayAnswer(row.ai_answer);
  const copy=button('复制回复',async()=>{try{await navigator.clipboard.writeText(visibleAnswer);copyStatus.textContent='已复制完整回复'}catch{copyStatus.textContent='浏览器未允许复制，请长按或选中下方文字复制。'}},'');copy.disabled=!visibleAnswer;heading.append(el('h3','AI 回复'),copy);answer.replaceChildren(heading);
  if(row.error_message)answer.append(el('div','失败原因：'+row.error_message,'status error'));
  answer.append(el('div',visibleAnswer||(yes(row.success)?'此条记录没有保存回复内容。':'解读未完成，暂无回复内容。'),'answer'),copyStatus);
  const technical=section('原始数据');if(row.cast_json)technical.append(jsonDetails('展开完整排盘 JSON',row.cast_json));if(row.timestamp_json)technical.append(jsonDetails('展开原始时间数据',row.timestamp_json));technical.append(metaGrid([['记录编号',row.id],['请求编号',row.request_id],['访问环境',yes(row.is_wechat)?'微信内打开':'非微信浏览器']]));
  openDialog('AI 解读详情','记录 #'+text(row.id)+' · 北京时间',[question,meta,cast,answer,technical]);
}
function openVisit(row){const path=section('访问页面');path.append(el('p',(row.method||'GET')+' '+(row.path||'/')+(row.query_string?'?'+row.query_string:''),'mono break'));const source=section('完整来源');source.append(el('p',row.referrer||'未记录来源，可能为直接访问或浏览器未提供。','break'));const ua=section('设备信息');ua.append(el('p',row.user_agent||'未记录 User-Agent','mono break'));openDialog('访问记录详情','记录 #'+text(row.id)+' · 北京时间',[metaGrid([['访问时间（北京）',formatTime(row.created_at)],['IP 地址',row.ip],['设备类型',deviceName(row.device_type)],['操作系统',row.os],['浏览器',row.browser],['微信环境',yes(row.is_wechat)?'微信内打开'+(row.wechat_version?' · '+row.wechat_version:''):'非微信浏览器']]),path,source,ua])}
function questionStatus(value){return ({completed:'已回复',failed:'解读失败',pending:'解读中',confirmed:'已确认'})[value]||'已记录'}
function questionItem(row){
  const item=el('article',null,'question-item'),head=el('div',null,'question-item-head');
  head.append(el('span',formatTime(row.created_at)+'（北京时间）','muted'),badge(questionStatus(row.status),row.status==='completed'?'good':row.status==='failed'?'bad':''));
  item.append(head,el('p',row.question||'未记录问题','question-full'));
  const info=[row.cast_time?'起卦：'+row.cast_time:'',row.model?modelName(row.model):''].filter(Boolean).join(' · ');
  if(info)item.append(el('p',info,'muted'));
  if(row.answer){const details=el('details');details.append(el('summary','查看 AI 回复'),el('div',displayAnswer(row.answer),'answer'));item.append(details)}
  return item;
}
async function loadUserQuestions(view){
  if(view.loading||state.userQuestions!==view||!state.token)return;
  view.loading=true;view.more.disabled=true;view.status.textContent='正在读取该用户的问题…';
  const controller=new AbortController();view.controller=controller;
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const data=await request('/api/admin/user-questions',state.token,controller.signal,{userId:view.row.id,limit:20,...(view.nextCursor?{cursor:view.nextCursor}:{})});
    if(state.userQuestions!==view||!$('#detailDialog').open)return;
    if(!data.user||data.user.id!==view.row.id||!Array.isArray(data.items))throw new Error('用户问题数据格式异常，请刷新后重试');
    if(!view.loaded&&data.items.length===0)view.list.append(el('p','该账号暂无可查看的问题记录。','muted'));
    view.list.append(...data.items.map(questionItem));view.loaded+=data.items.length;
    view.nextCursor=data.nextCursor||null;view.more.hidden=!view.nextCursor;
    view.more.textContent='加载更多';view.status.textContent='已显示 '+view.loaded+' 条'+(view.nextCursor?'，可继续加载':'');
  }catch(error){
    if(state.userQuestions!==view)return;
    if(error.status===401){logout('后台口令不正确或已失效，请重新输入。');return}
    view.status.textContent=error.name==='AbortError'?'读取超时，请重试。':error.message||'读取失败，请重试。';
    view.more.hidden=false;view.more.textContent='重试读取';
  }finally{clearTimeout(timeout);if(state.userQuestions===view){view.loading=false;view.controller=null;view.more.disabled=false}}
}
function openUserQuestions(row){
  if(state.busy||!state.token)return;
  const note=el('p','仅显示可准确归属到该账号的 AI 解读问题；无法准确关联的旧记录仍可在「AI 解读」总列表查看。','muted');
  const list=el('div',null,'question-list');list.setAttribute('aria-label','提问记录');
  const status=el('p','正在读取…','muted question-list-status');status.setAttribute('role','status');
  const more=button('加载更多',()=>loadUserQuestions(view));more.className='question-more';more.hidden=true;
  const view={row:{id:row.id,username:row.username},list,status,more,loaded:0,nextCursor:null,loading:false,controller:null};
  state.userQuestions=view;
  openDialog('用户提问记录','账号：'+row.username,[note,list,status,more]);
  return loadUserQuestions(view);
}
function creditMessage(message,error=false){$('#creditStatus').textContent=message;$('#creditStatus').className='status '+(error?'error':'neutral')}
function creditControls(){const e=state.edit;if(!e)return;$('#creditAmount').readOnly=e.confirmed;$('#creditNote').readOnly=e.confirmed;$('#creditBack').hidden=!e.confirmed||e.uncertain;$('#creditBack').disabled=e.saving;$('#creditSave').disabled=e.saving;$('#creditSave').textContent=e.saving?'正在保存…':e.uncertain?'重试确认本次结果':e.confirmed?'确认保存':'下一步：核对修改';$('#closeCredit').disabled=e.saving;$('#creditCancel').disabled=e.saving}
function openCredit(row){
  if(state.busy||!state.token)return;
  if(typeof row.credit_revision!=='string'){notify('用户余额版本未加载，请刷新后重试。','error');return}
  state.edit={row:{...row},confirmed:false,saving:false,uncertain:false,payload:null};
  $('#creditUser').textContent='账号：'+row.username;$('#creditBefore').textContent='当前剩余 '+row.credits+' 次';$('#creditAmount').value=String(row.credits);$('#creditNote').value='';creditMessage('修改将记录在次数流水中。');creditControls();$('#creditDialog').showModal();document.body.style.overflow='hidden';$('#creditAmount').focus();
}
async function submitCredit(){
  const edit=state.edit;if(!edit||edit.saving||!state.token)return;
  if(!edit.confirmed){
    const raw=$('#creditAmount').value.trim(),credits=Number(raw),note=$('#creditNote').value.trim();
    if(!/^\d+$/.test(raw)||!Number.isInteger(credits)||credits<0||credits>1000000||!note||Array.from(note).length>200){creditMessage('请填写 0–1000000 的整数次数和 1–200 字备注。',true);return}
    if(credits===edit.row.credits){creditMessage('新次数与当前相同，无需修改。',true);return}
    edit.payload={userId:edit.row.id,credits,expectedCredits:edit.row.credits,expectedRevision:edit.row.credit_revision,note,requestKey:crypto.randomUUID()};edit.confirmed=true;
    creditMessage('请确认：'+edit.row.username+' 的剩余次数从 '+edit.row.credits+' 次改为 '+credits+' 次（'+(credits>edit.row.credits?'增加 ':'减少 ')+Math.abs(credits-edit.row.credits)+' 次）。备注：'+note);creditControls();return;
  }
  edit.saving=true;creditControls();creditMessage('正在保存，请勿重复操作…');
  const generation=state.generation,controller=new AbortController();edit.controller=controller;const timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const result=await request('/api/admin/credits/update',state.token,controller.signal,edit.payload);
    if(generation!==state.generation||state.edit!==edit)return;
    if(!result.adjustment||result.adjustment.id!==edit.payload.requestKey)throw new Error('服务器结果未确认');
    const message='已保存：'+edit.row.username+'，'+result.adjustment.before_credits+' → '+result.adjustment.after_credits+' 次。修改记录已写入次数流水。';
    edit.saving=false;$('#creditDialog').close();await loadRecords();
    if(state.token)notify(message+(state.creditError?' 最新余额读取失败，请刷新查看。':state.recordError?' 部分记录读取失败，请刷新查看。':''),state.creditError||state.recordError?'error':'');
  }catch(error){
    if(generation!==state.generation||state.edit!==edit)return;
    if(error.status===401){logout('后台口令已失效，请重新输入。');return}
    edit.uncertain=!error.status||error.status>=500;
    creditMessage(edit.uncertain?'暂未确认保存结果。请点击「重试确认本次结果」，不会重复增加或覆盖次数。':error.message,true);
  }finally{clearTimeout(timeout);if(state.edit===edit){edit.saving=false;edit.controller=null;creditControls()}}
}
$('#creditForm').onsubmit=e=>{e.preventDefault();submitCredit()};$('#creditBack').onclick=()=>{if(!state.edit||state.edit.saving||state.edit.uncertain)return;state.edit.confirmed=false;state.edit.payload=null;creditMessage('请调整次数或备注，再次核对后保存。');creditControls()};$('#closeCredit').onclick=$('#creditCancel').onclick=()=>{if(!state.edit?.saving)$('#creditDialog').close()};$('#creditDialog').addEventListener('cancel',e=>{if(state.edit?.saving)e.preventDefault()});$('#creditDialog').addEventListener('close',()=>{state.edit=null;$('#creditUser').textContent='';$('#creditBefore').textContent='';$('#creditAmount').value='';$('#creditNote').value='';$('#creditStatus').textContent='';document.body.style.overflow=''});
$('#loginForm').onsubmit=e=>{e.preventDefault();loadRecords()};$('#refresh').onclick=loadRecords;$('#limit').onchange=loadRecords;$('#logout').onclick=()=>logout();
document.querySelectorAll('[data-view]').forEach(n=>n.onclick=()=>changeView(n.dataset.view));document.querySelectorAll('[data-kind]').forEach(n=>n.onclick=()=>{state.kind=n.dataset.kind;changeView('users')});
$('#search').oninput=e=>{state.query=e.target.value;state.page=1;renderTable()};$('#filter').onchange=e=>{state.filter=e.target.value;state.page=1;renderTable()};$('#pageSize').onchange=e=>{state.size=Number(e.target.value);state.page=1;renderTable()};$('#resetFilters').onclick=()=>changeView(state.view);
$('#prevPage').onclick=()=>{state.page--;renderTable()};$('#nextPage').onclick=()=>{state.page++;renderTable()};$('#closeDetail').onclick=()=>$('#detailDialog').close();$('#detailDialog').addEventListener('close',()=>{state.userQuestions?.controller?.abort();state.userQuestions=null;document.body.style.overflow='';$('#detailBody').replaceChildren()});
const savedToken=storage('get');if(savedToken){$('#token').value=savedToken;loadRecords()}
</script>
</body>
</html>`;
}

module.exports = { adminPage };
