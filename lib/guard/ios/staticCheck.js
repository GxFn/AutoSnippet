/**
 * iOS Guard 静态正则检查
 */

const { getGuardRules } = require('./defaultRules');
const { CODE_CHECK_RULE_IDS, runCodeChecks } = require('./codeChecks');

/**
 * 按语言筛选规则
 * @param {string} projectRoot
 * @param {string} language 'objc' | 'swift'
 */
function getRulesForLanguage(projectRoot, language) {
	const { rules } = getGuardRules(projectRoot);
	return Object.entries(rules).filter(([, r]) =>
		Array.isArray(r.languages) && r.languages.includes(language)
	);
}

/**
 * 对代码行运行静态规则，返回违反项
 * @param {string} projectRoot
 * @param {string} code 源代码全文
 * @param {string} language 'objc' | 'swift'
 * @param {string|null} [scope] 审查规模：'file'|'target'|'project' 时仅运行匹配 dimension 的规则；null 时运行全部
 * @returns {Array<{ ruleId: string, message: string, severity: string, line: number, snippet: string }>} 
 */
function runStaticCheck(projectRoot, code, language, scope) {
	const violations = runCodeChecks(projectRoot, code, language, scope);

	let entries = getRulesForLanguage(projectRoot, language);
	if (scope) {
		entries = entries.filter(([, r]) => !r.dimension || r.dimension === scope);
	}
	const lines = (code || '').split(/\r?\n/);
	for (const [ruleId, rule] of entries) {
		if (CODE_CHECK_RULE_IDS.includes(ruleId)) continue;
		let re;
		try {
			re = new RegExp(rule.pattern);
		} catch (_) {
			continue;
		}
		lines.forEach((line, i) => {
			if (!re.test(line)) return;
			violations.push({
				ruleId,
				message: rule.message || ruleId,
				severity: rule.severity || 'warning',
				line: i + 1,
				snippet: line.trim().slice(0, 120),
				...(rule.dimension ? { dimension: rule.dimension } : {})
			});
		});
	}

	if (language === 'objc' && (code || '').includes('addObserver')) {
		const hasRemove = /removeObserver/.test(code || '');
		if (!hasRemove) {
			const lineIndex = (code || '').split(/\r?\n/).findIndex(l => /addObserver/.test(l));
			const lineNum = lineIndex >= 0 ? lineIndex + 1 : 1;
			violations.push({
				ruleId: 'objc-kvo-missing-remove',
				message: '存在 addObserver 未发现配对 removeObserver（KVO 或 NSNotificationCenter），观察者未移除可能导致崩溃，请在 dealloc 或合适时机调用 removeObserver',
				severity: 'warning',
				line: lineNum,
				snippet: (lineIndex >= 0 ? (code || '').split(/\r?\n/)[lineIndex].trim() : '').slice(0, 120),
				dimension: 'file'
			});
		}
	}

	return violations;
}

module.exports = {
	getRulesForLanguage,
	runStaticCheck
};
