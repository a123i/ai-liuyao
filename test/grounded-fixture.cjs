const fs = require('node:fs');
const path = require('node:path');
const engine = require('../public/engine');
const { validateRequest } = require('../src/divination');
const { buildRuleFacts } = require('../src/liuyao-rules');

const source = fs.readFileSync(path.join(__dirname, '../public/iching-data.js'), 'utf8').trim();
const textDB = JSON.parse(source.replace(/^const ICHING_TEXT\s*=\s*/, '').replace(/;$/, ''));

function payload(backs = [0, 1, 2, 3, 1, 2], question = '最近学习安排如何调整？') {
  const cast = engine.cast(backs, new Date('2026-09-22T03:04:05Z'), textDB);
  return JSON.parse(JSON.stringify({ question, model: 'deepseek-flash', timestamp: cast.timestamp, cast }));
}

function validDraft(raw) {
  const input = validateRequest(raw);
  return draftForRules(buildRuleFacts(input));
}

function draftForRules(rules) {
  const candidate = rules.candidates.find(item => rules.questionCategory.suggestedRelatives.includes(item.relative)) || rules.candidates[0];
  const required = [candidate.factId, `${candidate.id}.MONTH`, `${candidate.id}.DAY`, `${candidate.id}.VOID`,
    'SCOPE', 'SHI_YING', ...rules.facts.filter(fact => fact.kind === 'change').map(fact => fact.id)];
  const ids = [...new Set(required)].filter(id => rules.facts.some(fact => fact.id === id));
  const professional = {
    schema_version: '1',
    useful: {
      candidate_id: candidate.id,
      reason: `按所问事项暂以${candidate.relative}所在位置核对目标与条件，候选含义仍须结合问题具体范围，不能仅凭六亲名称断定结果。`,
      evidence: [candidate.factId, 'QUESTION']
    },
    analysis: ids.map(id => ({
      evidence: [id],
      interpretation: `${rules.facts.find(fact => fact.id === id).text}这里只确认结构条件与限制，不据此独立断定所问事项的现实结果。`
    })),
    conclusion: {
      tendency: 'uncertain',
      text: '目前证据可以梳理用神及相关结构，但效力和现实背景仍有待确认，具体结果仍不确定，应保持不确定判断。',
      evidence: [candidate.factId, 'SCOPE', 'SHI_YING']
    }
  };
  return { ...professional, plain: plainForProfessional(professional) };
}

function professionalDraft(draft) {
  return { schema_version: draft.schema_version, useful: draft.useful, analysis: draft.analysis, conclusion: draft.conclusion };
}

function plainForProfessional(professional) {
  const candidateFactId = professional.useful.evidence[0];
  const changes = [...new Set(professional.analysis.flatMap(item => item.evidence))].filter(id => /^L[1-6]\.CHANGE$/.test(id));
  return {
    answer: '目前还不能确定事情会怎样发展，可以先明确目标，再用实际进展检查并调整安排。',
    reasons: [
      { text: '现有信息还不足以证明现实中已经发生了什么，也不能确定最后结果。', evidence: [candidateFactId, 'SCOPE'] },
      { text: '还有变化和限制需要核对，保持开放判断更合适。', evidence: ['SHI_YING', ...changes] }
    ],
    advice: ['先完成一个可以检查的小目标，再根据实际进展调整。', '补充具体背景后再评估，不把本次解读当作保证。'],
    limitations: '这只是传统文化视角的参考，不能替代现实信息，也不能保证结果。'
  };
}

function isPlain(request) {
  return !!request.messages?.[0]?.content?.startsWith('你是通俗解读编辑');
}

function isReview(request) {
  return !!request.messages?.[0]?.content?.startsWith('你是独立的六爻解读校核员');
}

function passingReview() {
  return JSON.stringify({ verdict: 'pass', issues: [] });
}

function groundedComplete(raw, { onCall = () => {} } = {}) {
  return async request => {
    onCall(request);
    if (isReview(request)) return passingReview();
    const draft = validDraft(typeof raw === 'function' ? raw() : raw);
    return JSON.stringify(isPlain(request) ? draft.plain : professionalDraft(draft));
  };
}

function groundedCompleteFromMessages({ onCall = () => {} } = {}) {
  return async request => {
    onCall(request);
    if (isReview(request)) return passingReview();
    if (isPlain(request)) {
      const input = JSON.parse(request.messages[1].content);
      const plain = plainForProfessional(input.professional);
      plain.limitations = '本地测试模拟回复，不是真实 AI 解读；这里只检查界面与流程，不代表预测结果。';
      return JSON.stringify(plain);
    }
    const marker = '\n程序核算事实表（id用于引用，候选仅为用神选择范围，不代表最终结论）：\n';
    const content = request.messages?.[1]?.content || '';
    const offset = content.lastIndexOf(marker);
    if (offset < 0) throw new Error('Grounded fixture requires the factual JSON generation prompt');
    const draft = draftForRules(JSON.parse(content.slice(offset + marker.length)));
    return JSON.stringify(professionalDraft(draft));
  };
}

module.exports = { payload, validDraft, professionalDraft, isPlain, isReview, passingReview, groundedComplete, groundedCompleteFromMessages };
