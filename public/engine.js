/* 六爻排盘引擎 / Liu Yao casting engine
   纳甲(京房) · 八宫世应 · 六亲 · 六神 · 旬空 · 动爻变卦 · 伏神
   钱筮：一背少阳、两背少阴、三背老阳○(动)、三字老阴×(动) */

(function (root) {
  "use strict";

  const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
  const SOLAR_TERM_NAMES = [
    '小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至',
    '小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'
  ];
  const CalendarSolar = root.Solar ||
    (typeof require === 'function' ? require('./vendor/lunar.js').Solar : null);

  const GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  const ZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  const ZHI_WX = {子:'水',丑:'土',寅:'木',卯:'木',辰:'土',巳:'火',午:'火',未:'土',申:'金',酉:'金',戌:'土',亥:'水'};
  const ZHI_SX = {子:'鼠',丑:'牛',寅:'虎',卯:'兔',辰:'龙',巳:'蛇',午:'马',未:'羊',申:'猴',酉:'鸡',戌:'狗',亥:'猪'};
  const SHENG = {木:'火',火:'土',土:'金',金:'水',水:'木'}; // 我生
  const KE = {木:'土',土:'水',水:'火',火:'金',金:'木'};     // 我克
  const SIX_SHEN = ['青龙','朱雀','勾陈','螣蛇','白虎','玄武'];

  // 八经卦：bottom->top bits [初,二,三]
  const TRIG_BITS = {乾:[1,1,1],兑:[1,1,0],离:[1,0,1],震:[1,0,0],巽:[0,1,1],坎:[0,1,0],艮:[0,0,1],坤:[0,0,0]};
  const BITS_TRIG = {'111':'乾','110':'兑','101':'离','100':'震','011':'巽','010':'坎','001':'艮','000':'坤'};
  const TRIG_SYMBOL = {乾:'☰',兑:'☱',离:'☲',震:'☳',巽:'☴',坎:'☵',艮:'☶',坤:'☷'};
  const PALACE_WX = {乾:'金',兑:'金',离:'火',震:'木',巽:'木',坎:'水',艮:'土',坤:'土'};

  // 纳甲地支（六位序列：本卦同名卦初->上；内卦取[0..2]，外卦取[3..5]）
  const NAZHI = {
    乾:['子','寅','辰','午','申','戌'],
    坎:['寅','辰','午','申','戌','子'],
    艮:['辰','午','申','戌','子','寅'],
    震:['子','寅','辰','午','申','戌'],
    坤:['未','巳','卯','丑','亥','酉'],
    巽:['丑','亥','酉','未','巳','卯'],
    离:['卯','丑','亥','酉','未','巳'],
    兑:['巳','卯','丑','亥','酉','未'],
  };
  // 纳天干：[内卦干, 外卦干]
  const NAGAN = {乾:['甲','壬'],坤:['乙','癸'],震:['庚','庚'],巽:['辛','辛'],坎:['戊','戊'],离:['己','己'],艮:['丙','丙'],兑:['丁','丁']};

  function trigOf(bits3){ return BITS_TRIG[bits3.join('')]; }

  // 生成八宫表：key(6位bottom->top字符串) -> {palace,type,shi,ying}
  const PALACE_MAP = (function(){
    const flips = [[],[1],[1,2],[1,2,3],[1,2,3,4],[1,2,3,4,5],[1,2,3,5],[5]];
    const shi   = [6,1,2,3,4,5,4,3];
    const types = ['本宫','一世','二世','三世','四世','五世','游魂','归魂'];
    const map = {};
    Object.keys(TRIG_BITS).forEach(function(P){
      const b = TRIG_BITS[P];
      const base = [b[0],b[1],b[2],b[0],b[1],b[2]];
      for (let k=0;k<8;k++){
        const arr = base.slice();
        flips[k].forEach(function(pos){ arr[pos-1] = arr[pos-1]?0:1; });
        const key = arr.join('');
        const s = shi[k];
        map[key] = {palace:P, type:types[k], shi:s, ying: s<=3 ? s+3 : s-3};
      }
    });
    return map;
  })();

  // 某爻地支五行 vs 卦宫五行 -> 六亲
  function liuqin(palaceWX, lineWX){
    if (lineWX === palaceWX) return '兄弟';
    if (SHENG[lineWX] === palaceWX) return '父母'; // 生我
    if (SHENG[palaceWX] === lineWX) return '子孙'; // 我生
    if (KE[lineWX] === palaceWX) return '官鬼';    // 克我
    if (KE[palaceWX] === lineWX) return '妻财';    // 我克
    return '?';
  }

  // 一个卦的纳甲（返回6爻，index0=初）
  function naJia(arr){
    const lower = trigOf(arr.slice(0,3));
    const upper = trigOf(arr.slice(3,6));
    const out = [];
    for (let i=0;i<6;i++){
      const trig = i<3 ? lower : upper;
      const zhi = NAZHI[trig][i];
      const gan = i<3 ? NAGAN[trig][0] : NAGAN[trig][1];
      out.push({pos:i+1, yang:arr[i], gan:gan, zhi:zhi, wx:ZHI_WX[zhi], sx:ZHI_SX[zhi]});
    }
    return out;
  }

  function hexInfo(arr){
    const key = arr.join('');
    const pm = PALACE_MAP[key];
    const lower = trigOf(arr.slice(0,3));
    const upper = trigOf(arr.slice(3,6));
    return {
      key:key, arr:arr.slice(),
      lower:lower, upper:upper,
      symbol: TRIG_SYMBOL[upper] + TRIG_SYMBOL[lower],
      palace: pm.palace, palaceWX: PALACE_WX[pm.palace],
      gongType: pm.type, shi: pm.shi, ying: pm.ying
    };
  }

  // 纳甲+六亲；变卦沿用本卦卦宫五行，独立装卦时才取自身卦宫。
  function dressLines(arr, liuqinBasisWX){
    const info = hexInfo(arr);
    const nj = naJia(arr);
    return nj.map(function(l){
      return Object.assign({}, l, {
        liuqin: liuqin(liuqinBasisWX || info.palaceWX, l.wx),
        shi: l.pos === info.shi,
        ying: l.pos === info.ying
      });
    });
  }

  // 伏神：本宫纯卦中缺失的六亲，伏于本卦同爻位之下
  function fuShen(benArr){
    const info = hexInfo(benArr);
    const benLines = dressLines(benArr);
    const present = {};
    benLines.forEach(function(l){ present[l.liuqin]=true; });
    const all = ['兄弟','父母','子孙','官鬼','妻财'];
    const missing = all.filter(function(x){ return !present[x]; });
    if (!missing.length) return {};
    // 本宫纯卦
    const b = TRIG_BITS[info.palace];
    const pureArr = [b[0],b[1],b[2],b[0],b[1],b[2]];
    const pureLines = dressLines(pureArr);
    const fu = {}; // pos(1..6) -> {liuqin,gan,zhi,wx}
    pureLines.forEach(function(l){
      if (missing.indexOf(l.liuqin) >= 0){
        fu[l.pos] = {liuqin:l.liuqin, gan:l.gan, zhi:l.zhi, wx:l.wx};
      }
    });
    return fu;
  }

  // ---- 日干支 ----
  function jdn(y,m,d){
    const a = Math.floor((14-m)/12);
    const yy = y + 4800 - a;
    const mm = m + 12*a - 3;
    return d + Math.floor((153*mm+2)/5) + 365*yy + Math.floor(yy/4) - Math.floor(yy/100) + Math.floor(yy/400) - 32045;
  }
  function dayGanZhi(y,m,d){
    const J = jdn(y,m,d);
    const g = ((J + 9) % 10 + 10) % 10;   // 校准：2026-06-21 = 丙寅
    const z = ((J + 1) % 12 + 12) % 12;
    return {ganIdx:g, zhiIdx:z, gan:GAN[g], zhi:ZHI[z], text:GAN[g]+ZHI[z]};
  }
  function pad2(value){ return String(value).padStart(2, '0'); }
  function beijingParts(date){
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('INVALID_CAST_TIME');
    const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
    return {
      y:shifted.getUTCFullYear(), m:shifted.getUTCMonth()+1, d:shifted.getUTCDate(),
      hour:shifted.getUTCHours(), minute:shifted.getUTCMinutes(), second:shifted.getUTCSeconds()
    };
  }
  function solarTermInstant(year, termIndex){
    if (!Number.isInteger(year) || termIndex<0 || termIndex>23) throw new Error('INVALID_SOLAR_TERM');
    if (!CalendarSolar) throw new Error('CALENDAR_ENGINE_UNAVAILABLE');
    const table=CalendarSolar.fromYmdHms(year,6,15,12,0,0).getLunar().getJieQiTable();
    const term=table[SOLAR_TERM_NAMES[termIndex]];
    if (!term) throw new Error('SOLAR_TERM_NOT_FOUND');
    return Date.UTC(term.getYear(),term.getMonth()-1,term.getDay(),term.getHour()-8,term.getMinute(),term.getSecond());
  }
  function yearGanZhi(year){
    const index = ((year-4)%60+60)%60;
    const ganIdx=index%10, zhiIdx=index%12;
    return {ganIdx:ganIdx, zhiIdx:zhiIdx, gan:GAN[ganIdx], zhi:ZHI[zhiIdx], text:GAN[ganIdx]+ZHI[zhiIdx]};
  }
  function monthGanZhi(dateMs, pillarYear, yearGanIdx){
    const boundaries=[];
    for(let offset=0;offset<=10;offset++){
      boundaries.push({at:solarTermInstant(pillarYear,2+offset*2), offset:offset});
    }
    boundaries.push({at:solarTermInstant(pillarYear+1,0), offset:11});
    let monthOffset=0;
    boundaries.forEach(function(boundary){ if(dateMs>=boundary.at) monthOffset=boundary.offset; });
    const zhiIdx=(2+monthOffset)%12;
    const ganIdx=((yearGanIdx%5)*2+2+monthOffset)%10;
    return {ganIdx:ganIdx, zhiIdx:zhiIdx, gan:GAN[ganIdx], zhi:ZHI[zhiIdx], text:GAN[ganIdx]+ZHI[zhiIdx]};
  }
  function hourGanZhi(dayGanIdx, hour){
    const zhiIdx=Math.floor((hour+1)/2)%12;
    const ganIdx=((dayGanIdx%5)*2+zhiIdx)%10;
    return {ganIdx:ganIdx, zhiIdx:zhiIdx, gan:GAN[ganIdx], zhi:ZHI[zhiIdx], text:GAN[ganIdx]+ZHI[zhiIdx]};
  }
  function withKong(pillar){
    return Object.assign({},pillar,{kong:xunKong(pillar.ganIdx,pillar.zhiIdx)});
  }
  function castTimestamp(date){
    const instant=date||new Date();
    const p=beijingParts(instant);
    const pillarYear=instant.getTime()<solarTermInstant(p.y,2)?p.y-1:p.y;
    const year=yearGanZhi(pillarYear);
    const month=monthGanZhi(instant.getTime(),pillarYear,year.ganIdx);
    const day=dayGanZhi(p.y,p.m,p.d);
    const hour=hourGanZhi(day.ganIdx,p.hour);
    return {
      iso:`${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}+08:00`,
      display:`${p.y}年${pad2(p.m)}月${pad2(p.d)}日 ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`,
      timezone:'Asia/Shanghai', parts:p,
      pillars:{year:withKong(year),month:withKong(month),day:withKong(day),hour:withKong(hour)}
    };
  }
  function xunKong(ganIdx, zhiIdx){
    const head = ((zhiIdx - ganIdx) % 12 + 12) % 12; // 旬首地支(子=0)
    return [ ZHI[(head+10)%12], ZHI[(head+11)%12] ];
  }
  function liuShenStart(ganIdx){
    if (ganIdx<=1) return 0;      // 甲乙 青龙
    if (ganIdx<=3) return 1;      // 丙丁 朱雀
    if (ganIdx===4) return 2;     // 戊   勾陈
    if (ganIdx===5) return 3;     // 己   螣蛇
    if (ganIdx<=7) return 4;      // 庚辛 白虎
    return 5;                     // 壬癸 玄武
  }

  // ---- 主排盘 ----
  // coins: 长度6数组，index0=初爻，每项=背的个数(0..3)
  // date: {y,m,d}
  // textDB: ICHING_TEXT，可选（含卦辞爻辞）
  function cast(coins, date, textDB){
    if (!Array.isArray(coins) || coins.length !== 6 ||
        !coins.every(function(backs){ return Number.isInteger(backs) && backs >= 0 && backs <= 3; })) {
      throw new Error('INVALID_COINS');
    }
    const timestamp=date instanceof Date?castTimestamp(date):(date&&date.pillars?date:null);
    const castDate=timestamp?timestamp.parts:date;
    const ben = [], moving = [], chg = [], coinDetail = [];
    for (let i=0;i<6;i++){
      const backs = coins[i];
      // 钱筮：一背为单(少阳)、两背为拆(少阴)，三背老阳、三字老阴。
      const yang = (backs===1 || backs===3) ? 1 : 0;
      const isMove = (backs===3 || backs===0);
      ben.push(yang);
      moving.push(isMove);
      chg.push(isMove ? (yang?0:1) : yang);
      let kind = backs===3?'老阳':backs===2?'少阴':backs===1?'少阳':'老阴';
      coinDetail.push({backs:backs, yang:yang, move:isMove, kind:kind});
    }
    const hasMove = moving.some(Boolean);

    const benInfo = hexInfo(ben);
    const benLines = dressLines(ben);
    const fu = fuShen(ben);

    // 六神
    const gz = timestamp?timestamp.pillars.day:dayGanZhi(castDate.y,castDate.m,castDate.d);
    const kong = timestamp?timestamp.pillars.day.kong:xunKong(gz.ganIdx,gz.zhiIdx);
    const start = liuShenStart(gz.ganIdx);

    benLines.forEach(function(l, i){
      l.move = moving[i];
      l.liushen = SIX_SHEN[(start + i) % 6];
      l.kong = (kong.indexOf(l.zhi) >= 0);
      l.fu = fu[l.pos] || null;
    });

    let changed = null, chgInfo = null;
    if (hasMove){
      chgInfo = hexInfo(chg);
      const chgLines = dressLines(chg, benInfo.palaceWX); // 变爻六亲依本卦卦宫
      chgLines.forEach(function(l,i){ l.move = moving[i]; });
      changed = chgLines;
    }

    // 文本
    function nameOf(info){ return textDB ? (textDB[info.key]||{}).n : null; }
    function pack(info, lines){
      const t = textDB ? textDB[info.key] : null;
      return {
        key: info.key,
        name: t ? t.n : null,
        symbol: info.symbol,
        upper: info.upper, lower: info.lower,
        palace: info.palace, palaceWX: info.palaceWX, gongType: info.gongType,
        guaci: t ? t.g : null,
        yaoci: t ? t.l : null,
        yongText: t && t.y ? t.y : null,
        lines: lines
      };
    }

    return {
      day: gz, kong: kong, timestamp: timestamp,
      hasMove: hasMove,
      moving: moving,
      coins: coinDetail,
      ben: pack(benInfo, benLines),
      chg: changed ? pack(chgInfo, changed) : null
    };
  }

  const api = {
    cast: cast, dayGanZhi: dayGanZhi, xunKong: xunKong,
    castTimestamp:castTimestamp, solarTermInstant:solarTermInstant, yearGanZhi:yearGanZhi,
    monthGanZhi:monthGanZhi, hourGanZhi:hourGanZhi, beijingParts:beijingParts,
    hexInfo: hexInfo, dressLines: dressLines, fuShen: fuShen,
    naJia: naJia, liuqin: liuqin, jdn: jdn,
    PALACE_MAP: PALACE_MAP, GAN:GAN, ZHI:ZHI
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LiuYao = api;
})(typeof window !== 'undefined' ? window : globalThis);
