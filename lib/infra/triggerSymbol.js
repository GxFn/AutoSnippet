#!/usr/bin/env node

/**
 * Snippet 触发符配置：支持灵活更换默认符号（如 @）。
 * - 默认使用 @，可通过环境变量 ASD_TRIGGER_SYMBOL 覆盖（单字符）。
 * - 仅支持配置的触发符，统一由此模块提供，不做其它符号的差别处理。
 */

const DEFAULT_SYMBOL = '@';

function fromEnv() {
	const raw = process.env.ASD_TRIGGER_SYMBOL;
	if (raw != null && String(raw).length === 1) return String(raw);
	return DEFAULT_SYMBOL;
}

/** 当前触发符（可配置） */
const TRIGGER_SYMBOL = fromEnv();

/** 用于拆分的触发符集合（仅当前配置的符号） */
const TRIGGER_SYMBOLS = [TRIGGER_SYMBOL];

/** 用于按触发符拆分的正则（如 completion 拆 category） */
const TRIGGER_SPLIT_REGEX = new RegExp('[' + TRIGGER_SYMBOLS.map(escapeRegExp).join('') + ']');

function escapeRegExp(s) {
	return s.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
}

/** str 是否以任一触发符开头 */
function hasTriggerPrefix(str) {
	if (!str || typeof str !== 'string') return false;
	const s = String(str).trim();
	return TRIGGER_SYMBOLS.some((sym) => s.startsWith(sym));
}

/** 去掉 str 开头的连续触发符 */
function stripTriggerPrefix(str) {
	if (!str || typeof str !== 'string') return String(str);
	let s = String(str).trim();
	while (s.length && TRIGGER_SYMBOLS.some((sym) => s.startsWith(sym))) {
		s = s.slice(1).trimStart();
	}
	return s;
}

/** 若 str 不以任一触发符开头，则加上默认触发符 */
function ensureTriggerPrefix(str) {
	if (!str || typeof str !== 'string') return str;
	const s = String(str).trim();
	if (!s) return s;
	return hasTriggerPrefix(s) ? s : TRIGGER_SYMBOL + s;
}

/** 若 str 已带触发符则返回该符号，否则返回默认触发符（用于 category 等） */
function getPrefixFromTrigger(str) {
	if (!str || typeof str !== 'string') return TRIGGER_SYMBOL;
	const s = String(str).trim();
	for (const sym of TRIGGER_SYMBOLS) {
		if (s.startsWith(sym)) return sym;
	}
	return TRIGGER_SYMBOL;
}

module.exports = {
	TRIGGER_SYMBOL,
	TRIGGER_SYMBOLS,
	TRIGGER_SPLIT_REGEX,
	hasTriggerPrefix,
	stripTriggerPrefix,
	ensureTriggerPrefix,
	getPrefixFromTrigger,
};
