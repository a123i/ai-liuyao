'use strict';
const { toDisplayAnswer } = require('../public/answer-presentation');

const PUBLIC_QUALITY_MESSAGE = '本次解读未通过卦象依据校验，请重试；本次不扣次数';
const ID = /^[A-Z][A-Z0-9_.-]{0,79}$/i;
const TENDENCIES = new Set(['favorable', 'unfavorable', 'mixed', 'uncertain']);
const UNCERTAINTY = /不确定|(?:无法|不能|难以)(?:(?:直接|可靠地?|准确地?|明确|具体|唯一|据此|进一步|从(?:本卦|卦盘|现有信息|所给信息)|仅凭(?:卦盘|本卦)|凭(?:卦盘|本卦|现有信息))){0,3}(?:判断|确定|确认|定论|推定|断定)|(?:无法|不能|难以)(?:直接|据此|可靠地|准确地)?给出(?:可靠|具体|准确|明确|确定)(?:性)?的?[^。！？；，,\n]{0,10}(?:时间|位置|方位|结论|判断|结果|答案)|(?:未|没有)提供(?:足够|充分|足以)的?(?:依据|证据|信息)?(?:来)?(?:判断|确定|确认)|不足以(?:可靠|准确|直接)?(?:判断|确定|确认|推定|断定)|(?:证据|依据|信息)不足|尚难|暂难|难下定论/;
const PLAIN_JARGON = /世爻|应爻|动爻|化爻|静爻|爻|月建|日辰|月令|用神|世应|旬空|回头[生克]|月破|干支|六亲|六神|空亡|旺衰|暗动|伏神|本卦|变卦|动变|纳甲|生扶|相生|相合|比扶|克力|同类支持|卦(?:里|中)|卦象(?:里|中)[^。！？；，,\n]{0,24}(?:代表[^。！？；，,\n]{0,12}(?:那(?:一)?部分|部分)|变化因素|(?:明确(?:的)?)?推动信号)|卦象结构|代表(?:手机|物品|所寻(?:手机|物品)|钱财|财物|自身|自己|你)[^。！？；，,\n]{0,8}(?:那(?:一)?部分|部分)|(?:手机|物品|钱财|财物)[^。！？；，,\n]{0,8}那(?:一)?部分[^。！？；，,\n]{0,12}(?:支持|力量|压制|冲击|有力|关联|作用)|(?:钱财|财物|求财|经营所得)[^。！？；，,\n]{0,12}核心位置[^。！？；，,\n]{0,18}(?:支持|支撑|力量|受(?:到)?冲击|压制|落空|不稳定|有力)|(?:这个|该|这处)核心位置[^。！？；，,\n]{0,18}(?:受(?:到)?冲击|落空|空档|压制|月令)|当月[^。！？；，,\n]{0,16}(?:有力|力量|支持|支撑|消耗|压制|克制)|代表[^。！？；\n]{0,12}那一项|(?:月份|日子|月日)[^。！？；，,\n]{0,16}(?:同类支持|力量|扶助|支持|消耗|克制|压制|耗泄|生克)|月日(?:条件|关系|旺衰|耗泄)|[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]|\bL[1-6](?:\.[A-Z_]+)*\b|SHI_YING/gi;
const CERTAINTY = /大概率|高概率|百分之|\d+(?:\.\d+)?\s*[%％]|一定(?:能|会|是|在)|肯定|必然|必定|绝对|保证(?:能|会|是)|确定(?:能|会|是)|(?:没有|没|未)被(?:偷(?:走)?|拿走|盗(?:走)?|别人拿(?:走)?)/g;
const NEGATED_CLAIM = /不能|无法|不可|不宜|不应理解为|不应|不要|勿|(?<![特识区差告离辨级分类个性])别|不把|难以|不足以|不代表|不等于|不表示|不意味着|不说明|不证明|并非|不是|不一定|未必|不作|避免|不得|不保证|不敢(?:说|断言)|未能确认/;
const PRECISE_TIME = /(?:将在|会在|能在|最迟|最快|预计|应在|届时在).{0,8}(?:\d{1,4}(?:年|月|日|天|周|小时|分钟|点)|[一二三四五六七八九十两]+(?:天|周|个月|小时|分钟|点)|今天|明天|后天|本周|下周)|(?:今天|明天|后天|本周|下周|(?:\d+|[一二三四五六七八九十两]+)(?:天|周|个月|小时)(?:后|内)).{0,10}(?:找到|找回|发生|成功|获批|到账|回来|恢复|出现)/;
const PRECISE_LOCATION = /(?:位于|藏在|落在|掉在|放在|留在|就在|可能在|应在|(?:手机|钥匙|证件|物品|东西|钱包|它)(?:可能|大约|应该|似乎)?在).{0,16}(?:抽屉|柜(?:子|里|内|底|上|下)|床(?:头|尾|底|下|上)|沙发|房间|办公室|厨房|卫生间|客厅|书房|卧室|口袋|车里|东南|西南|东北|西北|正东|正西|正南|正北)/;
const NAMED_PERIOD_PREDICTION = /(?:月初|月中|月末|上旬|中旬|下旬)[^。！？；，,\n]{0,12}(?:可能|将|会|预计|应当|松动|延后|出现|发生|找到|找回|改善|恢复|到账|落实)|(?:可能|将|会|预计|应当)[^。！？；，,\n]{0,8}(?:月初|月中|月末|上旬|中旬|下旬)/;
const PHYSICAL_STATE_CLAIM = /(?:手机|物品|东西|它)[^。！？；，,\n]{0,24}(?:静止|未被频繁移动|未被移动|没有移动|没(?:有)?被移动|仍在原处|还在原处)/;
const HIDDEN_LOCATION_CLAIM = /(?:(?:手机|钱包|钥匙|证件|耳机|物品|东西|它|所失之物|所寻之物)[^。！？；，,\n]{0,24}|伏藏(?:本身)?[^。！？；，,\n]{0,6}(?:说明|意味着|表示|提示|表明|显示))(?:(?:不在(?:显处|明处|(?:明显|显眼)的?(?:地方|位置|地点|处)))|(?:在|位于|处于)(?:实际)?(?:隐蔽|隐秘|不显眼)的?(?:地方|位置|地点|处))/;
const FACT_VALUE = /(?:\d+(?:\.\d+)?\s*|[零一二三四五六七八九十百千万两]+)(?:年|月|日|天|周|个月|小时|分钟|万元|元|公里|米|点)|今天|明天|后天|本周|下周|本月|下月|月初|月中|月末|上旬|中旬|下旬/g;

function qualityError(message) {
  const error = new Error(PUBLIC_QUALITY_MESSAGE);
  error.name = 'InterpretationQualityError';
  error.code = 'AI_QUALITY_ERROR';
  error.status = 502;
  // Keep repair diagnostics separate from the public message. Never include a raw draft.
  error.issues = [typeof message === 'string' && message.trim() ? message.trim().slice(0, 800) : '解读格式或依据不符合要求'];
  return error;
}

function fail(message) { throw qualityError(message); }

function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path}必须是对象`);
  const ownKeys = Object.keys(value);
  if (ownKeys.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || ownKeys.some(key => !keys.includes(key))) {
    fail(`${path}字段不符合约定`);
  }
}

function text(value, path, max = 1000, diagnostic = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${path}文本为空、过长或包含控制字符`);
  const result = value.trim().replace(/\s+/g, ' ');
  if (!diagnostic && /[<>]|\*\*|(?:^|\s)#{1,6}\s|一、专业分析|二、通俗解读/.test(result)) fail(`${path}不得自行添加格式或主标题`);
  return result;
}

function array(value, path, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${path}数组数量不符合约定`);
}

function kind(fact) { return typeof fact?.kind === 'string' ? fact.kind.toUpperCase() : ''; }

function json(raw) {
  if (typeof raw === 'string') {
    if (raw.length > 50000) fail('结构化结果过长');
    let source = raw.trim();
    const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(source);
    if (fence) source = fence[1];
    try { return JSON.parse(source); } catch { fail('结构化结果不是完整JSON'); }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('结构化结果不是JSON对象');
  return raw;
}

function bundleIndex(bundle) {
  if (!bundle || typeof bundle !== 'object') fail('代码事实表缺失');
  array(bundle.facts, 'facts', 1, 256);
  array(bundle.candidates, 'candidates', 1, 24);
  array(bundle.movingLineIds, 'movingLineIds', 0, 6);
  const facts = new Map();
  for (const fact of bundle.facts) {
    if (!fact || typeof fact.id !== 'string' || !ID.test(fact.id) || typeof fact.kind !== 'string' || typeof fact.text !== 'string' || !fact.text.trim() || facts.has(fact.id)) fail('代码事实表存在无效或重复编号');
    facts.set(fact.id, fact);
  }
  const candidates = new Map();
  for (const candidate of bundle.candidates) {
    const fact = facts.get(candidate?.factId);
    if (!candidate || !ID.test(candidate.id || '') || candidates.has(candidate.id) || !['main', 'hidden'].includes(candidate.source) || typeof candidate.relative !== 'string' || !candidate.relative || !ID.test(candidate.lineId || '') || !fact || !['IDENTITY', 'HIDDEN'].includes(kind(fact))) fail('代码用神候选无效');
    if (fact.lineId && fact.lineId !== candidate.lineId) fail('候选身份事实与爻位不一致');
    candidates.set(candidate.id, candidate);
  }
  const moving = new Set(bundle.movingLineIds);
  if (moving.size !== bundle.movingLineIds.length || [...moving].some(id => !/^L[1-6]$/.test(id))) fail('代码动爻编号无效');
  const changes = [...facts.values()].filter(fact => kind(fact) === 'CHANGE' && moving.has(fact.lineId || fact.id.split('.')[0]));
  if ([...moving].some(lineId => !changes.some(fact => (fact.lineId || fact.id.split('.')[0]) === lineId))) fail('代码动变事实缺失');
  const shiYing = [...facts.values()].filter(fact => kind(fact) === 'SHI_YING');
  if (!shiYing.length) fail('代码世应关系事实缺失');
  return { facts, candidates, changes, shiYing };
}

function evidence(value, path, facts) {
  array(value, path, 1, 80);
  const seen = new Set();
  return value.map(id => {
    if (typeof id !== 'string' || !ID.test(id) || !facts.has(id) || seen.has(id)) {
      const safeId = typeof id === 'string' ? id.slice(0, 80).replace(/[^A-Z0-9_.-]/gi, '?') : '非字符串';
      const reason = seen.has(id) ? '重复' : typeof id === 'string' && ID.test(id) ? '未知' : '无效';
      fail(`${path}包含${reason}事实编号“${safeId}”；只能引用代码事实表中的唯一编号`);
    }
    seen.add(id);
    return id;
  });
}

function safeClaims(value, path) {
  // Negation is clause-local except a dependent item in an explicitly denied
  // list. Contrast/result connectors terminate that scope, so “但肯定…” fails.
  const sentences = value.split(/[。！？；\n]|但是?|然而|不过|可是|却|因此|所以|故而|于是/);
  for (const sentence of sentences) {
    const clauses = sentence.split(/[，,]/);
    const deniedList = /不表示|不意味着|不证明|不说明|(?:不能|无法)(?:据此)?(?:认定|证明|断言)/.test(clauses[0]);
    for (const [clauseIndex, clause] of clauses.entries()) {
      const dependentListItem = clauseIndex > 0 && deniedList && /^\s*(?:以及|也|或|及|和)?(?:未被|没有被|没被)/.test(clause);
      CERTAINTY.lastIndex = 0;
      let match;
      while ((match = CERTAINTY.exec(clause))) {
        const before = clause.slice(0, match.index);
        const after = clause.slice(match.index + match[0].length);
        // Only a bare dependent list item inherits a disclaimer. An affirmative
        // predicate (“未被拿走已经是核实后的事实”) starts a new factual claim.
        const affirmativePredicate = /(?:已经|已|就是|是|属).{0,12}(?:核实|证实|确认|事实|确凿)/.test(clause);
        const bareListEnding = /^\s*(?:[”」』"']\s*)?(?:$|或(?:者)?|以及|及|和|与|、)/.test(after);
        const listedAbsenceClaim = dependentListItem && !affirmativePredicate && bareListEnding && /^(?:没有|没|未)被/.test(match[0]);
        if (!listedAbsenceClaim && !NEGATED_CLAIM.test(before) && !/^(?:这一说法|这一结论|的说法)?.{0,5}(?:无法确认|不能确认|不能证明|没有依据)/.test(after)) fail(`${path}含无依据的绝对断言或概率“${match[0]}”；请表达证据不足或解读倾向，不得认定现实事实`);
      }
      if ((PRECISE_TIME.test(clause) || PRECISE_LOCATION.test(clause)) && !NEGATED_CLAIM.test(clause)) fail(`${path}含未经核实的精确时间或地点断言`);
      const periodPrediction = NAMED_PERIOD_PREDICTION.exec(clause);
      const proposedSchedule = /^plain\.advice\[/.test(path) && /^(?:建议|可以|请|计划|安排|选择|先|不妨)/.test(clause.trim()) && /复盘|整理|核算|回顾|检查|安排|留出/.test(clause) && !/松动|延后|找到|找回|获批|到账|出现|发生|恢复/.test(clause);
      if (periodPrediction && !proposedSchedule && !NEGATED_CLAIM.test(clause)) fail(`${path}含无依据的具体时段预测“${periodPrediction[0]}”；月初、月中、月末及旬段不能仅凭卦象推定`);
      const physicalState = PHYSICAL_STATE_CLAIM.exec(clause);
      if (physicalState && !NEGATED_CLAIM.test(clause) && !/是否|是不是|有无|有没有/.test(clause)) fail(`${path}将静态象征推定为物品过去或当前物理状态“${physicalState[0]}”；可能、或许、似乎也不能证明物品静止、未移动或仍在原处，请改为现实状态未知、需实际核实`);
      const hiddenLocation = HIDDEN_LOCATION_CLAIM.exec(clause);
      if (hiddenLocation && !NEGATED_CLAIM.test(clause) && !/是否|是不是|有无|有没有/.test(clause)) fail(`${path}将伏藏象征推定为物品实际隐蔽位置“${hiddenLocation[0]}”；传统取象也不能证明物品不在显处或位于隐蔽处，请改为实际位置未知、需现实检查`);
    }
  }
}

function knownQuestionContradictions(value, path, question) {
  if (typeof question !== 'string') return;
  const namedObject = /手机|钱包|钥匙|证件|耳机/.exec(question);
  if (!namedObject) return;
  // A named example in an explicitly ambiguous list is not a settled object.
  if (/(?:不确定|不知道|不清楚|可能是|也许是)[^。！？\n]{0,12}(?:手机|钱包|钥匙|证件|耳机)/.test(question)) return;
  const genericObject = '(?:所失之物|所寻物品|所找物品|丢失物品|失物|物品|东西)';
  const missingBefore = new RegExp(`(?:缺少|缺乏|缺失|未(?:具体)?(?:说明|交代|明确|提供)|没有(?:说明|交代|提供)|不清楚|不知道)[^。！？；，,\\n]{0,6}(?:${genericObject}(?:的)?(?:种类|类别|性质|名称)?|是什么(?:东西|物品)|具体是什么)`, 'g');
  const missingAfter = new RegExp(`${genericObject}(?:的(?:种类|类别|性质|名称)|具体是什么|是什么)?(?:尚|还)?(?:未(?:具体)?(?:说明|交代|明确)|不明确|不清楚|未知)`);
  for (const match of value.matchAll(missingBefore)) {
    const after = value.slice(match.index + match[0].length);
    // It is legitimate to ask for details of a named object, not its identity.
    if (/^(?:的)?(?:型号|品牌|颜色|尺寸|价格|序列号|最后|使用|见到|出现|遗失|丢失|位置|地点|时间|日期|行程|记录|状态|是否开机)/.test(after)) continue;
    fail(`${path}错称物品种类未说明；所问已明确“${namedObject[0]}”，不得再次要求补充所失之物，可询问型号、品牌或最后见到的时间地点`);
  }
  if (missingAfter.test(value)) fail(`${path}错称物品种类未说明；所问已明确“${namedObject[0]}”，不得将已知物品当作缺失背景`);
}

function knownRelationContradictions(value, shiYingFacts) {
  const subject = '世(?:爻)?(?:与|和)?应(?:爻)?(?:关系|之间|两者)?';
  const deniedHarmony = new RegExp(`${subject}.{0,20}(?:无冲无合|无合|不相合|没有(?:相?合|六合)|(?:不|未)(?:构成|形成|存在)(?:六合|合)|并非(?:相合|六合))(?!化|力|效)`);
  const deniedClash = new RegExp(`${subject}.{0,20}(?:无冲|不相冲|没有(?:相?冲|六冲)|(?:不|未)(?:构成|形成|存在)(?:六冲|冲)|并非(?:相冲|六冲))`);
  const claimedHarmony = new RegExp(`${subject}.{0,20}(?:相合|六合|(?:形成|构成|存在)(?:合|六合))`, 'g');
  const claimedClash = new RegExp(`${subject}.{0,20}(?:相冲|六冲|(?:形成|构成|存在)(?:冲|六冲))`, 'g');
  for (const fact of shiYingFacts) {
    if (!['harmony', 'clash', 'none', 'same'].includes(fact.branchRelation)) continue;
    for (const clause of value.split(/[。！？；\n，,]|但是?|然而|不过|可是|却/)) {
      const denial = expression => {
        const match = expression.exec(clause);
        return match && !NEGATED_CLAIM.test(clause.slice(0, match.index));
      };
      if (fact.branchRelation === 'harmony' && denial(deniedHarmony)) fail('推论否认了代码核定的世应六合');
      if (fact.branchRelation === 'clash' && denial(deniedClash)) fail('推论否认了代码核定的世应六冲');
      // Negative statements about a relation are not positive relation claims.
      const positive = expression => {
        expression.lastIndex = 0;
        const match = expression.exec(clause);
        return match && !/(?:无|不|未|没有|并非|非).{0,6}(?:相合|六合|形成合|构成合|存在合|相冲|六冲|形成冲|构成冲|存在冲)/.test(match[0]) && !NEGATED_CLAIM.test(clause.slice(0, match.index) + match[0]);
      };
      if (fact.branchRelation !== 'harmony' && positive(claimedHarmony)) fail('推论新增了代码未核定的世应六合');
      if (fact.branchRelation !== 'clash' && positive(claimedClash)) fail('推论新增了代码未核定的世应六冲');
    }
  }
}

function parsePlain(raw) {
  const input = json(raw);
  object(input, ['answer', 'reasons', 'advice', 'limitations'], 'plain');
  array(input.reasons, 'plain.reasons', 1, 6);
  array(input.advice, 'plain.advice', 0, 5);
  return {
    answer: text(input.answer, 'plain.answer', 700),
    reasons: input.reasons.map((item, i) => {
      const path = `plain.reasons[${i}]`;
      object(item, ['text', 'evidence'], path);
      array(item.evidence, `${path}.evidence`, 1, 80);
      const references = item.evidence.map(id => {
        if (typeof id !== 'string' || !ID.test(id)) fail(`${path}.evidence包含无效事实编号`);
        return id;
      });
      return { text: text(item.text, `${path}.text`, 700), evidence: references };
    }),
    advice: input.advice.map((item, i) => text(item, `plain.advice[${i}]`, 500)),
    limitations: text(input.limitations, 'plain.limitations', 700)
  };
}

function parseDraft(raw, factsBundle) {
  const index = bundleIndex(factsBundle);
  const input = json(raw);
  object(input, ['schema_version', 'useful', 'analysis', 'conclusion', 'plain'], 'draft');
  if (input.schema_version !== '1') fail('schema_version不受支持');
  object(input.useful, ['candidate_id', 'reason', 'evidence'], 'useful');
  const candidate = index.candidates.get(input.useful.candidate_id);
  if (!candidate) fail('用神必须选取代码提供的实际候选');
  const useful = {
    candidate_id: candidate.id,
    reason: text(input.useful.reason, 'useful.reason', 1000),
    evidence: evidence(input.useful.evidence, 'useful.evidence', index.facts)
  };
  if (!useful.evidence.includes(candidate.factId)) fail('用神依据必须引用该候选的身份事实');
  array(input.analysis, 'analysis', 1, 16);
  const analysis = input.analysis.map((item, i) => {
    object(item, ['evidence', 'interpretation'], `analysis[${i}]`);
    return { evidence: evidence(item.evidence, `analysis[${i}].evidence`, index.facts), interpretation: text(item.interpretation, `analysis[${i}].interpretation`, 1500) };
  });
  const analysisIds = new Set(analysis.flatMap(item => item.evidence));
  for (const suffix of ['MONTH', 'DAY', 'VOID']) {
    const id = `${candidate.id}.${suffix}`;
    if (!index.facts.has(id)) fail(`代码用神事实缺失${id}`);
    if (!analysisIds.has(id)) fail(`专业分析遗漏用神必核事实${id}；月、日、日旬空依据须在analysis中逐项覆盖`);
  }
  for (const fact of [...index.changes, ...index.shiYing]) {
    if (!analysisIds.has(fact.id)) fail(`专业分析遗漏必核事实${fact.id}`);
  }
  object(input.conclusion, ['tendency', 'text', 'evidence'], 'conclusion');
  if (!TENDENCIES.has(input.conclusion.tendency)) fail('conclusion.tendency不受支持');
  const conclusion = {
    tendency: input.conclusion.tendency,
    text: text(input.conclusion.text, 'conclusion.text', 1000),
    evidence: evidence(input.conclusion.evidence, 'conclusion.evidence', index.facts)
  };
  const priorEvidence = new Set([...useful.evidence, ...analysisIds]);
  const newConclusionIds = conclusion.evidence.filter(id => !priorEvidence.has(id));
  if (newConclusionIds.length) fail(`专业结论必须承接用神或分析依据，不能新增未在前文使用的依据：${newConclusionIds.slice(0, 5).join('、')}`);
  const professionalEvidence = new Set([...priorEvidence, ...conclusion.evidence]);
  const plain = parsePlain(input.plain);
  plain.reasons = plain.reasons.map((item, i) => {
    const references = evidence(item.evidence, `plain.reasons[${i}].evidence`, index.facts);
    if (references.some(id => !professionalEvidence.has(id))) fail('通俗原因不得增加专业部分未使用的事实依据');
    return { text: item.text, evidence: references };
  });
  const professionalTexts = [useful.reason, ...analysis.map(item => item.interpretation), conclusion.text];
  const professionalPaths = ['useful.reason', ...analysis.map((_item, i) => `analysis[${i}].interpretation`), 'conclusion.text'];
  professionalTexts.forEach((value, i) => {
    safeClaims(value, professionalPaths[i]);
    knownRelationContradictions(value, index.shiYing);
    knownQuestionContradictions(value, professionalPaths[i], factsBundle.question);
  });
  const plainTexts = [plain.answer, ...plain.reasons.map(item => item.text), ...plain.advice, plain.limitations];
  const plainPaths = ['plain.answer', ...plain.reasons.map((_item, i) => `plain.reasons[${i}].text`), ...plain.advice.map((_item, i) => `plain.advice[${i}]`), 'plain.limitations'];
  const jargonProblems = [];
  plainTexts.forEach((value, i) => {
    const words = [...new Set([...value.matchAll(PLAIN_JARGON)].map(match => match[0]))];
    if (words.length) jargonProblems.push(`${plainPaths[i]}：“${words.join('”“')}”`);
  });
  if (jargonProblems.length) fail(`通俗字段包含专业术语、事实编号或符号绕译：${jargonProblems.join('；')}。请一次修正所有这些字段，直接写日常含义，不以月份力量、代表的那一项等方式重述技术推演`);
  plainTexts.forEach((value, i) => {
    safeClaims(value, plainPaths[i]);
    knownQuestionContradictions(value, plainPaths[i], factsBundle.question);
  });
  // Actionable advice may introduce a proposed schedule; assertions may not add values.
  const upperText = professionalTexts.join('\n');
  for (const value of [plain.answer, ...plain.reasons.map(item => item.text)]) {
    for (const match of value.matchAll(FACT_VALUE)) {
      const detail = match[0];
      // “多一点希望” is not a clock time or a factual numeric quantity.
      if (detail === '一点' && !/(?:上午|下午|中午|晚上|凌晨|早上)$/.test(value.slice(0, match.index)) && !/^(?:钟|半|整)/.test(value.slice(match.index + detail.length))) continue;
      if (!upperText.includes(detail)) fail(`通俗结论新增专业部分未支持的事实数值或时间“${detail}”`);
    }
  }
  if (conclusion.tendency === 'uncertain' && (!UNCERTAINTY.test(conclusion.text) || !UNCERTAINTY.test(plain.answer))) fail('不确定结论必须在专业结论与直接回答中明确表达不确定性');
  // This validates structure and enforceable constraints, not semantic grounding.
  // The caller must obtain an independent review before rendering to the user.
  return { schema_version: '1', useful, analysis, conclusion, plain };
}

function parseProfessional(raw, factsBundle) {
  const input = json(raw);
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('professional必须是对象');
  const keys = ['schema_version', 'useful', 'analysis', 'conclusion'];
  object(input, Object.hasOwn(input, 'plain') ? [...keys, 'plain'] : keys, 'professional');
  // A private validation scaffold reuses EVERY professional check in parseDraft.
  // It is always discarded; it is neither a translation nor a user-output fallback.
  // Existing complete fixtures may include plain, but this phase ignores it.
  const validated = parseDraft({
    schema_version: input.schema_version,
    useful: input.useful,
    analysis: input.analysis,
    conclusion: input.conclusion,
    plain: {
      answer: '现有依据不足，无法确定现实结果。',
      reasons: [{ text: '仅供内部结构校验，实际通俗内容必须独立生成并复核。', evidence: [input.useful?.evidence?.[0]] }],
      advice: [],
      limitations: '内部校验占位，不作为用户输出。'
    }
  }, factsBundle);
  const { plain: _discarded, ...professional } = validated;
  return professional;
}

function parseReview(raw) {
  const input = json(raw);
  object(input, ['verdict', 'issues'], 'review');
  if (!['pass', 'revise'].includes(input.verdict)) fail('review.verdict不受支持');
  array(input.issues, 'review.issues', input.verdict === 'pass' ? 0 : 1, input.verdict === 'pass' ? 0 : 8);
  return { verdict: input.verdict, issues: input.issues.map((item, i) => text(item, `review.issues[${i}]`, 800, true)) };
}

function renderInterpretation(rawDraft, factsBundle) {
  const draft = parseDraft(rawDraft, factsBundle);
  const { facts, candidates } = bundleIndex(factsBundle);
  const candidate = candidates.get(draft.useful.candidate_id);
  const chosenFact = facts.get(candidate.factId);
  const source = candidate.source === 'hidden' ? '伏神候选' : '本卦候选';
  // Evidence IDs and the full fact packet remain available to validation and
  // independent review. They are not presentation text or useful reading order.
  return toDisplayAnswer([
    '一、专业分析',
    '本次判断',
    draft.conclusion.text,
    '用神与依据',
    `选用用神：${source} ${candidate.id}（${candidate.relative}）。`,
    `核定身份：${chosenFact.text}`,
    draft.useful.reason,
    '关键卦象分析',
    ...draft.analysis.map((item, i) => `${i + 1}、${item.interpretation}`),
    '二、通俗解读',
    '直接回答',
    draft.plain.answer,
    '原因说明',
    ...draft.plain.reasons.map(item => item.text),
    ...(draft.plain.advice.length ? ['建议先做', ...draft.plain.advice.map((value, i) => `${i + 1}、${value}`)] : []),
    '需要说明',
    draft.plain.limitations
  ].join('\n\n'));
}

module.exports = { parseProfessional, parsePlain, parseDraft, parseReview, renderInterpretation, qualityError };
