#!/usr/bin/env node

/**
 * 候选自动质量评估（仅用于排序，不展示）
 * 综合完整度、格式规范、代码质量等维度给出 0~1 分数，分数越高排序越靠前
 */

function evaluateCandidate(candidate) {
	if (!candidate || typeof candidate !== 'object') return 0;

	let score = 0;
	const weights = { completeness: 0.35, format: 0.25, codeQuality: 0.25, metadata: 0.15 };

	// 1. 完整度：必填项是否齐全
	const hasTitle = !!String(candidate.title || '').trim();
	const hasTrigger = !!String(candidate.trigger || '').trim();
	const hasCode = !!String(candidate.code || '').trim();
	const hasUsageGuide = !!String(candidate.usageGuide || '').trim();
	const completeness = (hasTitle ? 0.25 : 0) + (hasTrigger ? 0.25 : 0) + (hasCode ? 0.3 : 0) + (hasUsageGuide ? 0.2 : 0);
	score += weights.completeness * completeness;

	// 2. 格式规范：trigger 格式、category 等
	let formatScore = 1;
	if (candidate.trigger && !/^@?[\w-]+$/.test(String(candidate.trigger).trim())) {
		formatScore -= 0.2; // trigger 应简洁
	}
	if (candidate.language && !['objc', 'swift', 'oc', 'javascript', 'typescript', 'json'].includes(String(candidate.language).toLowerCase())) {
		formatScore -= 0.1; // 非常见语言不减分，仅作提示
	}
	score += weights.format * Math.max(0, formatScore);

	// 3. 代码质量：长度、占位符
	let codeScore = 1;
	if (hasCode) {
		const codeLen = String(candidate.code).length;
		if (codeLen < 20) codeScore -= 0.3;       // 过短可能不完整
		else if (codeLen > 5000) codeScore -= 0.2; // 过长可能不宜作为 snippet
		// 占位符检测
		if (/TODO|FIXME|xxx|\.\.\.|\[\]|___/i.test(candidate.code)) codeScore -= 0.15;
	}
	score += weights.codeQuality * Math.max(0, codeScore);

	// 4. metadata：category、headers 等加分
	let metaScore = 0.5; // 默认半分
	if (candidate.category) metaScore += 0.2;
	if (candidate.headers && Array.isArray(candidate.headers) && candidate.headers.length > 0) metaScore += 0.2;
	if (candidate.summary && String(candidate.summary).length > 10) metaScore += 0.1;
	score += weights.metadata * Math.min(1, metaScore);

	return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}

module.exports = {
	evaluateCandidate
};
