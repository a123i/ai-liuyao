const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createShakeController } = require('../public/shake-controller');

const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

function fixture(confirmResult = true) {
  const fields = {
    '#manualTime': { value: '' },
    '#shakeStatus': { textContent: '' },
    '#q': { value: '测试问题', focus() {} }
  };
  const calls = [];
  let confirms = 0;
  class TestDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : ['2026-09-24T00:10:03+08:00']));
    }
  }
  const context = vm.createContext({
    Date: TestDate,
    document: { querySelector: selector => fields[selector] },
    window: { confirm: () => { confirms++; return confirmResult; } },
    ShakeController: { createShakeController },
    LiuYao: { cast: (...args) => { calls.push(args); return { marker: 'cast' }; } },
    AIDivination: { DEFAULT_MODEL: 'deepseek-flash' },
    ICHING_TEXT: {}
  });
  // The final IIFE only attaches browser handlers; the functions under test are
  // executed against the small DOM above without loading external services.
  vm.runInContext(appSource.slice(0, appSource.indexOf('// init：')), context);
  vm.runInContext('questionConfirmed=true; render=(result)=>{globalThis.rendered=result};', context);
  return { context, fields, calls, get confirms() { return confirms; } };
}

test('traditional moving-line labels put 九/六 before middle line numbers', () => {
  const { context } = fixture();
  const got = vm.runInContext('[1,2,3,4,5,6].map((pos)=>yaoName(pos,pos%2===1))', context);
  assert.deepEqual(Array.from(got), ['初九', '六二', '九三', '六四', '九五', '上六']);
});

test('coin preview follows the same four outcomes as the casting engine', () => {
  const { context } = fixture();
  const got = vm.runInContext('[0,1,2,3].map(backs=>{coins[0]=[0,1,2].map(index=>index<backs);return yaoOf(0)})', context);
  assert.deepEqual(Array.from(got, value => ({ yang: value.yang, move: value.move })), [
    { yang: 0, move: true },
    { yang: 1, move: false },
    { yang: 0, move: false },
    { yang: 1, move: true }
  ]);
  assert.match(appSource, /\['老阴','少阳','少阴','老阳'\]\[b\]/);
  assert.match(pageSource, /0 背老阴、1 背少阳、2 背少阴、3 背老阳/);
});

test('changed hexagram keeps all six bars but only moving lines show transformed relations', () => {
  const { context } = fixture();
  context.staticLine = { yang: 1, move: false, liuqin: '妻财', gan: '甲', zhi: '子', wx: '水' };
  context.movingLine = { ...context.staticLine, move: true };
  const staticCell = vm.runInContext('lineCellChg(staticLine)', context);
  const movingCell = vm.runInContext('lineCellChg(movingLine)', context);
  assert.match(staticCell, /<span class="bar yang">/);
  assert.doesNotMatch(staticCell, /妻财|甲子/);
  assert.match(movingCell, /妻财/);
  assert.match(movingCell, /甲子/);
  assert.match(movingCell, /<span class="bar yang">/);
  assert.doesNotMatch(movingCell, /<span class=mk>[○×]<\/span>/);
  context.movingBenLine = { ...context.movingLine, liushen: '青龙' };
  assert.match(vm.runInContext('lineCellBen(movingBenLine)', context), /<span class=mk>○<\/span>/);

  const pillar = { text: '甲子', kong: ['戌', '亥'] };
  const benLines = Array.from({ length: 6 }, (_, index) => ({
    pos: index + 1, yang: index % 2, move: index === 0,
    liushen: '青龙', liuqin: '兄弟', gan: '甲', zhi: '子', wx: '水'
  }));
  const chgLines = benLines.map(line => ({ ...line, liuqin: '妻财', gan: '乙', zhi: '丑', wx: '土' }));
  context.sampleCast = {
    timestamp: { display: '2026年09月24日 00:10:03', pillars: { year: pillar, month: pillar, day: pillar, hour: pillar } },
    day: { text: '甲子' }, kong: ['戌', '亥'], hasMove: true,
    ben: { name: '本卦', palace: '乾', gongType: '本宫', guaci: '本辞', yaoci: Array(6).fill('爻辞'), lines: benLines },
    chg: { name: '变卦', palace: '乾', gongType: '一世', guaci: '变辞', lines: chgLines }
  };
  const copy = vm.runInContext('buildCastCopyText(sampleCast)', context);
  assert.equal(copy.split('\n').filter(line => line.includes(' → ')).length, 1);
  assert.match(copy, /初爻.* → 妻财乙丑土/);
  assert.doesNotMatch(copy, /二爻.* → /);
});

test('untouched all-front manual cast requires explicit confirmation', () => {
  const no = fixture(false);
  vm.runInContext('go()', no.context);
  assert.equal(no.confirms, 1);
  assert.equal(no.calls.length, 0);

  const yes = fixture(true);
  vm.runInContext('go()', yes.context);
  assert.equal(yes.confirms, 1);
  assert.deepEqual(Array.from(yes.calls[0][0]), [0, 0, 0, 0, 0, 0]);
  assert.equal(yes.calls[0][1].toISOString(), '2026-09-23T16:10:03.000Z');
});

test('empty manual time uses the click instant; chosen time is preserved', () => {
  const f = fixture();
  vm.runInContext('manualCoinTouched=true; go()', f.context);
  assert.equal(f.confirms, 0);
  assert.equal(f.calls[0][1].toISOString(), '2026-09-23T16:10:03.000Z');

  f.fields['#manualTime'].value = '2026-09-21T09:10:11';
  vm.runInContext('go()', f.context);
  assert.equal(f.calls[1][1].toISOString(), '2026-09-21T01:10:11.000Z');
  assert.equal(f.fields['#manualTime'].value, '2026-09-21T09:10:11');
});

test('UI explains second precision, manual time fallback and late-Zi convention', () => {
  assert.match(pageSource, /id="manualTime" step="1"/);
  assert.match(pageSource, /留空则以点击「排盘」的时刻为准/);
  assert.match(pageSource, /23:00–23:59 的晚子时仍算当天/);
  assert.doesNotMatch(appSource, /manualTime'\)\.value=localDatetimeValue/);
  assert.match(appSource, /六爻皆静：按纳甲六爻法/);
});
