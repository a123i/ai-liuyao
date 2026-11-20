'use strict';

/*
 * Deterministic evidence, not a fortune/scoring engine. Call only after the
 * server has validated the cast; this module additionally checks chart identity.
 * Convention: 京房纳甲 / 本卦宫定六亲 / 日柱旬空 / 《增删卜易》化爻限本位。
 * Primary texts consulted 2026-10-12 (definitions, not evidence of prediction):
 * 五行 / 地支五行: https://zh.wikisource.org/zh-hans/增刪卜易/11
 * https://zh.wikisource.org/zh-hans/增刪卜易/12
 * https://zh.wikisource.org/zh-hans/增刪卜易/17
 * 六合 (including 辰酉), 六冲, 月破:
 * https://zh.wikisource.org/zh-hans/增刪卜易/19
 * https://zh.wikisource.org/zh-hans/增刪卜易/20
 * https://zh.wikisource.org/zh-hans/增刪卜易/16
 * 动静、化爻作用边界、暗动条件、日旬空、用神类别:
 * https://zh.wikisource.org/zh-hans/增刪卜易/14
 * https://zh.wikisource.org/zh-hans/增刪卜易/15
 * https://zh.wikisource.org/zh-hans/增刪卜易/22
 * https://zh.wikisource.org/zh-hans/增刪卜易/26
 * https://zh.wikisource.org/zh-hans/增刪卜易/8
 * 进退神: https://www.shidianguji.com/mid-page/7543003298585296942
 * The latter primary-text transcription gives seven forward pairs. Editions
 * differ on 戌→丑 / 丑→戌: do NOT infer wraparound progression here. Neither
 * 十二长生(土墓绝有不同约定) nor automatic 三合成化 is implemented.
 */

const engine = require('../public/engine');

const VERSION = '1.0.0';
const ELEMENTS = ['木', '火', '土', '金', '水'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCH_WX = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
const GENERATES = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const OVERCOMES = { 木: '土', 火: '金', 土: '水', 金: '木', 水: '火' };
const HARMONY = { 子: '丑', 丑: '子', 寅: '亥', 亥: '寅', 卯: '戌', 戌: '卯', 辰: '酉', 酉: '辰', 巳: '申', 申: '巳', 午: '未', 未: '午' };
const ADVANCE = { 亥: '子', 寅: '卯', 巳: '午', 申: '酉', 丑: '辰', 辰: '未', 未: '戌' };
const RETREAT = Object.fromEntries(Object.entries(ADVANCE).map(([a, b]) => [b, a]));
const POSITION_TAGS = ['初', '二', '三', '四', '五', '上'];
const BRANCH_LABELS = { same: '同支', clash: '六冲', harmony: '六合', none: '无同支、六合或六冲' };

// Every valid ordered pair has exactly one directional five-element relation.
function elementRelation(fromWX, toWX) {
  if (!ELEMENTS.includes(fromWX) || !ELEMENTS.includes(toWX)) throw new Error('INVALID_ELEMENT');
  if (fromWX === toWX) return 'same';
  if (GENERATES[fromWX] === toWX) return 'generates';
  if (OVERCOMES[fromWX] === toWX) return 'overcomes';
  if (GENERATES[toWX] === fromWX) return 'generated_by';
  return 'overcome_by';
}

// This deliberately does not return 刑/害/破/三合 or infer 合化.
function branchRelation(fromZhi, toZhi) {
  const a = BRANCHES.indexOf(fromZhi);
  const b = BRANCHES.indexOf(toZhi);
  if (a < 0 || b < 0) throw new Error('INVALID_BRANCH');
  if (a === b) return 'same';
  if ((a + 6) % 12 === b) return 'clash';
  if (HARMONY[fromZhi] === toZhi) return 'harmony';
  return 'none';
}

// Accept a canonical line ({pos, yang}); a position/ID gives 初爻..上爻.
function lineName(line) {
  const pos = typeof line === 'object' && line !== null ? line.pos
    : typeof line === 'string' && /^L[1-6]$/.test(line) ? Number(line.slice(1)) : line;
  if (!Number.isInteger(pos) || pos < 1 || pos > 6) throw new Error('INVALID_LINE_POSITION');
  if (typeof line !== 'object' || line === null || line.yang === undefined) return `${POSITION_TAGS[pos - 1]}爻`;
  if (line.yang !== 0 && line.yang !== 1) throw new Error('INVALID_LINE_POLARITY');
  const polarity = line.yang ? '九' : '六';
  return pos === 1 || pos === 6 ? `${POSITION_TAGS[pos - 1]}${polarity}` : `${polarity}${POSITION_TAGS[pos - 1]}`;
}

function relationText(from, to, relation) {
  if (relation === 'same') return `${from}与${to}同五行比和`;
  if (relation === 'generates') return `${from}生${to}`;
  if (relation === 'overcomes') return `${from}克${to}`;
  if (relation === 'generated_by') return `${to}生${from}`;
  return `${to}克${from}`;
}

function pillarInfo(pillar) {
  const text = typeof pillar?.text === 'string' ? pillar.text : '';
  if (text.length !== 2 || !STEMS.includes(text[0]) || !BRANCHES.includes(text[1]) ||
      STEMS.indexOf(text[0]) % 2 !== BRANCHES.indexOf(text[1]) % 2) throw new Error('INVALID_RULE_PILLAR');
  return { text, gan: text[0], zhi: text[1], wx: BRANCH_WX[text[1]] };
}

function calendarRelation(pillar, subject) {
  return {
    fromZhi: pillar.zhi, fromWX: pillar.wx, toZhi: subject.zhi, toWX: subject.wx,
    elementRelation: elementRelation(pillar.wx, subject.wx),
    branchRelation: branchRelation(pillar.zhi, subject.zhi)
  };
}

function chartPattern(chartLines) {
  const pairs = [0, 1, 2].map(index => ({
    from: `L${index + 1}`, to: `L${index + 4}`,
    branchRelation: branchRelation(chartLines[index].zhi, chartLines[index + 3].zhi)
  }));
  return { type: pairs.every(pair => pair.branchRelation === 'harmony') ? 'harmony'
    : pairs.every(pair => pair.branchRelation === 'clash') ? 'clash' : 'mixed', pairs };
}

function progression(fromZhi, toZhi) {
  if (ADVANCE[fromZhi] === toZhi) return 'advance';
  if (RETREAT[fromZhi] === toZhi) return 'retreat';
  if ((fromZhi === '戌' && toZhi === '丑') || (fromZhi === '丑' && toZhi === '戌')) return 'disputed';
  return 'none';
}

const CATEGORY_HINTS = [
  { id: 'lost_property', label: '寻物', pattern: /寻物|失物|丢失|遗失|(?:手机|钱包|钥匙|物品).{0,20}(?:在哪|哪里|找到|找回|丢了|不见了)|(?:找回|找到|寻找|丢了).{0,10}(?:手机|钱包|钥匙|物品)/, relatives: ['妻财'], ambiguous: true },
  { id: 'wealth', label: '财务', pattern: /求财|收入|工资|回款|欠款|借款|贷款|收益|利润|生意|投资|交易|钱|财运/, relatives: ['妻财'] },
  { id: 'career', label: '工作', pattern: /工作|求职|事业|升职|职场|岗位|入职|面试|应聘|录用/, relatives: ['官鬼', '父母'] },
  { id: 'education', label: '学业', pattern: /考试|考研|学业|成绩|入学|学校|学习/, relatives: ['父母', '官鬼'] },
  { id: 'relationship', label: '感情', pattern: /恋爱|感情|婚|对象|伴侣|复合|相亲|丈夫|妻子|男友|女友/, relatives: ['妻财', '官鬼'], ambiguous: true },
  { id: 'health', label: '健康', pattern: /疾病|生病|健康|治疗|手术|用药|医药|身体/, relatives: ['官鬼', '子孙'], ambiguous: true },
  { id: 'documents', label: '文书契约', pattern: /合同|文书|证件|证明|契约|房屋|房产|车辆|车子/, relatives: ['父母'] },
  { id: 'parents', label: '父母长辈', pattern: /父亲|母亲|爸爸|妈妈|父母|祖父|祖母|爷爷|奶奶|师长/, relatives: ['父母'] },
  { id: 'descendants', label: '子女', pattern: /孩子|子女|儿子|女儿|孙子|孙女|宠物/, relatives: ['子孙'] },
  { id: 'siblings', label: '兄弟同辈', pattern: /兄弟|姐妹|哥哥|弟弟|姐姐|妹妹/, relatives: ['兄弟'] }
];

function questionHints(question) {
  const matches = CATEGORY_HINTS.filter(category => category.pattern.test(question));
  return {
    id: matches.length === 1 ? matches[0].id : matches.length ? 'multiple' : 'unclear',
    label: matches.length === 1 ? matches[0].label : matches.length ? '跨类别问题' : '问题类别待明确',
    ambiguous: matches.length !== 1 || matches.some(category => category.ambiguous),
    matchedCategories: matches.map(category => category.id),
    suggestedRelatives: [...new Set(matches.flatMap(category => category.relatives))],
    finalSelection: null
  };
}

function checkIdentity(actual, expected, fields) {
  if (!actual || fields.some(field => actual[field] !== expected[field])) throw new Error('INVALID_RULE_CHART_IDENTITY');
}

/**
 * Input: validated {question, timestamp, canonicalCast?, cast}. canonicalCast
 * takes priority; cast.timestamp is a fallback for timestamp. No mutations.
 * Output: {version,facts,lines,candidates,month,day,dayKong,movingLineIds,
 *          shiId,yingId,questionCategory}.
 * facts are {id,kind,text,...structured evidence}. All relation metadata has an
 * explicit direction. A relation is NOT an asserted active effect/outcome.
 */
function buildRuleFacts(input) {
  const cast = input?.canonicalCast || input?.cast;
  const timestamp = input?.timestamp || cast?.timestamp;
  if (!cast?.ben || !/^[01]{6}$/.test(cast.ben.key) || !Array.isArray(cast.ben.lines) ||
      cast.ben.lines.length !== 6) throw new Error('INVALID_RULE_CHART');
  const month = pillarInfo(timestamp?.pillars?.month);
  const day = pillarInfo(timestamp?.pillars?.day);
  // Recalculate from the DAY pillar, never from other pillars or line.kong.
  const dayKong = engine.xunKong(STEMS.indexOf(day.gan), BRANCHES.indexOf(day.zhi));
  const bits = [...cast.ben.key].map(Number);
  const mainInfo = engine.hexInfo(bits);
  checkIdentity(cast.ben, { palace: mainInfo.palace, palaceWX: mainInfo.palaceWX, gongType: mainInfo.gongType }, ['palace', 'palaceWX', 'gongType']);
  const expectedMain = engine.dressLines(bits);
  const expectedHidden = engine.fuShen(bits);
  const identityFields = ['pos', 'yang', 'gan', 'zhi', 'wx', 'liuqin', 'shi', 'ying'];
  cast.ben.lines.forEach((line, index) => {
    checkIdentity(line, expectedMain[index], identityFields);
    if (typeof line.move !== 'boolean') throw new Error('INVALID_RULE_MOVEMENT');
    const fu = expectedHidden[index + 1];
    if (fu) checkIdentity(line.fu, fu, ['gan', 'zhi', 'wx', 'liuqin']);
    else if (line.fu) throw new Error('INVALID_RULE_HIDDEN');
  });
  const moving = cast.ben.lines.map(line => line.move);
  if (cast.hasMove !== moving.some(Boolean)) throw new Error('INVALID_RULE_MOVEMENT');
  let expectedChanged = null;
  if (moving.some(Boolean)) {
    const changedBits = bits.map((bit, index) => moving[index] ? 1 - bit : bit);
    const changedInfo = engine.hexInfo(changedBits);
    if (!cast.chg || !Array.isArray(cast.chg.lines) || cast.chg.lines.length !== 6 ||
        cast.chg.key !== changedBits.join('')) throw new Error('INVALID_RULE_CHANGED');
    checkIdentity(cast.chg, { palace: changedInfo.palace, palaceWX: changedInfo.palaceWX, gongType: changedInfo.gongType }, ['palace', 'palaceWX', 'gongType']);
    expectedChanged = engine.dressLines(changedBits, mainInfo.palaceWX);
    cast.chg.lines.forEach((line, index) => checkIdentity(line, expectedChanged[index], identityFields));
  } else if (cast.chg !== null && cast.chg !== undefined) throw new Error('INVALID_RULE_CHANGED');

  function subject(raw, id, source, lineId) {
    const item = {
      id, lineId, source, pos: Number(lineId.slice(1)), gan: raw.gan, zhi: raw.zhi, wx: raw.wx,
      relative: raw.liuqin, liuqin: raw.liuqin, dayVoid: dayKong.includes(raw.zhi)
    };
    item.month = { ...calendarRelation(month, item), monthBroken: branchRelation(month.zhi, item.zhi) === 'clash' };
    item.day = calendarRelation(day, item);
    return item;
  }

  const lines = expectedMain.map((raw, index) => {
    const id = `L${index + 1}`;
    const item = { ...subject(raw, id, 'main', id), name: lineName(raw), yang: raw.yang,
      move: moving[index], shi: raw.shi, ying: raw.ying, liushen: cast.ben.lines[index].liushen || '' };
    item.changed = moving[index] ? { ...subject(expectedChanged[index], `${id}.C`, 'changed', id),
      yang: expectedChanged[index].yang, name: lineName(expectedChanged[index]) } : null;
    item.hidden = expectedHidden[index + 1] ? subject(expectedHidden[index + 1], `${id}.F`, 'hidden', id) : null;
    return item;
  });
  const movingLineIds = lines.filter(line => line.move).map(line => line.id);
  const shi = lines.find(line => line.shi);
  const ying = lines.find(line => line.ying);
  const questionCategory = questionHints(typeof input.question === 'string' ? input.question.slice(0, 300) : '');
  const candidates = lines.flatMap(line => [
    { id: line.id, lineId: line.id, relative: line.relative, source: 'main', factId: `${line.id}.IDENTITY` },
    ...(line.hidden ? [{ id: line.hidden.id, lineId: line.id, relative: line.hidden.relative,
      source: 'hidden', factId: `${line.id}.HIDDEN` }] : [])
  ]);
  const facts = [];
  function add(id, kind, text, evidence = {}) { facts.push({ id, kind, text, ...evidence }); }
  const mainPattern = chartPattern(expectedMain);
  const changedPattern = expectedChanged ? chartPattern(expectedChanged) : null;
  const patternLabel = pattern => pattern.type === 'harmony' ? '六合卦' : pattern.type === 'clash' ? '六冲卦' : '非全组六冲或六合卦';

  add('CHART', 'chart', `本卦${cast.ben.name || cast.ben.key}，${mainInfo.palace}宫（${mainInfo.gongType}），${patternLabel(mainPattern)}；${movingLineIds.length ? `动爻${movingLineIds.join('、')}，变卦${cast.chg.name || cast.chg.key}（${patternLabel(changedPattern)}）` : '无动爻、无变卦'}。卦的冲合结构本身不等于吉凶。`,
    { key: cast.ben.key, palace: mainInfo.palace, palaceWX: mainInfo.palaceWX, mainPattern, changedPattern, movingLineIds });
  add('PALACE', 'palace', `本卦宫五行为${mainInfo.palaceWX}，本卦、化爻、伏神的六亲均以本卦宫为参照；变卦自身宫五行不重定化爻六亲。`,
    { basisWX: mainInfo.palaceWX, basisPalace: mainInfo.palace });
  add('CALENDAR', 'calendar', `月建${month.zhi}${month.wx}，日辰${day.zhi}${day.wx}，日柱${day.text}的旬空为${dayKong.join('')}。仅此日旬空用于本爻、化爻、伏神；年、月、时旬空不参与。`,
    { month, day, dayKong });
  add('SCOPE', 'scope', '五行生克与地支同支、六合、六冲是结构事实，不自动等于有效作用、合化或吉凶。月破只标月支相冲；日冲不自动判暗动、日破或冲空填实，须结合动静、月日、空破与用神。空亡不一律无效。化爻按《增删卜易》约定只论本位回头作用，不当作独立动爻作用其他本爻；变卦非动位不当作化爻。进退采用原文七组，不推戌丑循环。未自动判十二长生、土墓绝、三合成化、贪生忘克及精确应期。',
    { conditional: true, excludedRules: ['automatic_hidden_movement', 'automatic_day_break', 'automatic_void_fill', 'twelve_growth_states', 'automatic_triad_transformation', 'fortune_score'] });
  add('QUESTION', 'question', `问题类别提示：${questionCategory.label}；${questionCategory.suggestedRelatives.length ? `可先核对${questionCategory.suggestedRelatives.join('、')}及世应` : '所问不足以确定用神'}。这是关键词提示，不是确定用神；需按所问人物、事项与候选位置解释选择，多个本爻或伏神不得自动择一。`,
    { questionCategory, candidateIds: candidates.map(candidate => candidate.id), conditional: true });

  function addCalendarFacts(item, prefix, label) {
    for (const [key, pillar, type] of [['month', month, '月建'], ['day', day, '日辰']]) {
      const relation = item[key];
      const same = relation.branchRelation === 'same' ? `；临${type}` : '';
      const broken = key === 'month' && relation.monthBroken ? '；月破（逢月冲，不等于永久无效）' : '';
      const dayClash = key === 'day' && relation.branchRelation === 'clash' ? '；仅记日冲，不据此自动定暗动或日破' : '';
      const reverse = relation.elementRelation === 'generated_by' || relation.elementRelation === 'overcome_by'
        ? '（仅五行方向，不表示爻能作用日月）' : '';
      const support = { same: '同五行比扶条件', generates: '日月生扶爻的条件',
        overcomes: '爻受日月克制的条件', generated_by: '爻生对应日月五行，可作泄气条件',
        overcome_by: '爻克对应日月五行，可作耗力条件' }[relation.elementRelation];
      add(`${prefix}.${key.toUpperCase()}`, key,
        `${label}${item.zhi}${item.wx}：${relationText(`${type}${pillar.zhi}${pillar.wx}`, label, relation.elementRelation)}${reverse}；${support}（只是条件，不据此单独定整体旺衰）；地支${BRANCH_LABELS[relation.branchRelation]}${same}${broken}${dayClash}。`,
        { lineId: item.lineId, subjectId: item.id, source: item.source, ...relation, activeEffect: null });
    }
    add(`${prefix}.VOID`, 'void', `${label}${item.zhi}${item.wx}${item.dayVoid ? '在' : '不在'}日旬空${dayKong.join('')}内${item.dayVoid ? '；仅标旬空，效力及出空须另审' : ''}。`,
      { lineId: item.lineId, subjectId: item.id, source: item.source, dayVoid: item.dayVoid, dayKong });
  }

  for (const line of lines) {
    const flags = [line.move ? '动爻' : '静爻', line.shi ? '世爻' : '', line.ying ? '应爻' : ''].filter(Boolean);
    add(`${line.id}.IDENTITY`, 'identity', `${line.id} ${line.name}：${line.relative}${line.gan}${line.zhi}${line.wx}，${flags.join('、')}${line.liushen ? `，六神${line.liushen}` : ''}；六亲以本卦${mainInfo.palace}宫${mainInfo.palaceWX}为基准。`,
      { lineId: line.id, source: 'main', pos: line.pos, yang: line.yang, gan: line.gan, zhi: line.zhi, wx: line.wx,
        relative: line.relative, move: line.move, shi: line.shi, ying: line.ying });
    addCalendarFacts(line, line.id, `${line.id}本爻`);
    if (line.changed) {
      const changed = line.changed;
      const relation = elementRelation(line.wx, changed.wx);
      const reverseRelation = elementRelation(changed.wx, line.wx);
      const branches = branchRelation(line.zhi, changed.zhi);
      const progress = progression(line.zhi, changed.zhi);
      const back = reverseRelation === 'generates' ? '化爻回头生本爻'
        : reverseRelation === 'overcomes' ? '化爻回头克本爻'
          : relation === 'same' ? '本化同五行比和'
            : `${relationText('本爻', '化爻', relation)}（仅五行方向，不作为本爻能作用化爻的断语）`;
      const progressText = progress === 'advance' ? '；化进神（七组约定，非自动吉）'
        : progress === 'retreat' ? '；化退神（七组约定，非自动凶）'
          : progress === 'disputed' ? '；戌丑循环进退有版本分歧，本引擎不自动认定' : '；无已采用的进退神配对';
      add(`${line.id}.CHANGE`, 'change', `${line.id} ${line.name}本爻${line.relative}${line.gan}${line.zhi}${line.wx} → 本位化爻${changed.relative}${changed.gan}${changed.zhi}${changed.wx}；${back}；本化地支${BRANCH_LABELS[branches]}${progressText}。回头作用实际效力仍须核月日、空破。`,
        { lineId: line.id, from: line.id, to: changed.id, changedId: changed.id, source: 'changed',
          elementRelation: relation, reverseElementRelation: reverseRelation, branchRelation: branches,
          progression: progress, changedRelative: changed.relative, changedZhi: changed.zhi, changedWX: changed.wx,
          activeEffect: null, conditional: true });
      addCalendarFacts(changed, `${line.id}.C`, `${line.id}本位化爻`);
    }
    if (line.hidden) {
      const hidden = line.hidden;
      const relation = elementRelation(line.wx, hidden.wx);
      const branches = branchRelation(line.zhi, hidden.zhi);
      add(`${line.id}.HIDDEN`, 'hidden', `${line.id}之下伏神${hidden.relative}${hidden.gan}${hidden.zhi}${hidden.wx}，飞神为本爻${line.relative}${line.gan}${line.zhi}${line.wx}；${relationText('飞神', '伏神', relation)}，地支${BRANCH_LABELS[branches]}。只记飞伏结构，伏神能否出伏、发挥作用须审月日、空破及飞神状态。`,
        { lineId: line.id, subjectId: hidden.id, source: 'hidden', relative: hidden.relative, gan: hidden.gan,
          zhi: hidden.zhi, wx: hidden.wx, from: line.id, to: hidden.id, elementRelation: relation,
          reverseElementRelation: elementRelation(hidden.wx, line.wx), branchRelation: branches, activeEffect: null, conditional: true });
      addCalendarFacts(hidden, `${line.id}.F`, `${line.id}伏神`);
    }
  }

  const shiYingElement = elementRelation(shi.wx, ying.wx);
  const shiYingBranches = branchRelation(shi.zhi, ying.zhi);
  add('SHI_YING', 'shi_ying', `世爻${shi.id} ${shi.name}${shi.zhi}${shi.wx}，应爻${ying.id} ${ying.name}${ying.zhi}${ying.wx}；${relationText('世爻', '应爻', shiYingElement)}；世应地支${BRANCH_LABELS[shiYingBranches]}。五行生克与地支冲合分别记录、不能互相替代；世应人物含义与效力仍按所问核定。`,
    { from: shi.id, to: ying.id, shiId: shi.id, yingId: ying.id, elementRelation: shiYingElement,
      reverseElementRelation: elementRelation(ying.wx, shi.wx), branchRelation: shiYingBranches, activeEffect: null, conditional: true });
  // Fifteen unordered main-line pairs, with explicit ordered element direction.
  // Static-to-static is not declared active; movers also require efficacy checks.
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const from = lines[i];
      const to = lines[j];
      const relation = elementRelation(from.wx, to.wx);
      const branches = branchRelation(from.zhi, to.zhi);
      add(`${from.id}_${to.id}`, 'pair', `${from.id}${from.zhi}${from.wx}与${to.id}${to.zhi}${to.wx}：${relationText(from.id, to.id, relation)}；地支${BRANCH_LABELS[branches]}；${from.move || to.move ? '含动爻，实际作用待核月日、空破与化爻' : '两爻皆静，未断定存在有效相互作用'}。`,
        { from: from.id, to: to.id, elementRelation: relation, reverseElementRelation: elementRelation(to.wx, from.wx),
          branchRelation: branches, fromMoving: from.move, toMoving: to.move,
          activeEffect: null, conditional: true });
    }
  }
  return { version: VERSION, question: typeof input.question === 'string' ? input.question.slice(0, 300) : '',
    facts, lines, candidates, month, day, dayKong,
    movingLineIds, shiId: shi.id, yingId: ying.id, questionCategory };
}

module.exports = { buildRuleFacts, elementRelation, branchRelation, lineName };
