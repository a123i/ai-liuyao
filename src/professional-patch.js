'use strict';
const { parseProfessional, qualityError } = require('./interpretation-contract');

function parseProfessionalPatch(raw, facts, previous, targets) {
  const fail = message => { throw qualityError('专业局部修复：' + message); };
  let patch = raw;
  if (typeof raw === 'string') {
    if (raw.length > 50000) fail('结果过长');
    try { patch = JSON.parse(raw); } catch { fail('结果不是完整JSON'); }
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).length !== 2 || !Object.hasOwn(patch, 'analysis') || !Object.hasOwn(patch, 'conclusion')) fail('仅允许analysis和conclusion字段');
  const required = new Set(targets);
  if ([...required].some(index => !Number.isInteger(index) || index < 0 || index >= previous.analysis.length)) fail('修复范围无效');
  if (!Array.isArray(patch.analysis) || patch.analysis.length !== required.size) fail('必须且只能修复指定分析段');
  const analysis = previous.analysis.map(item => ({ ...item, evidence: [...item.evidence] }));
  const seen = new Set();
  for (const item of patch.analysis) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 3 ||
        !['index', 'evidence', 'interpretation'].every(key => Object.hasOwn(item, key)) ||
        !required.has(item.index) || seen.has(item.index)) fail('分析段越界、重复或字段无效');
    seen.add(item.index);
    analysis[item.index] = { evidence: item.evidence, interpretation: item.interpretation };
  }
  // Revalidate the WHOLE merged professional result, not just the patch. This
  // preserves evidence coverage and rejects conclusions unsupported after edits.
  return parseProfessional({ ...previous, analysis, conclusion: patch.conclusion }, facts);
}

module.exports = { parseProfessionalPatch };
