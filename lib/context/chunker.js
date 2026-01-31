#!/usr/bin/env node

/**
 * 上下文存储 - 分块器
 * 对外接口：chunk(content, metadata, options) => [{ content, metadata }]
 *
 * 策略：
 *   whole   - 整篇：content 长度 < maxChunkTokens 则单条返回
 *   section - 按章节：Markdown 按 ## 切分，每块带 sectionTitle
 *   fixed   - 固定长度：按 maxChunkTokens 切块，overlap
 *   auto    - 自动：短则整篇；有 ## 则按章节；否则固定长度
 */

const defaults = require('../infra/defaults');

function estimateTokens(text) {
	return Math.ceil((text || '').length / defaults.CHARS_PER_TOKEN);
}

function getMaxChars(options) {
	const tokens = options.maxChunkTokens ?? defaults.DEFAULT_MAX_CHUNK_TOKENS;
	return tokens * defaults.CHARS_PER_TOKEN;
}

function getOverlapChars(options) {
	const tokens = options.overlapTokens ?? defaults.DEFAULT_OVERLAP_TOKENS;
	return tokens * defaults.CHARS_PER_TOKEN;
}

/**
 * 整篇：不切分，单条返回
 */
function chunkWhole(content, baseMetadata, options) {
	return [{
		content: content,
		metadata: {
			...baseMetadata,
			chunkIndex: 0,
			sectionTitle: undefined
		}
	}];
}

/**
 * 按 Markdown ## 章节切分
 */
function chunkBySection(content, baseMetadata, options) {
	const sections = [];
	const lines = content.split('\n');
	let currentTitle = '';
	let currentLines = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headerMatch && headerMatch[1] === '##') {
			if (currentLines.length > 0) {
				sections.push({
					title: currentTitle,
					content: currentLines.join('\n').trim()
				});
			}
			currentTitle = headerMatch[2].trim();
			currentLines = [line];
		} else {
			currentLines.push(line);
		}
	}
	if (currentLines.length > 0) {
		sections.push({
			title: currentTitle,
			content: currentLines.join('\n').trim()
		});
	}

	const maxChars = getMaxChars(options);
	const overlapChars = getOverlapChars(options);
	const result = [];

	for (let i = 0; i < sections.length; i++) {
		const { title, content: secContent } = sections[i];
		if (!secContent) continue;

		if (estimateTokens(secContent) <= (options.maxChunkTokens ?? defaults.DEFAULT_MAX_CHUNK_TOKENS)) {
			result.push({
				content: secContent,
				metadata: {
					...baseMetadata,
					chunkIndex: i,
					sectionTitle: title || undefined
				}
			});
		} else {
			const subChunks = chunkFixed(secContent, options);
			for (let j = 0; j < subChunks.length; j++) {
				result.push({
					content: subChunks[j],
					metadata: {
						...baseMetadata,
						chunkIndex: result.length,
						sectionTitle: title || undefined
					}
				});
			}
		}
	}

	return result.length > 0 ? result : chunkWhole(content, baseMetadata, options);
}

/**
 * 固定长度切块（带 overlap）
 */
function chunkFixed(content, options) {
	const maxChars = getMaxChars(options);
	const overlapChars = Math.min(getOverlapChars(options), maxChars - 1);
	const chunks = [];
	let start = 0;

	while (start < content.length) {
		let end = Math.min(start + maxChars, content.length);
		if (end < content.length) {
			const lastSpace = content.lastIndexOf(' ', end);
			const lastNewline = content.lastIndexOf('\n', end);
			const breakPoint = Math.max(lastNewline, lastSpace, start);
			if (breakPoint > start) {
				end = breakPoint + 1;
			}
		}
		chunks.push(content.slice(start, end).trim());
		if (end >= content.length) break;
		start = Math.max(0, end - overlapChars);
		if (start >= end) break;
	}

	return chunks.filter(Boolean);
}

/**
 * 固定长度策略：产出多条 { content, metadata }
 */
function chunkByFixed(content, baseMetadata, options) {
	const chunks = chunkFixed(content, options);
	return chunks.map((c, i) => ({
		content: c,
		metadata: {
			...baseMetadata,
			chunkIndex: i,
			sectionTitle: undefined
		}
	}));
}

/**
 * 主入口：chunk(content, metadata, options) => [{ content, metadata }]
 *
 * @param {string} content 原文
 * @param {Object} metadata 基础 metadata（sourcePath, type, category, module 等）
 * @param {Object} options
 *   strategy?: 'whole'|'section'|'fixed'|'auto'
 *   maxChunkTokens?: number 默认 800
 *   overlapTokens?: number 默认 80
 * @returns {{ content: string, metadata: Object }[]}
 */
function chunk(content, metadata = {}, options = {}) {
	const baseMetadata = { ...metadata };
	const strategy = options.strategy || 'auto';
	const maxTokens = options.maxChunkTokens ?? defaults.DEFAULT_MAX_CHUNK_TOKENS;
	const tokens = estimateTokens(content);

	if (strategy === 'whole' || (strategy === 'auto' && tokens <= maxTokens)) {
		return chunkWhole(content, baseMetadata, options);
	}

	if (strategy === 'section' || (strategy === 'auto' && content.includes('##'))) {
		const sections = content.split(/\n(?=##\s)/);
		if (sections.length > 1) {
			return chunkBySection(content, baseMetadata, options);
		}
	}

	if (strategy === 'fixed' || strategy === 'auto') {
		return chunkByFixed(content, baseMetadata, options);
	}

	return chunkWhole(content, baseMetadata, options);
}

module.exports = {
	chunk,
	estimateTokens,
	DEFAULT_MAX_CHUNK_TOKENS: defaults.DEFAULT_MAX_CHUNK_TOKENS,
	DEFAULT_OVERLAP_TOKENS: defaults.DEFAULT_OVERLAP_TOKENS,
	CHARS_PER_TOKEN: defaults.CHARS_PER_TOKEN
};
