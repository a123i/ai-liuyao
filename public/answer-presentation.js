(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LiuYaoAnswerPresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Presentation only. Never apply this to the structured draft, evidence
  // validation, provider review, stored history, or idempotency hashes.
  const TAGS = ['初', '二', '三', '四', '五', '上'];
  const META = {
    SHI_YING: '世应关系', CHART: '卦象结构', PALACE: '卦宫',
    CALENDAR: '起卦时间', SCOPE: '判读范围', QUESTION: '所问事项'
  };
  const SUFFIXES = {
    IDENTITY: '身份', MONTH: '月令条件', DAY: '日辰条件',
    VOID: '旬空状态', CHANGE: '动变关系', HIDDEN: '伏神'
  };
  const TOKEN = '(?:L[1-6](?:_L[1-6]|(?:\\.(?:C|F))?(?:\\.(?:IDENTITY|MONTH|DAY|VOID|CHANGE|HIDDEN))?)|SHI_YING|CHART|PALACE|CALENDAR|SCOPE|QUESTION)';
  const PURE_LIST = new RegExp('^' + TOKEN + '(?:\\s*[,，、;；|/]\\s*' + TOKEN + ')*$');
  const REFERENCES = new RegExp('(^|[^A-Za-z0-9_/@])(' + TOKEN + ')(?![A-Za-z0-9_@]|\\.[A-Za-z0-9_])', 'g');
  // URLs and mailboxes are user content, not rule identifiers. Split them out
  // so a legitimate /L3 path, QUESTION query key or L2@mailbox stays untouched.
  const PROTECTED = /(https?:\/\/[^\s<>"'，。；！？（）【】]+|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,})/gi;

  function isPureCitation(value) {
    const body = value.trim().replace(/^(?:依据|证据|引用|参考|事实编号|内部编号|编号|代码核定身份)\s*[:：]?\s*/, '');
    return PURE_LIST.test(body);
  }

  function chineseReference(id) {
    if (Object.hasOwn(META, id)) return META[id];
    const pair = /^L([1-6])_L([1-6])$/.exec(id);
    if (pair) return TAGS[Number(pair[1]) - 1] + '爻与' + TAGS[Number(pair[2]) - 1] + '爻关系';
    const line = /^L([1-6])(?:\.(C|F))?(?:\.(IDENTITY|MONTH|DAY|VOID|CHANGE|HIDDEN))?$/.exec(id);
    if (!line) return id;
    let label = TAGS[Number(line[1]) - 1] + '爻';
    if (line[2]) label += line[2] === 'F' ? '伏神' : '化爻';
    if (line[3]) label += (line[2] ? '的' : '') + SUFFIXES[line[3]];
    return label;
  }

  function formatSegment(value) {
    return value
      .replace(/[（(]([^（）()]*)[）)]/g, (all, body) => isPureCitation(body) ? '' : all)
      .replace(/\[([^\[\]\n]*)\]|【([^【】\n]*)】/g, (all, square, chinese) => isPureCitation(square === undefined ? chinese : square) ? '' : all)
      .replace(REFERENCES, (_all, prefix, id) => prefix + chineseReference(id));
  }

  function toDisplayAnswer(value) {
    if (typeof value !== 'string') return '';
    return value.split(PROTECTED).map((part, index) => index % 2 ? part : formatSegment(part)).join('');
  }

  return { toDisplayAnswer };
});
