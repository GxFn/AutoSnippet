#!/usr/bin/env node

/**
 * 职责：
 * - 统一从不同来源构建 snippet 对象（answers + 文件/文本）
 * - 这是对 `bin/create.js` 中“snippet 组装逻辑”的下沉聚合点
 *
 * 说明：
 * - Phase 2 先提供最小能力（fromText），后续再逐步迁移 file/autosnippet:code 相关逻辑
 */

function escapeString(string) {
	if (typeof string !== 'string') return string;
	string = string.replace(/&/g, '&amp;');
	string = string.replace(/</g, '&lt;');
	string = string.replace(/>/g, '&gt;');
	return string;
}

function buildIdentifier(title, completionFirst, completionMoreStr) {
	const answersKeys = completionFirst + completionMoreStr + title;
	const answersIdBuff = Buffer.from(answersKeys, 'utf-8');
	return 'AutoSnip_' + answersIdBuff.toString('base64').replace(/\//g, '');
}

const triggerSymbol = require('../infra/triggerSymbol.js');

function fromText(answers, text, options = {}) {
	if (!text || !String(text).trim()) return null;

	const completionMoreStr = Array.isArray(answers.completion_more)
		? answers.completion_more.join('')
		: (answers.completion_more || '');

	// 如果有 explicit category 且不在 completionMoreStr 中，则添加
	let categoryPart = '';
	if (answers.category) {
		const cat = triggerSymbol.hasTriggerPrefix(answers.category) ? answers.category : triggerSymbol.TRIGGER_SYMBOL + answers.category;
		if (!completionMoreStr.includes(cat)) {
			categoryPart = cat;
		}
	}

	const identifier = buildIdentifier(answers.title, answers.completion_first, completionMoreStr + categoryPart);
	const isSwift = options && options.language === 'swift';

	const prefix = triggerSymbol.TRIGGER_SYMBOL;
	const snippet = {
		identifier: identifier,
		title: answers.title,
		trigger: prefix + answers.completion_first,
		completion: prefix + answers.completion_first + completionMoreStr + categoryPart,
		summary: answers.summary,
		languageShort: isSwift ? 'swift' : 'objc',
	};
	if (answers.link) {
		snippet.link = encodeURI(answers.link);
	}

	const raw = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	snippet.body = raw.split('\n').map((l) => escapeString(l));

	return snippet;
}

module.exports = {
	fromText
};

