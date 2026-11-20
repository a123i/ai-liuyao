'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { toDisplayAnswer } = require('../public/answer-presentation');

const INTERNAL = /\bL[1-6](?:_L[1-6]|\.[A-Z.]+)?\b|SHI_YING|\b(?:MONTH|DAY|VOID|IDENTITY|CHANGE|HIDDEN|CHART|PALACE|CALENDAR|SCOPE|QUESTION)\b/;

test('cleans the screenshot citations and every line reference in the professional prose', () => {
  const original = '推论（依据：L3.MONTH、L3.DAY、L5.VOID、L5.DAY、L4.MONTH、L4.DAY、L2.MONTH、L2.DAY、SHI_YING）：传统卦象显示：工作用神L3官鬼辰土月破而临日，工作机会存在但伴随变动或压力；应爻L5官鬼戌土空而日冲，外部环境或机会尚未落实；父母L4申金得日月生扶，工作载体或制度条件较有基础；世爻L2子孙寅木耗力于。';
  const output = toDisplayAnswer(original);
  assert.doesNotMatch(output, INTERNAL);
  assert.ok(output.startsWith('推论：传统卦象显示：工作用神三爻官鬼辰土月破而临日'));
  assert.ok(output.includes('应爻五爻官鬼戌土空而日冲'));
  assert.ok(output.includes('父母四爻申金得日月生扶'));
  assert.ok(output.includes('世爻二爻子孙寅木'));
  assert.ok(original.includes('L3.MONTH'), 'presentation never mutates the stored source');
});

test('removes pure old evidence wrappers but preserves meaningful parenthetical explanations', () => {
  const original = '判断（依据： L2.MONTH、\n L2.DAY、SHI_YING）成立。[L2.IDENTITY]二爻妻财得助。【L5.CHANGE】五爻发动。(L4.F.DAY, L4.F.VOID) 仍需核实。（依据：妻财得助，但受冲）不可省略。';
  const output = toDisplayAnswer(original);
  assert.doesNotMatch(output, INTERNAL);
  assert.ok(output.includes('判断成立。二爻妻财得助。五爻发动。'));
  assert.ok(output.includes('（依据：妻财得助，但受冲）不可省略。'));
});

test('maps main, changed, hidden, pair and calendar references without losing their identities', () => {
  const original = 'L1、L2、L3、L4、L5、L6；L3.C；L4.F；L3.C.MONTH；L4.F.VOID；L2.CHANGE；L4.HIDDEN；L1_L4；SHI_YING；CHART；PALACE；CALENDAR；SCOPE；QUESTION。';
  const output = toDisplayAnswer(original);
  assert.doesNotMatch(output, INTERNAL);
  for (const label of ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻', '三爻化爻', '四爻伏神', '三爻化爻的月令条件', '四爻伏神的旬空状态', '二爻动变关系', '初爻与四爻关系', '世应关系', '卦象结构', '卦宫', '起卦时间', '判读范围', '所问事项']) assert.ok(output.includes(label), label);
});

test('formatting is idempotent and does not strip arbitrary English names, emails or URLs', () => {
  const original = '我在 OpenAI 与 L3Harris 应聘 HR。邮箱 L2.MONTH@example.com，链接 https://example.com/L3?QUESTION=L4.F#L1 和 HTTPS://example.com/L3?QUESTION=L4.F。技术依据L3.MONTH，世爻L1。公司 A_L3 和 XSHI_YINGY 不变。未知字段 L3.MONTHLY 不作局部转换。';
  const formatted = toDisplayAnswer(original);
  for (const content of ['OpenAI', 'L3Harris', 'HR', 'L2.MONTH@example.com', 'https://example.com/L3?QUESTION=L4.F#L1', 'HTTPS://example.com/L3?QUESTION=L4.F', 'A_L3', 'XSHI_YINGY', 'L3.MONTHLY']) assert.ok(formatted.includes(content), content);
  assert.ok(formatted.includes('技术依据三爻月令条件，世爻初爻'));
  assert.equal(toDisplayAnswer(formatted), formatted);
});

test('the same module works in a browser context with no Node.js globals', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/answer-presentation.js'), 'utf8'), context);
  assert.equal(typeof context.LiuYaoAnswerPresentation.toDisplayAnswer, 'function');
  assert.equal(context.LiuYaoAnswerPresentation.toDisplayAnswer('世爻L1；应爻L4（依据：SHI_YING）'), '世爻初爻；应爻四爻');
  assert.equal(context.LiuYaoAnswerPresentation.toDisplayAnswer(null), '');
  assert.equal(context.LiuYaoAnswerPresentation.toDisplayAnswer(undefined), '');
});
