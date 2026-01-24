#!/usr/bin/env node

/**
 * 职责：
 * - 解析 autosnippet 指令（include/import）
 * - 提供 ObjC 头文件指令解析为结构化 header 对象
 * - 提供“是否为指令行”的判断（用于移除标记行）
 */

const HEADER_MARK_INCLUDE = '// autosnippet:include ';
const HEADER_MARK_IMPORT = '// autosnippet:import ';
const HEADER_MARK_INCLUDE_SHORT = '// as:include ';
const HEADER_MARK_IMPORT_SHORT = '// as:import ';

function normalizeDirectiveLine(line) {
	// 有些 Swift snippet 会把注释行写成 `@// as:import X`（保留 @ 前缀）
	// 这里统一兼容：去掉前导 @ 和空白
	return String(line || '').trim().replace(/^@+/, '').trimStart();
}

function parseDirectiveLine(line) {
	const t = normalizeDirectiveLine(line);
	if (t.startsWith(HEADER_MARK_INCLUDE)) {
		return { kind: 'include', content: t.slice(HEADER_MARK_INCLUDE.length).trim() };
	}
	if (t.startsWith(HEADER_MARK_IMPORT)) {
		return { kind: 'import', content: t.slice(HEADER_MARK_IMPORT.length).trim() };
	}
	if (t.startsWith(HEADER_MARK_INCLUDE_SHORT)) {
		return { kind: 'include', content: t.slice(HEADER_MARK_INCLUDE_SHORT.length).trim() };
	}
	if (t.startsWith(HEADER_MARK_IMPORT_SHORT)) {
		return { kind: 'import', content: t.slice(HEADER_MARK_IMPORT_SHORT.length).trim() };
	}
	return { kind: 'unknown', content: t };
}

function isDirectiveMarkLine(line) {
	const t = normalizeDirectiveLine(line);
	return t.startsWith(HEADER_MARK_INCLUDE) || t.startsWith(HEADER_MARK_IMPORT)
		|| t.startsWith(HEADER_MARK_INCLUDE_SHORT) || t.startsWith(HEADER_MARK_IMPORT_SHORT);
}

function createHeader(headerLine) {
	// ObjC 指令格式：
	// - // autosnippet:include <Module/Header.h> [relative/path/to/Header.h]
	const parsed = parseDirectiveLine(headerLine);
	const content = (parsed && parsed.content) ? parsed.content : '';

	// 匹配 <Module/Header.h> 以及可选的相对路径
	// ObjC 头文件名常见包含 `+`（Category）、`-`、`.` 等字符
	const match = content.match(/^<([A-Za-z0-9_]+)\/([A-Za-z0-9_+.-]+\.h)>(?:\s+(.+))?$/);
	if (!match) return null;

	const moduleName = match[1];
	const headerName = match[2];
	const headRelativePathFromMark = match[3] || null;

	return {
		name: `<${moduleName}/${headerName}>`,
		specName: `<${moduleName}/${headerName}>`,
		moduleName: moduleName,
		headerName: headerName,
		moduleStrName: `"${moduleName}.h"`,
		headerStrName: `"${headerName}"`,
		headRelativePathFromMark: headRelativePathFromMark,
	};
}

module.exports = {
	HEADER_MARK_INCLUDE,
	HEADER_MARK_IMPORT,
	parseDirectiveLine,
	isDirectiveMarkLine,
	createHeader,
};

