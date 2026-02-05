const REQUIRED_CATEGORIES = ['View', 'Service', 'Tool', 'Model', 'Network', 'Storage', 'UI', 'Utility'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTrigger(value) {
  return isNonEmptyString(value) && value.trim().startsWith('@');
}

function isValidLanguage(value, { allowMarkdown } = {}) {
  if (!isNonEmptyString(value)) return false;
  const lang = value.trim().toLowerCase();
  if (allowMarkdown && lang === 'markdown') return true;
  return lang === 'swift' || lang === 'objectivec';
}

function validateHeaders(headers, { allowEmptyHeaders } = {}) {
  if (!headers || (Array.isArray(headers) && headers.length === 0)) {
  return allowEmptyHeaders ? [] : ['缺少 headers（完整 import 语句数组）'];
  }
  const list = Array.isArray(headers) ? headers : [headers];
  const invalid = list.filter(h => !isNonEmptyString(h) || (!h.trim().startsWith('import ') && !h.trim().startsWith('#import ')));
  if (invalid.length > 0) return ['headers 必须为完整 import 语句（Swift: import X / ObjC: #import <X/Y.h>）'];
  return [];
}

function validateRecipeCandidate(candidate, options = {}) {
  const errors = [];
  const warnings = [];
  const introOnly = Boolean(options.introOnly);
  const allowMarkdown = Boolean(options.allowMarkdown);

  if (!isNonEmptyString(candidate?.title)) errors.push('缺少 title');
  if (!isValidTrigger(candidate?.trigger)) errors.push('trigger 必须以 @ 开头');
  if (!isNonEmptyString(candidate?.category) || !REQUIRED_CATEGORIES.includes(candidate.category)) {
  errors.push(`category 必须为以下之一：${REQUIRED_CATEGORIES.join(', ')}`);
  }
  if (!isValidLanguage(candidate?.language, { allowMarkdown })) errors.push('language 必须为 swift 或 objectivec');
  if (!isNonEmptyString(candidate?.summary) && !isNonEmptyString(candidate?.summary_cn)) errors.push('缺少 summary/summary_cn');
  if (!introOnly && !isNonEmptyString(candidate?.code)) errors.push('缺少 code（非 intro-only 必填）');
  if (!isNonEmptyString(candidate?.usageGuide) && !isNonEmptyString(candidate?.usageGuide_cn)) warnings.push('缺少 usageGuide/usageGuide_cn');
  if (!isNonEmptyString(candidate?.summary_en)) warnings.push('缺少 summary_en');
  if (!isNonEmptyString(candidate?.usageGuide_en)) warnings.push('缺少 usageGuide_en');

  errors.push(...validateHeaders(candidate?.headers, { allowEmptyHeaders: introOnly }));

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  validateRecipeCandidate,
  REQUIRED_CATEGORIES
};
