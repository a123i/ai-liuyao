const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../public/engine');

const DATE = { y: 2026, m: 9, d: 23 };
const COIN_RULES = [
  { backs: 0, yang: 0, move: true, kind: '老阴' },
  { backs: 1, yang: 1, move: false, kind: '少阳' },
  { backs: 2, yang: 0, move: false, kind: '少阴' },
  { backs: 3, yang: 1, move: true, kind: '老阳' }
];

test('one to three backs follow the four classical coin outcomes', () => {
  for (const expected of COIN_RULES) {
    const result = engine.cast([expected.backs, 1, 1, 1, 1, 1], DATE);
    assert.deepEqual(result.coins[0], expected);
    assert.equal(result.ben.lines[0].yang, expected.yang);
    assert.equal(result.ben.lines[0].move, expected.move);
    assert.equal(result.chg?.lines[0].yang, expected.move ? 1 - expected.yang : undefined);
  }
});

test('six one-back lines give Qian; six two-back lines give Kun without movement', () => {
  const qian = engine.cast([1, 1, 1, 1, 1, 1], DATE);
  const kun = engine.cast([2, 2, 2, 2, 2, 2], DATE);
  assert.equal(qian.ben.key, '111111');
  assert.equal(qian.ben.palace, '乾');
  assert.equal(qian.hasMove, false);
  assert.equal(qian.chg, null);
  assert.equal(kun.ben.key, '000000');
  assert.equal(kun.ben.palace, '坤');
  assert.equal(kun.hasMove, false);
  assert.equal(kun.chg, null);
});

test('moving second line from Qian to Tongren keeps the original palace as liuqin basis', () => {
  const result = engine.cast([1, 3, 1, 1, 1, 1], DATE);
  assert.equal(result.ben.key, '111111');
  assert.equal(result.ben.palaceWX, '金');
  assert.equal(result.chg.key, '101111');
  assert.equal(result.chg.palace, '离');
  assert.equal(result.chg.palaceWX, '火');
  assert.equal(result.chg.lines[1].zhi, '丑');
  assert.equal(result.chg.lines[1].wx, '土');
  assert.equal(result.chg.lines[1].liuqin, '父母');
  assert.equal(engine.dressLines([1, 0, 1, 1, 1, 1])[1].liuqin, '子孙');
});

test('all 64 static hexagrams have a unique palace and valid shi-ying positions', () => {
  const keys = Object.keys(engine.PALACE_MAP);
  assert.equal(keys.length, 64);
  const counts = {};
  for (let value = 0; value < 64; value++) {
    const bits = Array.from({ length: 6 }, (_, pos) => (value >> pos) & 1);
    const key = bits.join('');
    const result = engine.cast(bits.map(bit => bit ? 1 : 2), DATE);
    const palace = engine.PALACE_MAP[key];
    assert.ok(palace, key);
    assert.equal(result.ben.key, key);
    assert.equal(result.ben.palace, palace.palace);
    assert.equal(result.hasMove, false);
    assert.equal(result.ben.lines.filter(line => line.shi).length, 1);
    assert.equal(result.ben.lines.filter(line => line.ying).length, 1);
    assert.equal(Math.abs(palace.shi - palace.ying), 3);
    counts[palace.palace] = (counts[palace.palace] || 0) + 1;
  }
  assert.deepEqual(Object.values(counts).sort(), Array(8).fill(8));
});

test('all eight pure hexagrams use the canonical inner and outer najia branches', () => {
  const expected = {
    乾: { bits: '111111', zhi: '子寅辰午申戌', gan: '甲甲甲壬壬壬' },
    兑: { bits: '110110', zhi: '巳卯丑亥酉未', gan: '丁丁丁丁丁丁' },
    离: { bits: '101101', zhi: '卯丑亥酉未巳', gan: '己己己己己己' },
    震: { bits: '100100', zhi: '子寅辰午申戌', gan: '庚庚庚庚庚庚' },
    巽: { bits: '011011', zhi: '丑亥酉未巳卯', gan: '辛辛辛辛辛辛' },
    坎: { bits: '010010', zhi: '寅辰午申戌子', gan: '戊戊戊戊戊戊' },
    艮: { bits: '001001', zhi: '辰午申戌子寅', gan: '丙丙丙丙丙丙' },
    坤: { bits: '000000', zhi: '未巳卯丑亥酉', gan: '乙乙乙癸癸癸' }
  };
  for (const [palace, data] of Object.entries(expected)) {
    const result = engine.cast([...data.bits].map(bit => bit === '1' ? 1 : 2), DATE);
    assert.equal(result.ben.palace, palace);
    assert.equal(result.ben.gongType, '本宫');
    assert.equal(result.ben.lines.map(line => line.zhi).join(''), data.zhi);
    assert.equal(result.ben.lines.map(line => line.gan).join(''), data.gan);
  }
});

test('hidden relatives appear exactly once at a pure-palace line when absent', () => {
  const all = ['兄弟', '父母', '子孙', '官鬼', '妻财'];
  for (let value = 0; value < 64; value++) {
    const bits = Array.from({ length: 6 }, (_, pos) => (value >> pos) & 1);
    const result = engine.cast(bits.map(bit => bit ? 1 : 2), DATE);
    const present = new Set(result.ben.lines.map(line => line.liuqin));
    const missing = all.filter(relative => !present.has(relative));
    const hidden = result.ben.lines.flatMap(line => line.fu ? [line.fu.liuqin] : []);
    assert.deepEqual(hidden.sort(), missing.sort(), result.ben.key);
  }
});

test('invalid coin arrays are rejected before a chart is assembled', () => {
  for (const invalid of [undefined, null, [], [1, 1, 1], [1, 1, 1, 1, 1, 4],
    [1, 1, 1, 1, 1, -1], [1, 1, 1, 1, 1, 1.5], [1, 1, 1, 1, 1, '1']]) {
    assert.throws(() => engine.cast(invalid, DATE), { message: 'INVALID_COINS' });
  }
});

test('display timestamp includes seconds while midnight remains the day boundary', () => {
  const stamp = engine.castTimestamp(new Date('2026-09-23T15:59:58Z'));
  assert.equal(stamp.display, '2026年09月23日 23:59:58');
  assert.equal(stamp.pillars.day.text, engine.dayGanZhi(2026, 9, 23).text);
  const next = engine.castTimestamp(new Date('2026-09-23T16:00:00Z'));
  assert.equal(next.display, '2026年09月24日 00:00:00');
  assert.equal(next.pillars.day.text, engine.dayGanZhi(2026, 9, 24).text);
});
