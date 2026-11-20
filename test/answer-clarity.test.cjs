'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRequest, buildMessages, compactRuleFacts } = require('../src/divination');
const { buildRuleFacts } = require('../src/liuyao-rules');
const { parseDraft } = require('../src/interpretation-contract');
const { PLAIN_PROMPT, REVIEW_PROMPT, plainMessages, createGroundedInterpreter } = require('../src/grounded-interpreter');
const { payload, validDraft, professionalDraft, isPlain, isReview, passingReview } = require('./grounded-fixture.cjs');

test('professional clarity prompts answer the question and weigh the decisive evidence without forcing a binary verdict', () => {
  const input = validateRequest(payload());
  const facts = buildRuleFacts(input);
  const messages = buildMessages(input, facts, true);
  const system = messages[0].content;
  assert.match(system, /先回答所问/);
  assert.match(system, /决定判断的1至2项主因与次要制约/);
  assert.match(system, /mixed.*当前主要阻碍.*推进条件/);
  assert.match(system, /uncertain.*具体哪项不能判断/);
  assert.match(system, /不得为了明确而强迫二选一或编造保证/);
  assert.match(system, /解释文字.*中文爻位/);
  assert.doesNotMatch(system, /程序会原样展示引用的事实/);
  const marker = '\n程序核算事实表（id用于引用，候选仅为用神选择范围，不代表最终结论）：\n';
  const content = messages[1].content;
  const index = content.lastIndexOf(marker);
  assert.ok(index >= 0);
  assert.deepEqual(JSON.parse(content.slice(index + marker.length)), compactRuleFacts(facts));
});

test('plain editing removes the old hedged template and concentrates necessary limitations without weakening grounding', () => {
  assert.match(PLAIN_PROMPT, /answer首句直接回答用户的问题/);
  assert.match(PLAIN_PROMPT, /mixed.*主要卡在哪里.*先满足什么条件/);
  assert.match(PLAIN_PROMPT, /uncertain直接指出哪项无法判断/);
  assert.match(PLAIN_PROMPT, /按优先级排列的具体动作/);
  assert.match(PLAIN_PROMPT, /必要边界集中到limitations一次说明/);
  assert.match(PLAIN_PROMPT, /不能删除会改变结论的重要限定/);
  assert.doesNotMatch(PLAIN_PROMPT, /没有完全否定找回的可能，但不足以判断能否找回/);
  assert.match(PLAIN_PROMPT, /不能给大概率、百分比、必然、确定位置、日期等保证/);

  const input = validateRequest(payload());
  const facts = buildRuleFacts(input);
  const draft = professionalDraft(validDraft(payload()));
  const before = structuredClone(draft);
  const messages = plainMessages(input, facts, draft);
  const data = JSON.parse(messages[1].content);
  assert.deepEqual(data.professional, before);
  assert.deepEqual(draft, before);
  assert.ok(data.allowed_evidence_ids.every(id => facts.facts.some(fact => fact.id === id)));
});

test('independent review checks substantive clarity while permitting genuinely unknown results', () => {
  assert.match(REVIEW_PROMPT, /首句须直接回答所问/);
  assert.match(REVIEW_PROMPT, /mixed应说明当前主要阻碍/);
  assert.match(REVIEW_PROMPT, /不强制每次吉凶均衡、二选一或不同结论/);
  assert.match(REVIEW_PROMPT, /不因缺乏依据时明确无法判断而拒绝/);
  assert.match(REVIEW_PROMPT, /未回答所问等实质缺漏/);
  assert.match(REVIEW_PROMPT, /不因长短、措辞偏好拒绝/);
});

// These synthetic drafts exercise the permitted contract and review pipeline,
// not a scoring oracle or proof that one real chart has four valid outcomes.
const judgments = [
  {
    tendency: 'favorable',
    conclusion: '综合所引条件，本次判断偏有利，先继续准备和推进；有利倾向不等于现实结果已经落实。',
    answer: '这次更支持继续准备和推进，不必因为尚未看到结果就停下。',
    reason: '主要条件对推进有支持，先把可执行的准备做好更合适。',
    advice: '先整理目标与准备材料，再核对下一步的现实要求。'
  },
  {
    tendency: 'unfavorable',
    conclusion: '综合所引条件，本次判断偏不利，当前先补足准备，不宜急于推进关键决定。',
    answer: '这次更适合先补短板，关键决定暂缓，不宜急着推进。',
    reason: '目前更需要处理制约因素，补足准备比加快行动更重要。',
    advice: '先检查尚未满足的要求，并列出需要补齐的材料。'
  },
  {
    tendency: 'mixed',
    conclusion: '本次采取有条件推进：准备可以继续，关键决定先缓；先处理所引依据中的主要制约，再评估是否加快。',
    answer: '准备可以继续，关键决定先等等；先解决最影响推进的那项障碍，再评估下一步。',
    reason: '支持条件并不等于制约已解除，所以准备与关键决定需要分开处理。',
    advice: '先列出最影响推进的一项障碍，核实它是否已得到处理。'
  },
  {
    tendency: 'uncertain',
    conclusion: '所问范围尚不明确，目前无法判断具体结果；先明确要比较的对象与范围，不强行给出吉凶。',
    answer: '目前不能判断具体结果。先说明要比较的对象和范围，再决定下一步。',
    reason: '关键判断对象没有明确，强行选择任一方向都会超出已有依据。',
    advice: '先明确最想解决的一个问题，避免把不同目标混在一起。'
  }
];

for (const judgment of judgments) {
  test(`a ${judgment.tendency} conclusion remains expressible and still requires independent review`, async () => {
    const raw = payload();
    const input = validateRequest(raw);
    const facts = buildRuleFacts(input);
    const draft = validDraft(raw);
    draft.conclusion.tendency = judgment.tendency;
    draft.conclusion.text = judgment.conclusion;
    draft.plain.answer = judgment.answer;
    draft.plain.reasons[0].text = judgment.reason;
    draft.plain.advice = [judgment.advice];
    draft.plain.limitations = '这里只表达本次解读倾向，不把它当作已确认的现实结果。';
    assert.equal(parseDraft(draft, facts).conclusion.tendency, judgment.tendency);
    const stages = [];
    let checked;
    const interpreter = createGroundedInterpreter({ complete: async request => {
      const stage = isReview(request) ? 'review' : isPlain(request) ? 'plain' : 'professional';
      stages.push(stage);
      if (stage === 'review') {
        const data = JSON.parse(request.messages[1].content);
        assert.equal(data.draft.conclusion.tendency, judgment.tendency);
        assert.equal(data.draft.plain.answer, judgment.answer);
        return passingReview();
      }
      return JSON.stringify(stage === 'plain' ? draft.plain : professionalDraft(draft));
    }, onChecked: value => { checked = value; } });
    const answer = await interpreter.complete(input);
    assert.deepEqual(stages, ['professional', 'plain', 'review']);
    assert.equal(checked.tendency, judgment.tendency);
    assert.ok(answer.includes(judgment.answer));
  });
}

test('clearer wording does not permit unsupported dates, locations or guaranteed outcomes', () => {
  const raw = payload();
  const facts = buildRuleFacts(validateRequest(raw));
  for (const answer of ['明天就会找到手机。', '手机就在卧室的床底。', '这次一定能成功。']) {
    const draft = validDraft(raw);
    draft.plain.answer = answer;
    assert.throws(() => parseDraft(draft, facts), { code: 'AI_QUALITY_ERROR' });
  }
});
