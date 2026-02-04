/**
 * iOS Guard 代码结构检查
 */

const { indexToLine } = require('./utils');

/**
 * 由代码判断（非纯正则）处理的规则 ID，这些规则在 runStaticCheck 中跳过正则，仅用 runCodeChecks 结果
 */
const CODE_CHECK_RULE_IDS = ['objc-init-return-nil', 'objc-block-retain-cycle'];

/**
 * 对正则不可靠的项做基于代码/结构的判断，返回违反项
 * @param {string} projectRoot
 * @param {string} code 源代码全文
 * @param {string} language 'objc' | 'swift'
 * @param {string|null} [scope]
 * @returns {Array<{ ruleId: string, message: string, severity: string, line: number, snippet: string, dimension?: string }>}
 */
function runCodeChecks(projectRoot, code, language, scope) {
	const violations = [];
	if (language !== 'objc') return violations;
	const lines = (code || '').split(/\r?\n/);

	// init 内 return nil 且未见 [super init]
	const returnNilLineIndices = [];
	lines.forEach((line, i) => {
		if (/\breturn\s+nil\b/.test(line)) returnNilLineIndices.push(i);
	});
	const initMethodStartRe = /^\s*[-+]\s*\([^)]+\)\s*.*\binit\b/;
	for (const lineIdx of returnNilLineIndices) {
		let methodStartLineIdx = -1;
		for (let k = lineIdx - 1; k >= 0; k--) {
			const trimmed = lines[k].trim();
			if (initMethodStartRe.test(trimmed)) {
				methodStartLineIdx = k;
				break;
			}
			if (/^\s*[-+]\s*\(/.test(trimmed) || /^\s*@(interface|implementation)\s/.test(trimmed)) break;
		}
		if (methodStartLineIdx < 0) continue;
		const between = lines.slice(methodStartLineIdx + 1, lineIdx);
		if (between.some(l => /^\s*[-+]\s*\(/.test(l.trim()))) continue;
		const slice = lines.slice(methodStartLineIdx, lineIdx + 1).join('\n');
		if (/\[super\s+init\]|self\s*=\s*\[super\s+init\]|\[self\s+initWith\S*\]|self\s*=\s*\[self\s+initWith\S*\]/.test(slice)) continue;
		const snippet = lines[lineIdx].trim().slice(0, 120);
		violations.push({
			ruleId: 'objc-init-return-nil',
			message: 'init 方法中 return nil 前应有 [super init] 或 self = [super init]，请人工确认',
			severity: 'warning',
			line: lineIdx + 1,
			snippet,
			dimension: 'file'
		});
	}

	// Block 内直接 self. 且块内无 __weak/weakSelf
	const reportedBlockLines = new Set();
	const gcdBlockPrefixRe = /\bdispatch_(async|sync|after|once|group_async|barrier_async)\s*\(/;
	let i = 0;
	const codeStr = code || '';
	while (i < codeStr.length) {
		const blockStart = codeStr.indexOf('^{', i);
		if (blockStart === -1) break;
		const braceStart = codeStr.indexOf('{', blockStart);
		const braceEnd = findMatchingBrace(codeStr, braceStart);
		if (braceEnd === -1) break;
		const body = codeStr.slice(braceStart + 1, braceEnd);
		if (/\bself\s*\./.test(body) && !/__weak|weakSelf/.test(body)) {
			const beforeBlock = codeStr.slice(Math.max(0, blockStart - 400), blockStart).replace(/\s+/g, ' ');
			if (gcdBlockPrefixRe.test(beforeBlock) && /,\s*$/.test(beforeBlock)) {
				i = braceEnd + 1;
				continue;
			}
			if (/\b\w*GCD\w*(SYNC|ASYNC)\w*\s*\(\s*$/.test(beforeBlock)) {
				i = braceEnd + 1;
				continue;
			}
			if (/\b(animations|completion)\s*:\s*$/.test(beforeBlock)) {
				i = braceEnd + 1;
				continue;
			}
			if (/,\s*$/.test(beforeBlock) && /\b(enumerateObjectsUsingBlock|enumerateKeysAndObjectsUsingBlock|enumerateIndexesUsingBlock|performWithoutAnimation|addOperationWithBlock)\s*:\s*$/.test(beforeBlock)) {
				i = braceEnd + 1;
				continue;
			}
			const selfMatch = body.match(/\bself\s*\./);
			const offsetInBody = selfMatch ? selfMatch.index : 0;
			const lineNum = indexToLine(codeStr, braceStart + 1 + offsetInBody);
			if (reportedBlockLines.has(lineNum)) { i = braceEnd + 1; continue; }
			reportedBlockLines.add(lineNum);
			const lineContent = lines[lineNum - 1];
			violations.push({
				ruleId: 'objc-block-retain-cycle',
				message: 'block 内直接使用 self 可能循环引用，建议 __weak typeof(self) weakSelf = self 或 weakSelf.xxx',
				severity: 'warning',
				line: lineNum,
				snippet: (lineContent || '').trim().slice(0, 120),
				dimension: 'file'
			});
		}
		i = braceEnd + 1;
	}

	// copy 修饰的自定义类型须实现 NSCopying
	const copyCustomTypeRe = /@property\s*\([^)]*\bcopy\b[^)]*\)[^;]*\s+(\w+)\s*\*/;
	const copyKnownTypes = new Set(['MASConstraint']);
	const isInsideMacOnlyBlock = (lineIndex) => {
		for (let k = lineIndex - 1; k >= 0 && k >= lineIndex - 20; k--) {
			const prev = lines[k].trim();
			if (/^\s*#\s*endif/.test(prev)) break;
			if (/^\s*#\s*if\b/.test(prev) && /TARGET_OS_MAC/.test(prev) && /!?\s*\(\s*TARGET_OS_IPHONE/.test(prev)) return true;
		}
		return false;
	};
	lines.forEach((line, i) => {
		const m = line.match(copyCustomTypeRe);
		if (!m) return;
		const typeName = m[1];
		if (typeName === 'id' || typeName.startsWith('NS')) return;
		if (/\*\s*\(\s*\^|\(\s*\^/.test(line)) return;
		if (copyKnownTypes.has(typeName)) return;
		if (isInsideMacOnlyBlock(i)) return;
		violations.push({
			ruleId: 'objc-copy-custom-type',
			message: 'copy 修饰的自定义类型须实现 NSCopying（copyWithZone:），否则 setter 可能崩溃；系统类型（NS 前缀）已实现可忽略',
			severity: 'warning',
			line: i + 1,
			snippet: line.trim().slice(0, 120),
			dimension: 'file'
		});
	});

	return violations;
}

/**
 * 从 code 的 startIndex 起找到与 '{' 配对的 '}' 的下标（忽略字符串内括号的简单实现）
 * @param {string} code
 * @param {number} startIndex 指向 '{' 的下标
 * @returns {number} 匹配的 '}' 下标，未找到返回 -1
 */
function findMatchingBrace(code, startIndex) {
	let depth = 0;
	for (let i = startIndex; i < code.length; i++) {
		const c = code[i];
		if (c === '{') depth++;
		else if (c === '}') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

module.exports = {
	CODE_CHECK_RULE_IDS,
	runCodeChecks
};
