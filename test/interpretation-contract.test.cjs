'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProfessional, parsePlain, parseDraft, parseReview, renderInterpretation, qualityError } = require('../src/interpretation-contract');

function fixture() {
  const factsBundle = {
    facts: [
      { id: 'L1.IDENTITY', kind: 'IDENTITY', lineId: 'L1', text: '初爻子孙乙卯木，静爻。' },
      { id: 'L2.IDENTITY', kind: 'IDENTITY', lineId: 'L2', text: '二爻妻财乙巳火，动爻，应爻。' },
      { id: 'L3.IDENTITY', kind: 'IDENTITY', lineId: 'L3', text: '三爻兄弟乙未土，静爻。' },
      { id: 'L2.MONTH', kind: 'MONTH', lineId: 'L2', text: '巳火得卯木月建相生，不构成月破。' },
      { id: 'L2.DAY', kind: 'DAY', lineId: 'L2', text: '午火日辰与巳火五行比和。' },
      { id: 'L2.VOID', kind: 'VOID', lineId: 'L2', text: '巳火不在日旬空申酉内。' },
      { id: 'L3.MONTH', kind: 'MONTH', lineId: 'L3', text: '未土与卯木月建五行关系为木克土。' },
      { id: 'L3.DAY', kind: 'DAY', lineId: 'L3', text: '午火日辰生未土。' },
      { id: 'L3.VOID', kind: 'VOID', lineId: 'L3', text: '未土不在日旬空申酉内。' },
      { id: 'L4.F.MONTH', kind: 'MONTH', lineId: 'L4', text: '伏神亥水与卯木月建五行关系为水生木。' },
      { id: 'L4.F.DAY', kind: 'DAY', lineId: 'L4', text: '伏神亥水与午火日辰五行关系为水克火。' },
      { id: 'L4.F.VOID', kind: 'VOID', lineId: 'L4', text: '伏神亥水不在日旬空申酉内。' },
      { id: 'L2.CHANGE', kind: 'CHANGE', lineId: 'L2', text: '二爻妻财乙巳火化子孙庚寅木，化爻木回头生本爻火。' },
      { id: 'L5.CHANGE', kind: 'CHANGE', lineId: 'L5', text: '五爻子孙庚申金化兄弟壬戌土，化爻土回头生本爻金。' },
      { id: 'SHI_YING', kind: 'SHI_YING', branchRelation: 'harmony', text: '世爻辰土生应爻酉金，地支辰酉六合；生合不是克。' },
      { id: 'L4.HIDDEN', kind: 'HIDDEN', lineId: 'L4', text: '四爻下伏神父母乙亥水。' }
    ],
    candidates: [
      { id: 'L1', lineId: 'L1', relative: '子孙', source: 'main', factId: 'L1.IDENTITY' },
      { id: 'L2', lineId: 'L2', relative: '妻财', source: 'main', factId: 'L2.IDENTITY' },
      { id: 'L3', lineId: 'L3', relative: '兄弟', source: 'main', factId: 'L3.IDENTITY' },
      { id: 'L4.F', lineId: 'L4', relative: '父母', source: 'hidden', factId: 'L4.HIDDEN' }
    ],
    movingLineIds: ['L2', 'L5'], shiId: 'L5', yingId: 'L2',
    questionCategory: { id: 'lost', label: '失物', ambiguous: false, matchedCategories: ['lost'], suggestedRelatives: ['妻财'] }
  };
  const draft = {
    schema_version: '1',
    useful: { candidate_id: 'L2', reason: '以财物之问选妻财为主要观察对象，另核对世应关系。', evidence: ['L2.IDENTITY'] },
    analysis: [
      { evidence: ['L2.MONTH', 'L2.DAY', 'L2.VOID', 'L2.CHANGE'], interpretation: '所选用神有相生支持，但不能把生助直接视为现实中已找回。' },
      { evidence: ['L5.CHANGE', 'SHI_YING'], interpretation: '世应生合与另一动爻的生助可作为联系尚存的线索，不等于没有被偷。' }
    ],
    conclusion: { tendency: 'mixed', text: '有继续寻找的支持，同时不足以确定现实结果。', evidence: ['L2.CHANGE', 'SHI_YING'] },
    plain: {
      answer: '仍值得继续寻找，但能否找回还不能确定。',
      reasons: [{ text: '有利线索与未知因素并存，不能只凭这次解读判断物品的真实状况。', evidence: ['L2.CHANGE', 'SHI_YING'] }],
      advice: ['先回顾最近使用和保管物品的经过，再核实常去地点。'],
      limitations: '这只是传统文化解读，不是事实认定；应以实际寻找和核实为准。'
    }
  };
  return { factsBundle, draft };
}

function rejects(change, issue) {
  const { factsBundle, draft } = fixture();
  change(draft, factsBundle);
  assert.throws(() => parseDraft(draft, factsBundle), error => {
    assert.equal(error.code, 'AI_QUALITY_ERROR');
    assert.equal(error.status, 502);
    if (issue) assert.match(error.issues.join(' '), issue);
    return true;
  });
}

test('accepts a grounded-shaped draft as JSON, without claiming semantic approval', () => {
  const { factsBundle, draft } = fixture();
  assert.deepEqual(parseDraft(JSON.stringify(draft), factsBundle), draft);
  assert.deepEqual(parseDraft('```json\n' + JSON.stringify(draft) + '\n```', factsBundle), draft);
});

test('professional phase accepts exactly four keys and ignores only an existing plain fixture', () => {
  const { factsBundle, draft } = fixture();
  const { plain, ...professional } = draft;
  assert.deepEqual(parseProfessional(JSON.stringify(professional), factsBundle), professional);
  assert.deepEqual(parseProfessional(draft, factsBundle), professional);
  assert.deepEqual(parseProfessional({ ...professional, plain: { answer: '用神肯定能找回' } }, factsBundle), professional);
  assert.throws(() => parseProfessional({ ...professional, extra: '不能忽略' }, factsBundle), { code: 'AI_QUALITY_ERROR' });
  assert.throws(() => parseProfessional({ ...professional, plain, extra: '不能忽略' }, factsBundle), { code: 'AI_QUALITY_ERROR' });
  assert.ok(!Object.hasOwn(parseProfessional(professional, factsBundle), 'plain'));
});

test('professional phase turns valid JSON primitives and arrays into quality errors', () => {
  const { factsBundle } = fixture();
  for (const raw of ['null', '[]', '1', 'false', '"text"']) {
    assert.throws(() => parseProfessional(raw, factsBundle), error => error.code === 'AI_QUALITY_ERROR' && error.status === 502);
  }
});

test('professional phase retains evidence coverage, candidate, relation and claim gates', () => {
  const changes = [
    draft => { draft.schema_version = '2'; },
    draft => { draft.useful.candidate_id = 'L2.C'; },
    draft => { draft.useful.evidence = ['L1.IDENTITY']; },
    draft => { draft.analysis[0].evidence = draft.analysis[0].evidence.filter(id => id !== 'L2.VOID'); },
    draft => { draft.analysis[1].evidence = ['SHI_YING']; },
    draft => { draft.analysis[1].evidence = ['L5.CHANGE']; },
    draft => { draft.conclusion.evidence.push('L3.IDENTITY'); },
    draft => { draft.analysis[1].interpretation = '世应无冲无合。'; },
    draft => { draft.conclusion.text = '一定能找回。'; },
    draft => { draft.conclusion.tendency = 'uncertain'; draft.conclusion.text = '继续寻找即可。'; }
  ];
  for (const change of changes) {
    const { factsBundle, draft } = fixture();
    change(draft);
    assert.throws(() => parseProfessional(draft, factsBundle), { code: 'AI_QUALITY_ERROR' });
  }
});

test('professional validation scaffold is discarded and cannot be rendered as fallback', () => {
  const { factsBundle, draft } = fixture();
  const professional = parseProfessional(draft, factsBundle);
  assert.doesNotMatch(JSON.stringify(professional), /内部结构校验|内部校验占位/);
  assert.throws(() => renderInterpretation(professional, factsBundle), { code: 'AI_QUALITY_ERROR' });
});

test('plain phase enforces exact shape, bounds and complete fields without inventing text', () => {
  const { draft } = fixture();
  assert.deepEqual(parsePlain(JSON.stringify(draft.plain)), draft.plain);
  for (const change of [
    plain => { plain.extra = '拒绝额外字段'; },
    plain => { delete plain.limitations; },
    plain => { plain.answer = ''; },
    plain => { plain.reasons = []; },
    plain => { plain.reasons[0].evidence = []; },
    plain => { plain.reasons[0].evidence = [null]; },
    plain => { plain.advice = new Array(6).fill('请核实。'); },
    plain => { plain.limitations = '字'.repeat(701); }
  ]) {
    const plain = structuredClone(draft.plain);
    change(plain);
    assert.throws(() => parsePlain(plain), { code: 'AI_QUALITY_ERROR' });
  }
});

test('final combined gate still rejects jargon, unknown references and added plain evidence', () => {
  for (const change of [
    plain => { plain.answer = '用神有支持，结果不能确定。'; },
    plain => { plain.reasons[0].evidence.push('L2.NO_SUCH_FACT'); },
    plain => { plain.reasons[0].evidence.push('L3.IDENTITY'); },
    plain => { plain.answer = '手机肯定未被拿走。'; }
  ]) {
    const { factsBundle, draft } = fixture();
    const professional = parseProfessional(draft, factsBundle);
    change(draft.plain);
    const plain = parsePlain(draft.plain);
    assert.throws(() => parseDraft({ ...professional, plain }, factsBundle), { code: 'AI_QUALITY_ERROR' });
  }
  const { factsBundle, draft } = fixture();
  const combined = { ...parseProfessional(draft, factsBundle), plain: parsePlain(draft.plain) };
  assert.deepEqual(parseDraft(combined, factsBundle), draft);
});

test('renderer leads with the judgment and keeps evidence IDs and the complete facts packet internal', () => {
  const { factsBundle, draft } = fixture();
  const before = JSON.stringify({ factsBundle, draft });
  const output = renderInterpretation(draft, factsBundle);
  assert.ok(output.startsWith('一、专业分析\n\n'));
  const [professional, plain] = output.split('二、通俗解读');
  assert.ok(professional.includes(draft.conclusion.text));
  assert.ok(professional.indexOf(draft.conclusion.text) < professional.indexOf('用神与依据'));
  assert.ok(professional.includes(draft.analysis[0].interpretation));
  assert.ok(professional.includes(draft.analysis[1].interpretation));
  assert.doesNotMatch(output, /\bL[1-6](?:\.[A-Z_]+)*\b|SHI_YING|\.MONTH|\.DAY|\.VOID|candidate_id|schema_version/);
  assert.doesNotMatch(professional, /代码核定事实|以下事实原文|（依据：/);
  assert.match(professional, /选用用神：本卦候选 二爻（妻财）/);
  assert.doesNotMatch(plain, /爻|月建|日辰|用神|世应|旬空|回头生|月破|干支|SHI_YING|L2/);
  assert.ok(plain.includes(draft.plain.answer));
  assert.equal(JSON.stringify({ factsBundle, draft }), before, 'presentation must not mutate the validated evidence or draft');
  assert.equal(draft.analysis[1].evidence[1], 'SHI_YING');
  assert.equal(factsBundle.facts.find(fact => fact.id === 'SHI_YING').branchRelation, 'harmony');
});

test('deduplicates verbatim factual text even when evidence is reused', () => {
  const { factsBundle, draft } = fixture();
  draft.analysis[0].evidence.push('L2.IDENTITY');
  draft.conclusion.evidence.push('L2.IDENTITY');
  const output = renderInterpretation(draft, factsBundle);
  assert.equal(output.split(factsBundle.facts[1].text).length - 1, 1);
});

test('allows actual hidden candidate with its HIDDEN identity fact', () => {
  const { factsBundle, draft } = fixture();
  draft.useful = { candidate_id: 'L4.F', reason: '以实际伏神候选作为辅助判断对象，仍有选择歧义。', evidence: ['L4.HIDDEN'] };
  draft.analysis[0].evidence.push('L4.F.MONTH', 'L4.F.DAY', 'L4.F.VOID');
  assert.equal(parseDraft(draft, factsBundle).useful.candidate_id, 'L4.F');
  assert.match(renderInterpretation(draft, factsBundle), /选用用神：伏神候选 四爻伏神（父母）/);
});

test('renderer cleans references in the useful reason, identity and analysis prose as well as reference wrappers', () => {
  const { factsBundle, draft } = fixture();
  factsBundle.facts.find(fact => fact.id === 'L2.IDENTITY').text = '用神L2妻财乙巳火，动爻、应爻。';
  draft.useful.reason = '以L2妻财为主用神，结合SHI_YING核对，不将符号当作已发生的事实。';
  draft.analysis[0].interpretation = 'L2.MONTH、L2.DAY显示支持条件，L2.VOID仍须一起核对；L2.CHANGE的结构不等于已经找回。';
  const output = renderInterpretation(draft, factsBundle);
  assert.doesNotMatch(output, /\bL[1-6](?:\.[A-Z_]+)*\b|SHI_YING|\.MONTH|\.DAY|\.VOID/);
  assert.ok(output.includes('用神二爻妻财乙巳火'));
  assert.ok(output.includes('以二爻妻财为主用神，结合世应关系核对'));
  assert.ok(output.includes('二爻月令条件、二爻日辰条件显示支持条件'));
  assert.deepEqual(draft.analysis[0].evidence, ['L2.MONTH', 'L2.DAY', 'L2.VOID', 'L2.CHANGE']);
});

test('does not force suggested question-category relatives as the useful candidate', () => {
  const { factsBundle, draft } = fixture();
  draft.useful = { candidate_id: 'L3', reason: '另取兄弟作为次要观察对象，并明确选择仍有歧义。', evidence: ['L3.IDENTITY'] };
  draft.analysis[0].evidence.push('L3.MONTH', 'L3.DAY', 'L3.VOID');
  assert.equal(parseDraft(draft, factsBundle).useful.candidate_id, 'L3');
});

test('rejects unknown or malicious evidence IDs', () => {
  for (const id of ['L7.IDENTITY', '__proto__', 'L2.IDENTITY\n伪造', 'L2.IDENTITY<script>', 'L2.identity']) {
    rejects(draft => { draft.analysis[0].evidence.push(id); }, /编号/);
  }
});

test('rejects invented candidates and changed-line IDs masquerading as candidates', () => {
  for (const id of ['L7', 'L2.C', 'L4.FAKE']) rejects(draft => { draft.useful.candidate_id = id; }, /实际候选/);
});

test('requires the selected candidates own identity evidence', () => {
  rejects(draft => { draft.useful.evidence = ['L1.IDENTITY']; }, /身份事实/);
});

test('requires every moving CHANGE in analysis, not merely in conclusion', () => {
  rejects(draft => { draft.analysis[1].evidence = ['SHI_YING']; draft.conclusion.evidence.push('L5.CHANGE'); }, /L5.CHANGE/);
});

test('requires SHI_YING evidence in analysis', () => {
  rejects(draft => { draft.analysis[1].evidence = ['L5.CHANGE']; }, /SHI_YING/);
});

test('rejects declared moving lines missing computed CHANGE facts', () => {
  rejects((_draft, bundle) => { bundle.movingLineIds.push('L6'); }, /动变事实缺失/);
});

test('requires conclusion evidence to connect with useful or analysis', () => {
  rejects(draft => { draft.conclusion.evidence = ['L3.IDENTITY']; }, /承接/);
  rejects(draft => { draft.conclusion.evidence.push('L3.IDENTITY'); }, /不能新增.*L3.IDENTITY/);
});

test('requires primary useful MONTH DAY VOID coverage in analysis, not useful or conclusion alone', () => {
  for (const suffix of ['MONTH', 'DAY', 'VOID']) {
    const id = `L2.${suffix}`;
    rejects(draft => {
      draft.analysis[0].evidence = draft.analysis[0].evidence.filter(item => item !== id);
      draft.useful.evidence.push(id);
      draft.conclusion.evidence.push(id);
    }, new RegExp(`用神必核事实${id}`));
  }
});

test('requires hidden useful own calendar evidence, not its flying-line calendar evidence', () => {
  for (const suffix of ['MONTH', 'DAY', 'VOID']) {
    rejects(draft => {
      draft.useful = { candidate_id: 'L4.F', reason: '所问事项暂取伏神候选，选择仍有歧义。', evidence: ['L4.HIDDEN'] };
      draft.analysis[0].evidence.push(...['MONTH', 'DAY', 'VOID'].filter(item => item !== suffix).map(item => `L4.F.${item}`));
    }, new RegExp(`L4.F.${suffix}`));
  }
});

test('permits no advice when the evidence does not justify a suggestion', () => {
  const { factsBundle, draft } = fixture();
  draft.plain.advice = [];
  assert.deepEqual(parseDraft(draft, factsBundle).plain.advice, []);
  assert.ok(renderInterpretation(draft, factsBundle).includes(draft.plain.limitations));
});

test('rejects new plain-language references even if the fact exists', () => {
  rejects(draft => { draft.plain.reasons[0].evidence.push('L3.IDENTITY'); }, /不得增加/);
});

test('rejects jargon anywhere in the plain-language section', () => {
  for (const word of ['爻', '月建', '日辰', '用神', '世应', '旬空', '回头生', '月破', '干支', '甲辰', 'L2.MONTH']) {
    rejects(draft => { draft.plain.advice[0] = `请观察${word}。`; }, /专业术语/);
  }
});

test('rejects ungrounded probabilities and absolute factual assertions', () => {
  for (const claim of ['大概率可以找回', '找回的可能为百分之八十', '有80%的希望', '一定能找到', '肯定没有被偷', '必然找回', '没有被偷', '没被拿走', '未被偷', '未被拿走', '明天会找到', '三天后会找回', '东西就在床头柜第三个抽屉里', '手机可能在卧室的抽屉里']) {
    rejects(draft => { draft.plain.answer = claim; }, /断言|概率/);
  }
});

test('certainty guard is clause-local and does not exempt a claim after a negated clause', () => {
  rejects(draft => { draft.plain.answer = '无法确认目前情况，但肯定可以找回。'; }, /绝对断言/);
  rejects(draft => { draft.plain.answer = '无法确认目前情况但肯定可以找回。'; }, /绝对断言/);
  rejects(draft => { draft.plain.limitations = '本解读不表示手机已在某处，但是肯定未被拿走。'; }, /绝对断言/);
  rejects(draft => { draft.plain.limitations = '本解读不表示手机已在某处，肯定未被拿走。'; }, /绝对断言/);
  rejects(draft => { draft.plain.limitations = '不能确定目前情况，未被拿走。'; }, /绝对断言/);
  rejects(draft => { draft.plain.limitations = '本解读不表示手机已在某处，因此未被拿走。'; }, /绝对断言/);
  rejects(draft => { draft.analysis[0].interpretation = '这不表示手机没有被偷，未被拿走已经是核实后的事实。'; }, /绝对断言/);
  rejects(draft => { draft.plain.limitations = '这不表示手机没有被偷，未被拿走是事实。'; }, /绝对断言/);
  rejects(draft => { draft.plain.limitations = '这不表示手机没有被偷，未被拿走或未被偷已经证实。'; }, /绝对断言/);
  rejects(draft => { draft.plain.answer = '不要急，但肯定能找到。'; }, /绝对断言/);
  rejects(draft => { draft.plain.answer = '勿放弃，因此一定能找回。'; }, /绝对断言/);
  rejects(draft => { draft.plain.answer = '别急，肯定能找到。'; }, /绝对断言/);
  rejects(draft => { draft.plain.answer = '这次判断特别肯定，必然能找到。'; }, /绝对断言/);
});

test('accepts explicit imperative disclaimers from the real release trace', () => {
  for (const advice of [
    '如果手机有定位或查找功能，可以借助它核实大致范围，但不要把它当成必然能找到的保证。',
    '不要将这次解读理解为必然能找回。',
    '勿将这次解读视为肯定能找到的保证。',
    '别把这次解读当作一定能找回的保证。',
    '不把这次解读当成必然会发生的事。',
    '不应理解为一定能找回。'
  ]) {
    const { factsBundle, draft } = fixture();
    draft.plain.advice = [advice];
    assert.equal(parseDraft(draft, factsBundle).plain.advice[0], advice);
  }
  rejects(draft => { draft.plain.answer = '这次判断特别肯定能找到。'; }, /绝对断言/);
});

test('accepts explicit whole-sentence negated factual enumeration', () => {
  for (const limitations of [
    '本解读不表示手机已在某处、未被拿走或由谁持有。',
    '本解读不表示手机已在某处，未被拿走或由谁持有。',
    '本解读不意味着已经找到物品，或未被偷。',
    '本解读不意味着已经找到物品，或未被偷走。',
    '不能据此认定手机已在某处，未被拿走或由谁持有。'
  ]) {
    const { factsBundle, draft } = fixture();
    draft.plain.limitations = limitations;
    assert.equal(parseDraft(draft, factsBundle).plain.limitations, limitations);
  }
});

test('internal diagnostics identify the precise jargon, reference and unsupported value', () => {
  rejects(draft => { draft.plain.reasons[0].text = '世爻还有支持。'; }, /plain.reasons\[0\].text.*“世爻”/);
  rejects(draft => { draft.analysis[0].evidence.push('L2.NO_SUCH_FACT'); }, /analysis\[0\].evidence.*未知.*“L2.NO_SUCH_FACT”/);
  rejects(draft => { draft.analysis[0].evidence.push('L2.MONTH'); }, /重复.*“L2.MONTH”/);
  rejects(draft => { draft.plain.reasons[0].text = '物品损失价值为500元。'; }, /“500元”/);
});

test('accepts lowercase fact kinds emitted by the rule facts module', () => {
  const { factsBundle, draft } = fixture();
  factsBundle.facts.forEach(fact => { fact.kind = fact.kind.toLowerCase(); });
  assert.equal(parseDraft(draft, factsBundle).useful.candidate_id, 'L2');
});

test('rejects the known 辰酉 regression and other claims contrary to branch metadata', () => {
  for (const claim of ['世应无冲无合。', '世应无合。', '世爻与应爻不相合。', '世应没有合。', '世应六冲。']) {
    rejects(draft => { draft.analysis[1].interpretation = claim; }, /世应/);
  }
  for (const relation of ['none', 'clash', 'same']) {
    rejects((draft, bundle) => { bundle.facts.find(fact => fact.id === 'SHI_YING').branchRelation = relation; draft.analysis[1].interpretation = '世应相合，可作为联系线索。'; }, /世应六合/);
  }
  rejects((draft, bundle) => { bundle.facts.find(fact => fact.id === 'SHI_YING').branchRelation = 'clash'; draft.analysis[1].interpretation = '世应无冲。'; }, /世应六冲/);
});

test('harmony does not require a clash and absence claims are not positive claims', () => {
  const { factsBundle, draft } = fixture();
  draft.analysis[1].interpretation = '世应无冲，世应六合只作关系线索，不保证现实结果。';
  assert.equal(parseDraft(draft, factsBundle).analysis[1].interpretation, draft.analysis[1].interpretation);
  draft.analysis[1].interpretation = '世应没有合化，合化效力仍须另审。';
  assert.equal(parseDraft(draft, factsBundle).analysis[1].interpretation, draft.analysis[1].interpretation);
  factsBundle.facts.find(fact => fact.id === 'SHI_YING').branchRelation = 'none';
  draft.analysis[1].interpretation = '世应不相合，也无冲；不能由此判断现实状况。';
  assert.equal(parseDraft(draft, factsBundle).analysis[1].interpretation, draft.analysis[1].interpretation);
  draft.analysis[1].interpretation = '不能认定世应六合，不宜把关系线索当作事实。';
  assert.equal(parseDraft(draft, factsBundle).analysis[1].interpretation, draft.analysis[1].interpretation);
});

test('permits uncertainty disclaimers and ordinary actionable numbers', () => {
  const { factsBundle, draft } = fixture();
  draft.plain.answer = '不能肯定能找回，也不能判断有没有被偷。';
  draft.plain.advice = ['分2次核实常去地点，保留联系电话。'];
  assert.equal(parseDraft(draft, factsBundle).plain.advice[0], draft.plain.advice[0]);
  draft.plain.reasons[0].text = '仍有一点支持，但实际进展还需要核实。';
  assert.equal(parseDraft(draft, factsBundle).plain.reasons[0].text, draft.plain.reasons[0].text);
});

test('rejects new factual amounts or time values in the plain answer', () => {
  rejects(draft => { draft.plain.reasons[0].text = '损失约500元，情况仍不确定。'; }, /新增/);
  rejects(draft => { draft.plain.reasons[0].text = '损失约五百元，情况仍不确定。'; }, /新增/);
  rejects(draft => { draft.plain.answer = '仍值得寻找，本周暂时无法确认结果。'; }, /新增/);
  rejects(draft => { draft.plain.reasons[0].text = '记录显示下午一点还在原处。'; }, /“一点”/);
});

test('uncertain tendency must remain explicitly uncertain in both conclusions', () => {
  rejects(draft => { draft.conclusion.tendency = 'uncertain'; draft.conclusion.text = '有继续寻找的支持。'; }, /不确定结论/);
  rejects(draft => { draft.conclusion.tendency = 'uncertain'; draft.conclusion.text = '现有证据不足，无法判断。'; draft.plain.answer = '继续寻找即可。'; }, /不确定结论/);
  const { factsBundle, draft } = fixture();
  draft.conclusion.tendency = 'uncertain';
  draft.conclusion.text = '现有证据不足，无法判断。';
  assert.equal(parseDraft(draft, factsBundle).conclusion.tendency, 'uncertain');
});

test('recognizes definite inability-to-determine wording seen in real professional traces', () => {
  for (const conclusion of [
    '寻获时间无法从本卦可靠推定，宜结合现实记录进一步核实。',
    '所问类别不明确，无法唯一确定用神；现有卦盘未提供足够依据判断具体方位、是否被拿走或能否找到。',
    '无法直接判断具体方位，请用现实线索核实。',
    '目前无法给出可靠的找到时间。',
    '因此不能给出确定性的方位或结论。',
    '现有条件不足以可靠推定最后结果。'
  ]) {
    const { factsBundle, draft } = fixture();
    draft.conclusion.tendency = 'uncertain';
    draft.conclusion.text = conclusion;
    draft.plain.answer = '目前无法给出可靠的找到时间，也不能据此确定真实位置。';
    assert.equal(parseProfessional(draft, factsBundle).conclusion.text, conclusion);
    assert.equal(parseDraft(draft, factsBundle).plain.answer, draft.plain.answer);
  }
});

test('mere possibility or unrelated inability is not enough for uncertain conclusions', () => {
  for (const conclusion of ['可能找得到。', '也许可以找回。', '继续找还有希望。', '找到手机后无法联系工作人员。']) {
    rejects(draft => { draft.conclusion.tendency = 'uncertain'; draft.conclusion.text = conclusion; }, /不确定结论/);
  }
  rejects(draft => { draft.conclusion.tendency = 'uncertain'; draft.conclusion.text = '无法给出可靠的结果判断。'; draft.plain.answer = '可能找得到。'; }, /不确定结论/);
});

test('enforces exact shapes, nonempty fields and bounded arrays/text', () => {
  rejects(draft => { draft.hallucinated_location = '床下'; }, /字段/);
  rejects(draft => { draft.plain.answer = ''; }, /文本/);
  rejects(draft => { draft.analysis = []; }, /数组/);
  rejects(draft => { draft.plain.answer = '字'.repeat(701); }, /过长/);
  rejects(draft => { draft.schema_version = 1; }, /schema_version/);
  rejects(draft => { draft.conclusion.tendency = 'guaranteed'; }, /tendency/);
  rejects(draft => { draft.analysis[0].evidence.push('L2.MONTH'); }, /重复/);
  rejects(draft => { draft.plain.answer = '结果如下\u0000'; }, /控制字符/);
  rejects(draft => { draft.plain.answer = '二、通俗解读：仍值得寻找'; }, /主标题/);
});

test('rejects incomplete or commentary-surrounded JSON without exposing draft', () => {
  const { factsBundle, draft } = fixture();
  for (const raw of ['{"schema_version":"1"', '以下是结果：' + JSON.stringify(draft), JSON.stringify(draft) + '\n附注']) {
    assert.throws(() => parseDraft(raw, factsBundle), error => error.code === 'AI_QUALITY_ERROR' && !error.message.includes(raw));
  }
});

test('review parser only permits consistent pass/revise outcomes', () => {
  assert.deepEqual(parseReview('{"verdict":"pass","issues":[]}'), { verdict: 'pass', issues: [] });
  assert.deepEqual(parseReview({ verdict: 'revise', issues: ['世应关系推论与事实不符。'] }), { verdict: 'revise', issues: ['世应关系推论与事实不符。'] });
  assert.deepEqual(parseReview({ verdict: 'revise', issues: ['“二、通俗解读”中出现了新增事实。'] }), { verdict: 'revise', issues: ['“二、通俗解读”中出现了新增事实。'] });
  for (const review of [{ verdict: 'pass', issues: ['存在问题'] }, { verdict: 'revise', issues: [] }, { verdict: 'approve', issues: [] }, { verdict: 'pass', issues: [], answer: '额外正文' }]) {
    assert.throws(() => parseReview(review), { code: 'AI_QUALITY_ERROR' });
  }
});

test('quality error keeps public refund wording separate from internal diagnostics', () => {
  const error = qualityError('L2.CHANGE证据遗漏');
  assert.equal(error.message, '本次解读未通过卦象依据校验，请重试；本次不扣次数');
  assert.equal(error.status, 502);
  assert.deepEqual(error.issues, ['L2.CHANGE证据遗漏']);
});

// Complete visible plain text from the five incorrectly passing real cases in
// outputs/grounding-final-eval-v12.3.json. Citation IDs are remapped below solely
// to isolate the text guards from unrelated fixture-chart evidence differences.
const REAL_PLAIN_REGRESSIONS = [
  {
    id: 'lost-travel-harmony',
    answer: '从传统占测角度看，找回手机存在一些支持性条件，但现实线索和时间无法仅凭卦盘确定，不能保证一定能找到或给出具体日期。',
    reasons: [
      '卦象显示手机与你自己之间存在某种关联倾向，但你自己这一方状态偏弱，不能据此断定手机就在身边或很快出现。',
      '代表物品的线索在月份上得到一定支持，但当天方向偏消耗，加上变化后的支持力量本身也不强，所以整体只是有支持、不算强。',
      '卦中同类线索不止一处，说明可能有多条排查方向，但无法据此指定具体位置或判断哪条一定有效。'
    ],
    advice: [
      '先仔细回想最后一次使用手机的时间和地点，按行程逐段排查。',
      '检查常去场所的角落、车内、包袋夹层，并询问可能接触过的人。',
      '如果手机有定位功能，可尝试通过查找设备功能查看最后在线位置。',
      '必要时及时挂失账号、冻结支付并报警备案，减少后续风险。'
    ],
    limitations: '目前缺少手机最后出现的时间地点、是否开机或联网、有无定位记录等现实信息，因此无法判断具体何时、何处能找到，也不能确定是被谁拿走。',
    expected: /专业术语.*月份.*卦中/
  },
  {
    id: 'lost-static-void',
    answer: '仅从传统文化角度看，卦象对找回手机有一定支持迹象，但当前状态悬而未定，不能据此确定具体什么时候能找到。',
    reasons: [
      '代表所寻手机的那一项既受到压制，也得到一点助力，眼下还处于悬置状态，所以不能断定已经找到或肯定找不到。',
      '外部条件与自身位置之间有相生相合的结构，算是偏有利的参考，但两边都没有明显动作，所以不能保证手机一定会回到手里。',
      '另有一项力量较强且对自身位置形成压制，可视为潜在阻力，但不能因此断定手机已被别人拿走或转移。'
    ],
    advice: [
      '先回忆最后一次使用手机的时间和地点，按行程逐段核对。',
      '用其他设备尝试定位、拨打电话或查看账号的查找功能。',
      '询问可能接触过该场所的人，并检查常放物品的收纳处。'
    ],
    limitations: '目前缺少手机最后出现的时间地点、是否开机联网、是否开启定位等现实信息，因此无法确定具体何时、何处或由谁拿走。',
    expected: /专业术语.*代表所寻手机的那一项.*相生.*相合/
  },
  {
    id: 'lost-hidden-two-moving',
    answer: '仅从传统文化角度看，手机并非完全无迹可寻，但当前线索不够明朗，寻回过程可能伴随反复；无法据此判断具体方位或场所。',
    reasons: [
      '从传统角度看，代表所寻物品的那一项虽然不直接显现，但得到较强支持，结构上有重新出现的可能，不过不能因此断定手机已经在某个地方。',
      '外部线索层面出现空转和反复的迹象，与手机相关的信息或遮盖层面可能被压制，不容易直接显现。',
      '你在寻找过程中可能处于被动受制的位置，外部因素对自身形成压力，但克力是否有效仍须结合其他因素综合看待。'
    ],
    advice: [
      '可以尝试用手机定位功能查看最后在线位置。',
      '仔细回顾行程，回想最后一次使用手机的地点和时间。',
      '询问可能接触过的人，但不要认定卦象能证明他们一定知情。'
    ],
    limitations: '缺少手机最后出现的地点、时间以及丢失时的具体情形等现实信息，无法判断具体方位或场所，也不能确定手机被谁拿走或现在何处。',
    expected: /专业术语.*代表所寻物品的那一项.*克力/
  },
  {
    id: 'study-all-moving',
    answer: '未来一个月学习计划整体上是有基础但也会遇到干扰，建议以自己能掌控的内容为主线，对外部条件和考核节点留出弹性，并主动安排休息，不要把计划定得太死。',
    reasons: [
      '你目前对学习内容本身有较好的投入基础，计划不是凭空而来，有可以依靠的立足点。',
      '外部课业条件或现成材料容易受到现实事务牵扯，计划不宜完全依赖外部安排。',
      '督促或考核机制在月中可能松动或延后，同时休息调节的力量偏弱，容易偏向硬撑。'
    ],
    advice: [
      '把学习计划分成自己可独立完成的核心部分和依赖外部条件的部分，优先保证核心部分。',
      '给考核节点或自我检查留出缓冲时间，不要排得太满。',
      '主动安排短暂休息，不要等到撑不住才停。'
    ],
    limitations: '仅从传统文化角度看，这个计划偏有支持也偏有干扰，但现实执行还取决于你具体的学习内容、可用时间和外部要求，这些信息目前还不清楚。',
    expected: /具体时段预测.*月中/
  },
  {
    id: 'wealth-two-moving',
    answer: '从传统卦象角度看，你这门小生意求财，有利和不利因素同时存在：财路本身有一定基础，外部环境也有扶持的倾向，但目前还没到已经稳稳到手的地步；竞争分利、成本开销和事务性压力是比较明显的拖累。',
    reasons: [
      '你自身和经营所得这条线，在卦里得到月份和日子的同类支持，说明财源基础是有的；但它同时处在一种被冲又落空的状态，意味着眼下未必已经落实到位，不能只凭这一点就认为钱已经赚到了。',
      '客源、产品流通或外部环境这条线，结构上有向你的经营所得输送的倾向，算是利好；但它自身被月份和日子消耗，力量是否充足还要看现实条件，不能直接断定客源旺盛。',
      '竞争、分利或额外耗财这条线在卦里是动的，而且对你不利；虽然它变化之后可能带出财路，但结构上存在压制，只能算有条件的中性偏有利参考，不能直接断定竞争一定会变成赚钱。',
      '场地、手续、固定成本或管理事务这条线受到月份和日子的双重压制，是明显的不利因素；而且它变化之后容易进一步转成竞争或分利压力。它下面还藏着一层与监管、债务或外部约束有关的因素，虽然有一定力量，但能不能真正冒出来发挥作用，还需要另外判断，不能忽视。'
    ],
    advice: [
      '先理清固定成本、手续和场地相关的事务，看看哪些是必须支出、哪些可以压缩或延后。',
      '留意同行的竞争动作和利润被分薄的情况，别只看流水，要算实际到手的利润。',
      '客源和产品流通方面可以继续维护，但别把外部环境的支持当成已经确定的客源，还是要靠实际推广和回头客来验证。'
    ],
    limitations: '目前缺少你生意的具体类型、所在城市、启动资金、当前流水和主要成本结构等现实信息，所以无法判断这些有利和不利因素在你实际经营中各自占多大分量。',
    expected: /专业术语.*卦里.*月份和日子的同类支持.*月份和日子消耗/
  }
];

for (const real of REAL_PLAIN_REGRESSIONS) {
  test(`blocks the complete real plain leakage: ${real.id}`, () => {
    const { factsBundle, draft } = fixture();
    draft.conclusion.text = '所问范围为未来一个月，有支持也有阻力，现实结果仍无法确定。';
    draft.plain = {
      answer: real.answer,
      reasons: real.reasons.map(value => ({ text: value, evidence: ['L2.CHANGE', 'SHI_YING'] })),
      advice: real.advice,
      limitations: real.limitations
    };
    assert.throws(() => parseDraft(draft, factsBundle), error => {
      assert.equal(error.code, 'AI_QUALITY_ERROR');
      assert.match(error.issues.join(' '), real.expected);
      return true;
    });
  });
}

test('aggregates every plain jargon field and each distinct term into one repair diagnostic', () => {
  const { factsBundle, draft } = fixture();
  draft.plain.answer = '相生相合，但结果不能确定。';
  draft.plain.reasons[0].text = '卦里那一项得到月份和日子的同类支持。';
  draft.plain.advice = ['查看生扶与比扶。'];
  draft.plain.limitations = '月令与克力仍待判断。';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.throws(() => parseDraft(draft, factsBundle), error => {
      assert.equal(error.issues.length, 1);
      for (const word of ['plain.answer', '相生', '相合', 'plain.reasons[0].text', '卦里', '月份和日子的同类支持', 'plain.advice[0]', '生扶', '比扶', 'plain.limitations', '月令', '克力']) assert.ok(error.issues[0].includes(word), word);
      return true;
    });
  }
});

test('month/day vocabulary and named-period schedules remain allowed as modern advice', () => {
  const { factsBundle, draft } = fixture();
  draft.plain.advice = ['选择合适的日子整理材料，按你的空闲月份安排学习。', '计划月中复盘进度，安排下旬整理材料。', '建议在上旬检查进度，可能需要安排一次复盘。'];
  assert.deepEqual(parseDraft(draft, factsBundle).plain.advice, draft.plain.advice);
});

test('rejects unsupported named periods below and predictions even when repeated professionally', () => {
  for (const period of ['月初', '月中', '月末', '上旬', '中旬', '下旬']) {
    rejects(draft => { draft.plain.reasons[0].text = `${period}的情况已有记录，现实结果仍不确定。`; }, new RegExp(`新增.*${period}`));
    rejects(draft => { draft.analysis[0].interpretation = `考核机制在${period}可能松动或延后。`; draft.plain.reasons[0].text = `考核机制在${period}可能松动或延后。`; }, new RegExp(`analysis\\[0\\].interpretation.*具体时段预测.*${period}`));
  }
  rejects(draft => { draft.plain.advice = ['建议月中可能松动或延后，应当等待。']; }, /具体时段预测/);
  const { factsBundle, draft } = fixture();
  draft.analysis[0].interpretation = '不能确定月中是否出现实际变化，不给出具体时段预测。';
  draft.plain.reasons[0].text = '目前无法判断月中是否会有实际变化。';
  assert.equal(parseDraft(draft, factsBundle).plain.reasons[0].text, draft.plain.reasons[0].text);
});

test('rejects claiming an explicitly named lost object is unspecified', () => {
  for (const name of ['手机', '钱包', '钥匙', '证件', '耳机']) {
    for (const claim of ['所失之物未具体说明，用神暂定。', '缺少所失之物、最后见到的时间地点，暂难判断。', '目前未说明是什么东西。']) {
      rejects((draft, bundle) => { bundle.question = `我的${name}丢了，什么时候能找到？`; draft.useful.reason = claim; }, new RegExp(`已明确“${name}”`));
    }
  }
  rejects((draft, bundle) => { bundle.question = '我的手机丢了，怎么找？'; draft.plain.limitations = '所失之物未说明，需要补充是什么东西。'; }, /已明确“手机”/);
});

test('object identity checks allow missing details and skip absent or ambiguous questions', () => {
  for (const claim of ['还缺少所失之物的型号和品牌，实际结果需核实。', '缺少所失之物最后见到的时间地点，暂难判断。', '尚未提供物品的使用记录，不能确定结果。']) {
    const { factsBundle, draft } = fixture();
    factsBundle.question = '我的手机在哪里？';
    draft.useful.reason = claim;
    assert.equal(parseProfessional(draft, factsBundle).useful.reason, claim);
  }
  const { factsBundle, draft } = fixture();
  draft.useful.reason = '所失之物未具体说明，候选用神需暂定。';
  assert.equal(parseProfessional(draft, factsBundle).useful.reason, draft.useful.reason);
  factsBundle.question = '不清楚丢失的是不是手机，可能是手机或钱包。';
  assert.equal(parseProfessional(draft, factsBundle).useful.reason, draft.useful.reason);
});

test('blocks exact structural euphemisms observed in the verified real report', () => {
  for (const claim of [
    '卦象里代表手机的那部分在当月处于较有力的状态，说明线索本身还有存在的基础，但这不等于手机一定还在原处或很快出现。',
    '卦象中有一个变化因素对手机那部分形成支持，但这个支持力量被其他条件削弱，所以不能直接理解为手机会自动回到你身边。',
    '你与手机在卦象结构上有关联倾向，但你这一方偏安静、消耗较大，说明靠你主动回想和排查更现实。',
    '与钱财直接相关的核心位置得到了较强支撑，说明求财这件事本身有可依托的基础。',
    '这个核心位置本身带着不稳定和受冲击的迹象，所以不能只看支撑就认定钱财稳固。',
    '卦象里没有出现明确的推动信号，也没有给出具体时间线索，所以无法推断出找到的日期或时间段。'
  ]) {
    rejects(draft => { draft.plain.reasons[0].text = claim; }, /专业术语.*plain.reasons\[0\].text/);
  }
});

test('structural euphemism diagnostics still aggregate all affected plain fields', () => {
  const { factsBundle, draft } = fixture();
  draft.plain.answer = '与钱财相关的核心位置得到支撑，但结果仍不能确定。';
  draft.plain.reasons[0].text = '卦象中有一个变化因素对手机那部分形成支持，当月处于较有力的状态。';
  draft.plain.limitations = '卦象结构只能提供低确定性参考。';
  assert.throws(() => parseDraft(draft, factsBundle), error => {
    assert.equal(error.issues.length, 1);
    for (const word of ['plain.answer', '核心位置', 'plain.reasons[0].text', '变化因素', '当月', 'plain.limitations', '卦象结构']) assert.ok(error.issues[0].includes(word), word);
    return true;
  });
});

test('ordinary real-world core positions and physical-location checking advice are allowed', () => {
  const { factsBundle, draft } = fixture();
  draft.plain.advice = ['请检查店铺核心位置的收银台附近和真实收纳位置。', '可以把客户需求放在经营的核心位置，再核算实际成本。', '把钱财规划放在核心位置，先核算实际支出。', '请确认手机是否仍在原处，检查实际定位记录。'];
  assert.deepEqual(parseDraft(draft, factsBundle).plain.advice, draft.plain.advice);
});

test('rejects hedged static-symbol to real physical-state inference in professional and plain text', () => {
  for (const claim of [
    '提示物品可能处于相对静止、未被频繁移动的状态。',
    '手机或许没有移动。',
    '东西似乎仍在原处。',
    '它可能未被频繁移动。'
  ]) {
    rejects(draft => { draft.analysis[0].interpretation = claim; }, /物理状态/);
    rejects(draft => { draft.plain.reasons[0].text = claim; }, /物理状态/);
  }
});

test('allows explicit physical-state uncertainty and real verification requests', () => {
  const { factsBundle, draft } = fixture();
  draft.analysis[0].interpretation = '不能将静态象征理解为手机静止；无法判断物品是否未被频繁移动。';
  draft.plain.reasons[0].text = '不能判断物品是否未被移动，也不能确认手机仍在原处。';
  draft.plain.advice = ['请检查手机是否没有移动，并确认定位记录。', '可以确认东西是不是仍在原处，以现场检查为准。'];
  assert.deepEqual(parseDraft(draft, factsBundle).plain.advice, draft.plain.advice);
  rejects(draft => { draft.analysis[0].interpretation = '不能确认位置，但物品可能处于静止状态。'; }, /物理状态/);
});

test('rejects hidden-symbol to actual concealed-location assertions from the final live audit', () => {
  for (const claim of [
    '但伏藏本身说明不在显处。',
    '从传统角度看，但它不在明显的地方，需要靠回忆和实际搜索来确认。',
    '物品可能不在明处。',
    '手机似乎处于实际隐蔽处。',
    '所失之物或许在不显眼的位置。'
  ]) {
    rejects(draft => { draft.analysis[0].interpretation = claim; }, /实际隐蔽位置/);
    rejects(draft => { draft.plain.reasons[0].text = claim; }, /实际隐蔽位置/);
  }
});

test('hidden-location guard allows explicit uncertainty, technical hiding and real search advice', () => {
  const { factsBundle, draft } = fixture();
  draft.analysis[0].interpretation = '伏神不现于本卦明爻，只记录技术结构；不等于手机不在明显地方，不能证明物品位于隐蔽处。';
  draft.plain.reasons[0].text = '无法确认手机不在明显地方，也不能证明它位于隐蔽处。';
  draft.plain.advice = ['检查不显眼的角落和真实收纳处，不把解读当作位置证明。', '请核实手机是否不在明处，以实际定位和现场检查为准。'];
  assert.deepEqual(parseDraft(draft, factsBundle).plain.advice, draft.plain.advice);
  rejects(draft => { draft.analysis[0].interpretation = '不能确定位置，但伏藏本身说明不在显处。'; }, /实际隐蔽位置/);
});
