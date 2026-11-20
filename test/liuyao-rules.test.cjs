const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../public/engine');
const { buildRuleFacts, elementRelation, branchRelation, lineName } = require('../src/liuyao-rules');

const ELEMENTS = ['木', '火', '土', '金', '水'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const WX = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
const STAMP = engine.castTimestamp(new Date('2026-09-23T12:00:00+08:00'));
function input(coins = [2, 2, 1, 1, 2, 1], question = '工作如何？', timestamp = STAMP) {
  return { question, timestamp, cast: engine.cast(coins, timestamp) };
}
function byId(packet, id) {
  const fact = packet.facts.find(item => item.id === id);
  assert.ok(fact, id);
  return fact;
}

test('all 25 ordered five-element pairs match the explicit directional matrix', () => {
  const expected = [
    ['same', 'generates', 'overcomes', 'overcome_by', 'generated_by'],
    ['generated_by', 'same', 'generates', 'overcomes', 'overcome_by'],
    ['overcome_by', 'generated_by', 'same', 'generates', 'overcomes'],
    ['overcomes', 'overcome_by', 'generated_by', 'same', 'generates'],
    ['generates', 'overcomes', 'overcome_by', 'generated_by', 'same']
  ];
  const inverse = { same: 'same', generates: 'generated_by', generated_by: 'generates',
    overcomes: 'overcome_by', overcome_by: 'overcomes' };
  for (let i = 0; i < ELEMENTS.length; i++) {
    for (let j = 0; j < ELEMENTS.length; j++) {
      const actual = elementRelation(ELEMENTS[i], ELEMENTS[j]);
      assert.equal(actual, expected[i][j], `${ELEMENTS[i]}→${ELEMENTS[j]}`);
      assert.equal(elementRelation(ELEMENTS[j], ELEMENTS[i]), inverse[actual]);
    }
  }
  for (const invalid of ['', '风', undefined, null]) assert.throws(() => elementRelation(invalid, '木'), /INVALID_ELEMENT/);
});

test('all 144 branch pairs match all six harmonies and clashes, including 辰酉', () => {
  const harmonies = ['子丑', '寅亥', '卯戌', '辰酉', '巳申', '午未'];
  const clashes = ['子午', '丑未', '寅申', '卯酉', '辰戌', '巳亥'];
  const includesPair = (pairs, a, b) => pairs.includes(a + b) || pairs.includes(b + a);
  const counts = { same: 0, harmony: 0, clash: 0, none: 0 };
  for (const a of BRANCHES) {
    for (const b of BRANCHES) {
      const expected = a === b ? 'same' : includesPair(harmonies, a, b) ? 'harmony'
        : includesPair(clashes, a, b) ? 'clash' : 'none';
      const actual = branchRelation(a, b);
      assert.equal(actual, expected, `${a}↔${b}`);
      assert.equal(branchRelation(b, a), actual);
      counts[actual]++;
    }
  }
  assert.deepEqual(counts, { same: 12, harmony: 12, clash: 12, none: 108 });
  assert.equal(branchRelation('辰', '酉'), 'harmony');
  assert.equal(branchRelation('巳', '申'), 'harmony');
  assert.throws(() => branchRelation('甲', '子'), /INVALID_BRANCH/);
  assert.throws(() => branchRelation('子', undefined), /INVALID_BRANCH/);
});

test('canonical yin/yang names preserve position order and reject malformed lines', () => {
  const names = [
    ['初六', '六二', '六三', '六四', '六五', '上六'],
    ['初九', '九二', '九三', '九四', '九五', '上九']
  ];
  for (const yang of [0, 1]) {
    for (let pos = 1; pos <= 6; pos++) assert.equal(lineName({ pos, yang }), names[yang][pos - 1]);
  }
  assert.equal(lineName('L1'), '初爻');
  assert.equal(lineName(6), '上爻');
  assert.throws(() => lineName({ pos: 7, yang: 1 }), /INVALID_LINE_POSITION/);
  assert.throws(() => lineName({ pos: 2, yang: true }), /INVALID_LINE_POLARITY/);
});

test('旅 has 辰土世、酉金应: directional 土生金 and 辰酉六合 coexist', () => {
  const packet = buildRuleFacts(input());
  assert.equal(packet.version, '1.0.0');
  assert.equal(packet.shiId, 'L1');
  assert.equal(packet.yingId, 'L4');
  assert.equal(packet.lines[0].zhi, '辰');
  assert.equal(packet.lines[3].zhi, '酉');
  assert.equal(packet.lines[0].name, '初六');
  assert.equal(packet.lines[3].name, '九四');
  const relationship = byId(packet, 'SHI_YING');
  assert.equal(relationship.elementRelation, 'generates');
  assert.equal(relationship.reverseElementRelation, 'generated_by');
  assert.equal(relationship.branchRelation, 'harmony');
  assert.match(relationship.text, /世爻生应爻/);
  assert.match(relationship.text, /世应地支六合/);
  assert.equal(byId(packet, 'CHART').mainPattern.type, 'harmony');
  assert.equal(byId(packet, 'L1_L4').branchRelation, 'harmony');
});

test('day void is recalculated for main, changed and hidden, never inherited from other pillars', () => {
  const voids = [['戌', '亥'], ['申', '酉'], ['午', '未'], ['辰', '巳'], ['寅', '卯'], ['子', '丑']];
  for (let cycle = 0; cycle < 60; cycle++) {
    const timestamp = structuredClone(STAMP);
    timestamp.pillars.day.text = STEMS[cycle % 10] + BRANCHES[cycle % 12];
    timestamp.pillars.day.kong = ['子', '丑']; // Deliberately contradictory: never trust this hint.
    timestamp.pillars.month.kong = ['辰', '巳'];
    timestamp.pillars.year.kong = ['申', '酉'];
    timestamp.pillars.hour.kong = ['戌', '亥'];
    const request = input([0, 2, 3, 1, 2, 1], '工作如何？', timestamp);
    for (const line of request.cast.ben.lines) line.kong = !line.kong;
    const packet = buildRuleFacts(request);
    const expectedVoid = voids[Math.floor(cycle / 10)];
    assert.deepEqual(packet.dayKong, expectedVoid);
    for (const line of packet.lines) {
      for (const subject of [line, line.changed, line.hidden].filter(Boolean)) {
        assert.equal(subject.dayVoid, expectedVoid.includes(subject.zhi), `${cycle}:${subject.id}`);
        const prefix = subject.source === 'main' ? line.id : subject.id;
        assert.equal(byId(packet, `${prefix}.VOID`).dayVoid, subject.dayVoid);
        assert.deepEqual(byId(packet, `${prefix}.VOID`).dayKong, expectedVoid);
      }
    }
  }
});

test('all month/day branches provide separate element direction and branch relation without automatic 日破/暗动', () => {
  const covered = { month: new Set(), day: new Set() };
  for (const monthBranch of BRANCHES) {
    for (const dayBranch of BRANCHES) {
      const timestamp = structuredClone(STAMP);
      timestamp.pillars.month.text = (BRANCHES.indexOf(monthBranch) % 2 ? '乙' : '甲') + monthBranch;
      timestamp.pillars.day.text = (BRANCHES.indexOf(dayBranch) % 2 ? '乙' : '甲') + dayBranch;
      const packet = buildRuleFacts(input([0, 2, 3, 1, 2, 1], '工作如何？', timestamp));
      for (const line of packet.lines) {
        for (const subject of [line, line.changed, line.hidden].filter(Boolean)) {
          for (const [kind, branch] of [['month', monthBranch], ['day', dayBranch]]) {
            const relation = subject[kind];
            assert.equal(relation.elementRelation, elementRelation(WX[branch], subject.wx));
            assert.equal(relation.branchRelation, branchRelation(branch, subject.zhi));
            assert.equal(relation.fromZhi, branch);
            assert.equal(relation.toZhi, subject.zhi);
            const prefix = subject.source === 'main' ? line.id : subject.id;
            const fact = byId(packet, `${prefix}.${kind.toUpperCase()}`);
            assert.equal(fact.elementRelation, relation.elementRelation);
            assert.equal(fact.branchRelation, relation.branchRelation);
            assert.equal(fact.activeEffect, null);
            if (kind === 'month') assert.equal(fact.monthBroken, relation.branchRelation === 'clash');
            if (kind === 'day' && relation.branchRelation === 'clash') assert.match(fact.text, /不据此自动定暗动或日破/);
            assert.equal(Object.hasOwn(fact, 'hiddenMovement'), false);
            assert.equal(Object.hasOwn(fact, 'dayBroken'), false);
            covered[kind].add(relation.elementRelation);
          }
        }
      }
    }
  }
  for (const kind of ['month', 'day']) assert.equal(covered[kind].size, 5);
});

test('all 4096 coin outcomes have canonical identities, bounded unique facts and complete moving/hidden evidence', () => {
  let maximumFacts = 0;
  const progressionSeen = new Set();
  for (let encoded = 0; encoded < 4096; encoded++) {
    const coins = Array.from({ length: 6 }, (_, index) => (encoded >> (index * 2)) & 3);
    const request = input(coins);
    const packet = buildRuleFacts(request);
    const ids = new Set(packet.facts.map(fact => fact.id));
    assert.equal(ids.size, packet.facts.length, `${encoded}:duplicate fact ID`);
    assert.ok(packet.facts.length <= 90, `${encoded}:fact count ${packet.facts.length}`);
    maximumFacts = Math.max(maximumFacts, packet.facts.length);
    assert.equal(packet.facts.filter(fact => fact.kind === 'identity').length, 6);
    assert.equal(packet.facts.filter(fact => fact.kind === 'pair').length, 15);
    assert.equal(packet.facts.filter(fact => fact.kind === 'change').length, packet.movingLineIds.length);
    assert.equal(packet.lines.filter(line => line.shi).length, 1);
    assert.equal(packet.lines.filter(line => line.ying).length, 1);
    const mainWX = request.cast.ben.palaceWX;
    for (const line of packet.lines) {
      assert.equal(line.relative, engine.liuqin(mainWX, line.wx));
      assert.equal(line.shi, line.id === packet.shiId);
      assert.equal(line.ying, line.id === packet.yingId);
      assert.equal(packet.movingLineIds.includes(line.id), line.move);
      assert.equal(ids.has(`${line.id}.CHANGE`), line.move);
      if (line.move) {
        const change = byId(packet, `${line.id}.CHANGE`);
        assert.equal(change.lineId, line.id);
        assert.equal(line.changed.yang, 1 - line.yang);
        assert.equal(line.changed.relative, engine.liuqin(mainWX, line.changed.wx));
        assert.equal(change.elementRelation, elementRelation(line.wx, line.changed.wx));
        assert.equal(change.reverseElementRelation, elementRelation(line.changed.wx, line.wx));
        assert.equal(change.branchRelation, branchRelation(line.zhi, line.changed.zhi));
        assert.equal(change.activeEffect, null);
        progressionSeen.add(change.progression);
        if (change.progression === 'advance' || change.progression === 'retreat') assert.equal(line.wx, line.changed.wx);
      } else assert.equal(line.changed, null);
      if (line.hidden) {
        assert.equal(line.hidden.relative, engine.liuqin(mainWX, line.hidden.wx));
        const hidden = byId(packet, `${line.id}.HIDDEN`);
        assert.equal(hidden.elementRelation, elementRelation(line.wx, line.hidden.wx));
        assert.equal(hidden.reverseElementRelation, elementRelation(line.hidden.wx, line.wx));
        assert.equal(hidden.branchRelation, branchRelation(line.zhi, line.hidden.zhi));
      }
    }
    for (const candidate of packet.candidates) {
      assert.ok(ids.has(candidate.factId));
      assert.ok(candidate.source === 'main' || candidate.source === 'hidden');
    }
    assert.equal(packet.candidates.filter(candidate => candidate.source === 'main').length, 6);
    for (const pair of packet.facts.filter(fact => fact.kind === 'pair')) {
      assert.equal(pair.activeEffect, null);
      assert.equal(pair.conditional, true);
    }
    assert.equal(Object.hasOwn(packet, 'fortuneScore'), false);
    assert.equal(Object.hasOwn(packet, 'strengthScore'), false);
  }
  assert.ok(maximumFacts >= 69);
  // No canonical moving-position transform yields 戌↔丑 in this 纳甲 layout.
  assert.deepEqual([...progressionSeen].sort(), ['advance', 'none', 'retreat']);
});

test('verified seven progression pairs are directional, non-cyclic and not inferred for every same-element change', () => {
  const advances = new Set(['亥子', '寅卯', '巳午', '申酉', '丑辰', '辰未', '未戌']);
  const retreats = new Set([...advances].map(pair => [...pair].reverse().join('')));
  const seen = new Set();
  for (let bits = 0; bits < 64; bits++) {
    for (let moves = 1; moves < 64; moves++) {
      const coins = Array.from({ length: 6 }, (_, pos) => (bits >> pos) & 1
        ? ((moves >> pos) & 1 ? 3 : 1) : ((moves >> pos) & 1 ? 0 : 2));
      const packet = buildRuleFacts(input(coins));
      for (const line of packet.lines.filter(item => item.move)) {
        const pair = line.zhi + line.changed.zhi;
        const expected = advances.has(pair) ? 'advance' : retreats.has(pair) ? 'retreat'
          : pair === '戌丑' || pair === '丑戌' ? 'disputed' : 'none';
        const change = byId(packet, `${line.id}.CHANGE`);
        assert.equal(change.progression, expected, pair);
        if (expected === 'disputed') assert.match(change.text, /有版本分歧/);
        if (expected === 'advance' || expected === 'retreat') seen.add(pair);
      }
    }
  }
  // A direct 化爻 must also flip yin/yang at its position; not every abstract
  // branch pair is obtainable there. Check every feasible progression instead
  // of fabricating non-canonical charts just to reach the unused lookup entries.
  assert.deepEqual([...seen].sort(), ['丑辰', '卯寅', '寅卯', '戌未', '未戌', '申酉', '辰丑', '酉申'].sort());
});

test('category hints include all main/hidden candidates and never force ambiguous use-god choices', () => {
  const relationship = buildRuleFacts(input(undefined, '我和对象的感情能发展吗？'));
  assert.equal(relationship.questionCategory.id, 'relationship');
  assert.equal(relationship.questionCategory.ambiguous, true);
  assert.deepEqual(relationship.questionCategory.suggestedRelatives, ['妻财', '官鬼']);
  assert.equal(relationship.questionCategory.finalSelection, null);
  const unclear = buildRuleFacts(input(undefined, '以后怎样？'));
  assert.equal(unclear.questionCategory.id, 'unclear');
  assert.equal(unclear.questionCategory.ambiguous, true);
  assert.equal(unclear.questionCategory.finalSelection, null);
  const mixed = buildRuleFacts(input(undefined, '孩子考试以及我的工作工资怎么样？'));
  assert.equal(mixed.questionCategory.id, 'multiple');
  assert.equal(mixed.questionCategory.ambiguous, true);
  assert.ok(mixed.questionCategory.suggestedRelatives.includes('妻财'));
  assert.ok(mixed.questionCategory.suggestedRelatives.includes('子孙'));
  const lostPhone = buildRuleFacts(input(undefined, '手机在哪里？什么时候能找回？'));
  assert.equal(lostPhone.questionCategory.id, 'lost_property');
  assert.deepEqual(lostPhone.questionCategory.suggestedRelatives, ['妻财']);
  assert.equal(lostPhone.questionCategory.ambiguous, true);
  assert.equal(lostPhone.questionCategory.finalSelection, null);
  assert.equal(buildRuleFacts(input(undefined, '我什么时候换手机？')).questionCategory.id, 'unclear');
  for (const packet of [relationship, unclear, mixed]) {
    assert.equal(packet.candidates.length, packet.lines.length + packet.lines.filter(line => line.hidden).length);
    for (const candidate of packet.candidates) {
      const fact = byId(packet, candidate.factId);
      assert.equal(fact.relative, candidate.relative);
      assert.equal(fact.lineId, candidate.lineId);
      assert.equal(fact.source, candidate.source);
    }
  }
});

test('canonical cast takes priority, build is deterministic and input is not mutated', () => {
  const request = input([3, 0, 1, 2, 3, 2]);
  const before = JSON.stringify(request);
  const first = buildRuleFacts(request);
  assert.equal(JSON.stringify(request), before);
  assert.deepEqual(buildRuleFacts(request), first);
  assert.deepEqual(buildRuleFacts({ question: request.question, cast: request.cast }), first);
  const canonical = request.cast;
  const damaged = structuredClone(canonical);
  damaged.ben.lines[0].zhi = '伪';
  assert.deepEqual(buildRuleFacts({ ...request, cast: damaged, canonicalCast: canonical }), first);
  assert.match(byId(first, 'SCOPE').text, /不自动等于有效作用/);
  assert.match(byId(first, 'SCOPE').text, /未自动判十二长生、土墓绝、三合成化/);
});

test('malformed chart identities or pillar values fail closed instead of generating invented facts', () => {
  assert.throws(() => buildRuleFacts({}), /INVALID_RULE_CHART/);
  for (const mutate of [
    request => { request.cast.ben.lines[0].wx = '金'; },
    request => { request.cast.ben.lines[0].liuqin = '妻财'; },
    request => { request.cast.ben.lines[0].shi = false; },
    request => { request.cast.ben.palaceWX = '水'; },
    request => { request.cast.ben.lines[0].fu = null; },
    request => { request.cast.chg.lines[0].liuqin = '伪'; },
    request => { request.cast.chg.key = '111111'; },
    request => { request.cast.ben.lines[0].move = 'true'; },
    request => { request.timestamp.pillars.day.text = '甲丑'; },
    request => { request.timestamp.pillars.month.text = '错误'; }
  ]) {
    const request = input([0, 2, 1, 1, 2, 1]);
    mutate(request);
    assert.throws(() => buildRuleFacts(request), /INVALID_RULE_/);
  }
});
