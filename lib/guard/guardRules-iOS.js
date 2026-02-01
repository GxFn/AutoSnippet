/**
 * guardRules-iOS：仅负责 iOS（objc/swift）的规则与审计
 * 统一接入在 lib/guard/guardRules.js，其他语言新增独立文件（如 guardRules-Android.js）并在 guardRules.js 中注册即可
 * 规则源：Knowledge/.autosnippet/guard-rules.json；审核能力按语言对接（AUDIT_BY_LANGUAGE）
 */

const fs = require('fs');
const path = require('path');

const RULES_FILENAME = 'guard-rules.json';
const SCHEMA_VERSION = 1;

/** 仅用于首次创建 guard-rules.json 时的初始内容，之后以 JSON 文件为准 */
const DEFAULT_RULES = {
	'no-main-thread-sync': {
		message: '禁止在主线程上使用 dispatch_sync(main)，易死锁',
		severity: 'error',
		pattern: 'dispatch_sync\\s*\\([^)]*main',
		languages: ['objc', 'swift'],
		dimension: 'file'
	},
	'main-thread-sync-swift': {
		message: '禁止在主线程上使用 DispatchQueue.main.sync，易死锁',
		severity: 'error',
		pattern: 'DispatchQueue\\.main\\.sync',
		languages: ['swift'],
		dimension: 'file'
	},
	'ui-off-main-objc': {
		message: 'UIKit/UI 相关调用应在主线程执行',
		severity: 'warning',
		pattern: '(UIView|UIApplication|UILabel|UIButton)\\.(alloc|init|new)|\\[UIApplication sharedApplication\\]',
		languages: ['objc'],
		note: '仅作简单模式提示，实际是否在主线程需运行时或更复杂静态分析',
		dimension: 'file'
	},
	'ui-off-main-swift': {
		message: 'UIKit/UI 相关调用应在主线程执行',
		severity: 'warning',
		pattern: 'UIView\\.init|UIApplication\\.shared|UILabel\\(|UIButton\\(',
		languages: ['swift'],
		note: '仅作简单模式提示；DispatchQueue.main.async 为正确用法，已排除避免误报',
		dimension: 'file'
	},
	'objc-dealloc-async': {
		message: 'dealloc 内禁止使用 dispatch_async/dispatch_after/postNotification/performSelector:afterDelay: 等，对象释放后回调易崩溃',
		severity: 'error',
		pattern: '(dealloc.*(dispatch_async|dispatch_after|postNotification|performSelector.*afterDelay))|((dispatch_async|dispatch_after|postNotification|performSelector.*afterDelay).*dealloc)',
		languages: ['objc'],
		note: '匹配 dealloc 与异步/通知同一行或相邻行；完整方法体需人工确认',
		dimension: 'file'
	},
	'objc-nested-dispatch-sync': {
		message: '同一行内嵌套 dispatch_sync，易死锁',
		severity: 'error',
		pattern: 'dispatch_sync\\s*\\([^)]*\\).*dispatch_sync',
		languages: ['objc'],
		dimension: 'file'
	},
	'objc-synchronized-dispatch-sync': {
		message: '@synchronized 块内使用 dispatch_sync 易死锁',
		severity: 'warning',
		pattern: '@synchronized.*dispatch_sync|dispatch_sync.*@synchronized',
		languages: ['objc'],
		note: '仅匹配同一行内同时出现',
		dimension: 'file'
	},
	// init 里 return nil 前应有 [super init]（由代码判断执行，正则仅占位）
	'objc-init-return-nil': {
		message: 'init 方法中 return nil 前应有 [super init] 或 self = [super init]，请人工确认',
		severity: 'warning',
		pattern: '(?!)',
		languages: ['objc'],
		note: '由代码判断执行（方法范围内检查 super init），不依赖正则',
		dimension: 'file'
	},
	// 主队列/回调中再次 dispatch_sync（易死锁）
	'objc-main-callback-dispatch-sync': {
		message: '主队列或 completion 回调中再次 dispatch_sync 易死锁，请确认目标队列非当前队列',
		severity: 'warning',
		pattern: '(completion|onMain|mainQueue).*dispatch_sync|dispatch_sync.*(completion|onMain|mainQueue)',
		languages: ['objc'],
		note: '约定命名或注释为主队列回调时，同语境下慎用 dispatch_sync；仅匹配同一行',
		dimension: 'file'
	},
	// 锁内禁止 wait/sleep 等阻塞
	'objc-synchronized-wait-sleep': {
		message: '锁内禁止 sleep/wait 等阻塞调用，易死锁或性能问题',
		severity: 'warning',
		pattern: '@synchronized.*(sleep\\s*\\(|dispatch_wait|pthread_cond_wait)|(sleep\\s*\\(|dispatch_wait|pthread_cond_wait).*@synchronized',
		languages: ['objc'],
		note: '仅匹配同一行内 @synchronized 与 wait/sleep',
		dimension: 'file'
	},
	// 可变容器 + 多线程提示
	'objc-mutable-container-multithread': {
		message: '可变容器与多线程同时出现，可能需加锁或使用线程安全结构',
		severity: 'warning',
		pattern: '(NSMutableArray|NSMutableDictionary)[^;]*(dispatch_async|dispatch_sync)|(dispatch_async|dispatch_sync)[^;]*(NSMutableArray|NSMutableDictionary)',
		languages: ['objc'],
		note: '仅匹配同一行；同文件不同行请人工审查',
		dimension: 'file'
	},
	// 主线程阻塞/耗时操作提示（sleep、usleep 等）
	'objc-possible-main-thread-blocking': {
		message: 'sleep/usleep 可能造成主线程阻塞，请确认不在主线程或改用异步',
		severity: 'warning',
		pattern: '\\b(sleep|usleep)\\s*\\(',
		languages: ['objc'],
		note: '仅作可能主线程提示；若在后台线程可忽略',
		dimension: 'file'
	},
	// Block 循环引用启发式：block 内直接 self. 且未 weakify（由代码判断执行，正则仅占位）
	'objc-block-retain-cycle': {
		message: 'block 内直接使用 self 可能循环引用，建议 __weak typeof(self) weakSelf = self 或 weakSelf.xxx',
		severity: 'warning',
		pattern: '(?!)',
		languages: ['objc'],
		note: '由代码判断执行（^{ ... } 块内检查 weakify），不依赖正则',
		dimension: 'file'
	},
	// NSTimer 以 self 为 target 会强引用 self，需在适当时机 invalidate
	'objc-timer-retain-cycle': {
		message: 'NSTimer 以 self 为 target 会强引用 self，需在 dealloc 前 invalidate 或使用 block 形式',
		severity: 'warning',
		pattern: '(scheduledTimerWithTimeInterval|timerWithTimeInterval)[^;]*target\\s*:\\s*self|target\\s*:\\s*self[^;]*(scheduledTimerWithTimeInterval|timerWithTimeInterval)',
		languages: ['objc'],
		note: '仅匹配同一行内 timer 与 target:self',
		dimension: 'file'
	},
	// assign 用于对象类型会产生悬垂指针，对象释放后访问会崩溃
	'objc-assign-object': {
		message: 'assign 用于对象类型会产生悬垂指针，对象释放后访问会崩溃，建议改为 weak（如 delegate）或 strong',
		severity: 'warning',
		pattern: '@property\\s*\\([^)]*\\bassign\\b[^)]*\\)[^;]*(\\*|id\\s*<|\\bid\\s+)',
		languages: ['objc'],
		note: '仅匹配同一行；assign 用于基本类型（int/BOOL 等）是合法的',
		dimension: 'file'
	},
	// copy 修饰 id 须确保运行时对象实现 NSCopying
	'objc-copy-id': {
		message: 'id 使用 copy 须确保对象实现 NSCopying（copyWithZone:），否则 setter 可能崩溃',
		severity: 'warning',
		pattern: '@property\\s*\\([^)]*\\bcopy\\b[^)]*\\)[^;]*(id\\s*<|\\bid\\s+)',
		languages: ['objc'],
		note: '仅匹配同一行',
		dimension: 'file'
	},
	// Swift 强制类型转换 as! 在失败时崩溃
	'swift-force-cast': {
		message: '强制类型转换 as! 在失败时崩溃，建议 as? 或 guard let',
		severity: 'warning',
		pattern: 'as\\s*!',
		languages: ['swift'],
		note: '仅作提示，部分 as! 在上下文保证非 nil 时可接受',
		dimension: 'file'
	},
	// Swift try! 在异常时崩溃
	'swift-force-try': {
		message: 'try! 在异常时崩溃，建议 do-catch 或 try?',
		severity: 'warning',
		pattern: 'try\\s*!',
		languages: ['swift'],
		note: '仅作提示',
		dimension: 'file'
	},
	// KVO/NSNotificationCenter 有 addObserver 无 removeObserver（由代码判断执行，正则仅占位）
	'objc-kvo-missing-remove': {
		message: '存在 addObserver 未发现配对 removeObserver（KVO 或 NSNotificationCenter），观察者未移除可能导致崩溃，请在 dealloc 或合适时机调用 removeObserver',
		severity: 'warning',
		pattern: '(?!)',
		languages: ['objc'],
		note: '由代码判断执行（文件级扫描），不依赖正则',
		dimension: 'file'
	},
	// copy 修饰的自定义类型须实现 NSCopying（由代码判断执行，正则仅占位）
	'objc-copy-custom-type': {
		message: 'copy 修饰的自定义类型须实现 NSCopying（copyWithZone:），否则 setter 可能崩溃；系统类型（NS 前缀）已实现可忽略',
		severity: 'warning',
		pattern: '(?!)',
		languages: ['objc'],
		note: '由代码判断执行（非 NS 前缀类型检测），不依赖正则',
		dimension: 'file'
	}
};

function getRulesPath(projectRoot) {
	return path.join(projectRoot, 'Knowledge', '.autosnippet', RULES_FILENAME);
}

function ensureDir(projectRoot) {
	const dir = path.join(projectRoot, 'Knowledge', '.autosnippet');
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * 以 guard-rules.json 为唯一规则源：存在则只读该文件；不存在则用默认规则生成该文件
 * @param {string} projectRoot
 * @returns {{ schemaVersion: number, rules: Record<string, { message: string, severity: string, pattern: string, languages: string[], note?: string }> }}
 */
function getGuardRules(projectRoot) {
	const p = getRulesPath(projectRoot);
	try {
		if (!fs.existsSync(p)) {
			ensureDir(projectRoot);
			fs.writeFileSync(p, JSON.stringify({
				schemaVersion: SCHEMA_VERSION,
				rules: DEFAULT_RULES
			}, null, 2), 'utf8');
			return { schemaVersion: SCHEMA_VERSION, rules: { ...DEFAULT_RULES } };
		}
		const raw = fs.readFileSync(p, 'utf8');
		const data = JSON.parse(raw);
		if (data.schemaVersion !== SCHEMA_VERSION || !data.rules || typeof data.rules !== 'object') {
			return { schemaVersion: SCHEMA_VERSION, rules: { ...DEFAULT_RULES } };
		}
		return { schemaVersion: SCHEMA_VERSION, rules: data.rules };
	} catch (_) {
		ensureDir(projectRoot);
		fs.writeFileSync(p, JSON.stringify({
			schemaVersion: SCHEMA_VERSION,
			rules: DEFAULT_RULES
		}, null, 2), 'utf8');
		return { schemaVersion: SCHEMA_VERSION, rules: { ...DEFAULT_RULES } };
	}
}

/**
 * 新增或更新一条规则并写回 guard-rules.json（Dashboard / AI 写入规则用）
 * @param {string} projectRoot
 * @param {string} ruleId 规则 ID，英文如 my-rule
 * @param {{ message: string, severity: string, pattern: string, languages: string[], note?: string, dimension?: 'file'|'target'|'project' }} rule
 */
function addOrUpdateRule(projectRoot, ruleId, rule) {
	if (!ruleId || typeof rule !== 'object' || !rule.message || !rule.severity || !rule.pattern || !rule.languages) {
		throw new Error('ruleId、message、severity、pattern、languages 为必填');
	}
	const id = String(ruleId).trim().replace(/\s+/g, '-');
	const languages = Array.isArray(rule.languages) ? rule.languages : [rule.languages].filter(Boolean);
	if (languages.length === 0) languages.push('objc');
	const entry = {
		message: String(rule.message).trim(),
		severity: rule.severity === 'error' ? 'error' : 'warning',
		pattern: String(rule.pattern).trim(),
		languages,
		...(rule.note != null && rule.note !== '' ? { note: String(rule.note).trim() } : {}),
		...(rule.dimension === 'file' || rule.dimension === 'target' || rule.dimension === 'project' ? { dimension: rule.dimension } : {})
	};
	const p = getRulesPath(projectRoot);
	const data = getGuardRules(projectRoot);
	const rules = { ...(data.rules || {}), [id]: entry };
	ensureDir(projectRoot);
	fs.writeFileSync(p, JSON.stringify({
		schemaVersion: SCHEMA_VERSION,
		rules
	}, null, 2), 'utf8');
	return { ruleId: id, rule: entry };
}

/**
 * 由代码判断（非纯正则）处理的规则 ID，这些规则在 runStaticCheck 中跳过正则，仅用 runCodeChecks 结果
 */
const CODE_CHECK_RULE_IDS = ['objc-init-return-nil', 'objc-block-retain-cycle'];

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

/**
 * 将 code 中的字符下标转换为行号（从 1 开始）
 * @param {string} code
 * @param {number} index
 * @returns {number}
 */
function indexToLine(code, index) {
	const before = (code || '').slice(0, Math.max(0, index));
	const n = (before.match(/\r?\n/g) || []).length;
	return n + 1;
}

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

	// init 内 return nil 且未见 [super init]：按“方法”范围判断
	const returnNilLineIndices = [];
	lines.forEach((line, i) => {
		if (/\breturn\s+nil\b/.test(line)) returnNilLineIndices.push(i);
	});
	// 匹配 - (xxx) init... 或 - (xxx) initWithXxx: 等 init 方法声明行
	const initMethodStartRe = /^\s*[-+]\s*\([^)]+\)\s*.*\binit\b/;
	for (const lineIdx of returnNilLineIndices) {
		let methodStartLineIdx = -1;
		for (let k = lineIdx - 1; k >= 0; k--) {
			const trimmed = lines[k].trim();
			if (initMethodStartRe.test(trimmed)) {
				methodStartLineIdx = k;
				break;
			}
			// 遇到上一个方法或 @interface 则停止
			if (/^\s*[-+]\s*\(/.test(trimmed) || /^\s*@(interface|implementation)\s/.test(trimmed)) break;
		}
		if (methodStartLineIdx < 0) continue;
		// 若 init 声明与 return nil 之间还有其它方法声明，则该 return nil 不属于该 init，跳过
		const between = lines.slice(methodStartLineIdx + 1, lineIdx);
		if (between.some(l => /^\s*[-+]\s*\(/.test(l.trim()))) continue;
		const slice = lines.slice(methodStartLineIdx, lineIdx + 1).join('\n');
		// 有 [super init] 或委托初始化 [self initWith...] 则视为已处理
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

	// Block 内直接 self. 且块内无 __weak/weakSelf：按 ^{ ... } 范围判断；排除仅传给 GCD 的 block（dispatch_async 等不持有 block，无循环引用）
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
			// 若该 block 是作为参数直接传给 dispatch_async / dispatch_sync / dispatch_once 等或 GCD 封装宏（如 BBA_GCD_SYNC_MAIN），不报（GCD 不持有 block 形成环）
			const beforeBlock = codeStr.slice(Math.max(0, blockStart - 400), blockStart).replace(/\s+/g, ' ');
			if (gcdBlockPrefixRe.test(beforeBlock) && /,\s*$/.test(beforeBlock)) {
				i = braceEnd + 1;
				continue;
			}
			if (/\b\w*GCD\w*(SYNC|ASYNC)\w*\s*\(\s*$/.test(beforeBlock)) {
				i = braceEnd + 1;
				continue;
			}
			// UIView/UIViewController 等 animations: / completion: 等参数仅临时持有 block，不形成环
			if (/\b(animations|completion)\s*:\s*$/.test(beforeBlock)) {
				i = braceEnd + 1;
				continue;
			}
			// 枚举、无动画、NSOperation 等一次性执行后即释放的 block，不形成环
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

	// copy 修饰的自定义类型须实现 NSCopying，否则 setter 会崩溃（系统 NS 前缀类型通常已实现）
	const copyCustomTypeRe = /@property\s*\([^)]*\bcopy\b[^)]*\)[^;]*\s+(\w+)\s*\*/;
	// 已知实现 NSCopying 或第三方类型（不在此规则内报）
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
		// 属性类型为 block（如 BDPContext *(^context)(void)）：copy 的是 block，不需 NSCopying
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
	// 先跑“代码判断”：对正则不可靠的规则用结构/范围分析
	const violations = runCodeChecks(projectRoot, code, language, scope);

	let entries = getRulesForLanguage(projectRoot, language);
	if (scope) {
		entries = entries.filter(([, r]) => !r.dimension || r.dimension === scope);
	}
	const lines = (code || '').split(/\r?\n/);
	for (const [ruleId, rule] of entries) {
		// 已由 runCodeChecks 处理的规则不再用正则，避免重复与误报
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
	// KVO 文件级检查：有 addObserver 无 removeObserver 时提示（静态难做全，仅简单扫描）；含 bd_removeObserver 等封装方法名视为有 remove
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

/**
 * 审查维度：同文件 / 同 target / 同项目，各维度审查不同范围的违反。
 * 违反项可选带 dimension，便于区分与筛选。
 *
 * 当前各规则在各维度的审查：
 * - objc-duplicate-category
 *   - file:  同一文件内 ClassName(CategoryName) 出现多次
 *   - target: 同一 SPM target 内多文件或同文件多处出现
 *   - project: 整个项目内多文件或同文件多处出现
 */
const AUDIT_DIMENSIONS = ['file', 'target', 'project'];

/** OC 有名 Category 声明正则：@interface ClassName (CategoryName)，排除匿名 () */
const OBJC_CATEGORY_REGEX = /@interface\s+(\w+)\s*\(\s*(\w+)\s*\)/g;

/** 从代码中收集 (ClassName, CategoryName) -> [{ line, snippet }]，key = 'ClassName(CategoryName)' */
function collectCategoriesFromCode(code) {
	const byKey = {};
	const lines = (code || '').split(/\r?\n/);
	lines.forEach((line, i) => {
		const oneLine = line.trim();
		OBJC_CATEGORY_REGEX.lastIndex = 0;
		const m = OBJC_CATEGORY_REGEX.exec(oneLine);
		if (!m) return;
		const key = `${m[1]}(${m[2]})`;
		if (!byKey[key]) byKey[key] = [];
		byKey[key].push({ line: i + 1, snippet: oneLine.slice(0, 120) });
	});
	return byKey;
}

/**
 * 同文件维度：OC 同一文件内 Category 重名
 * @param {string} code 当前文件源代码
 * @returns {Array<{ ruleId: string, message: string, severity: string, line: number, snippet: string, dimension: string }>}
 */
function runObjcCategoryDuplicateInFile(code) {
	const violations = [];
	const byKey = collectCategoriesFromCode(code);
	for (const [key, occurrences] of Object.entries(byKey)) {
		if (occurrences.length <= 1) continue;
		occurrences.forEach((occ, idx) => {
			if (idx === 0) return;
			violations.push({
				ruleId: 'objc-duplicate-category',
				message: `同文件内 Category 重名：${key}，首次在第 ${occurrences[0].line} 行`,
				severity: 'warning',
				line: occ.line,
				snippet: occ.snippet,
				dimension: 'file'
			});
		});
	}
	return violations;
}

/** 递归收集目录下所有 .m/.h/.swift 相对路径，跳过常见非源码目录（用于 project 范围静态检查） */
function collectSourceFiles(projectRoot, dir, baseDir, out) {
	const fullDir = baseDir ? path.join(baseDir, dir) : dir;
	const absDir = path.isAbsolute(fullDir) ? fullDir : path.join(projectRoot, fullDir);
	if (!fs.existsSync(absDir)) return;
	const skipDirs = new Set(['node_modules', 'Pods', '.git', 'build', 'DerivedData', '.build', 'Carthage', '.xcodeproj', '.xcworkspace']);
	const entries = fs.readdirSync(absDir, { withFileTypes: true });
	for (const e of entries) {
		const rel = path.join(fullDir, e.name).replace(/\\/g, '/');
		if (e.isDirectory()) {
			if (!skipDirs.has(e.name)) collectSourceFiles(projectRoot, e.name, fullDir, out);
		} else if (e.isFile() && /\.(m|h|swift)$/i.test(e.name)) {
			out.push(rel.replace(/\\/g, '/').replace(/^\.\//, ''));
		}
	}
}

/**
 * 按审查规模对多文件运行静态规则，返回带 filePath 的违反项（用于 target/project 范围）
 * @param {string} projectRoot
 * @param {string} fileScope 'target' | 'project' 扫描哪些文件
 * @param {string} currentFilePathAbsolute 当前触发文件的绝对路径，用于解析 target
 * @param {string|null} ruleScope 规则维度过滤：'file'|'target'|'project' 时只运行匹配 dimension 的规则；null 时运行全部
 * @returns {Promise<Array<{ ruleId: string, message: string, severity: string, line: number, snippet: string, filePath?: string }>>}
 */
async function runStaticCheckForScope(projectRoot, fileScope, currentFilePathAbsolute, ruleScope) {
	const violations = [];
	const langFromExt = (rel) => (/\.swift$/i.test(rel) ? 'swift' : 'objc');

	if (fileScope === 'target') {
		try {
			const targetScanner = require('../spm/targetScanner');
			const target = await targetScanner.findTargetContainingFile(projectRoot, currentFilePathAbsolute);
			if (!target) return [];
			const paths = await targetScanner.getTargetSourcePaths(target);
			for (const abs of paths) {
				const rel = path.relative(projectRoot, abs).replace(/\\/g, '/').replace(/^\.\//, '');
				let code;
				try {
					code = fs.readFileSync(abs, 'utf8');
				} catch (_) {
					continue;
				}
				const language = langFromExt(rel);
				const fileViolations = runStaticCheck(projectRoot, code, language, ruleScope);
				fileViolations.forEach(v => violations.push({ ...v, filePath: rel }));
			}
		} catch (_) {
			return [];
		}
		return violations;
	}

	if (fileScope === 'project') {
		const files = [];
		collectSourceFiles(projectRoot, '.', '', files);
		for (const rel of files) {
			const abs = path.join(projectRoot, rel);
			let code;
			try {
				code = fs.readFileSync(abs, 'utf8');
			} catch (_) {
				continue;
			}
			const language = langFromExt(rel);
			const fileViolations = runStaticCheck(projectRoot, code, language, ruleScope);
			fileViolations.forEach(v => violations.push({ ...v, filePath: rel }));
		}
		return violations;
	}

	return [];
}

/** 递归收集目录下所有 .m/.h 相对路径，跳过常见非源码目录 */
function collectObjcFiles(projectRoot, dir, baseDir, out) {
	const fullDir = baseDir ? path.join(baseDir, dir) : dir;
	const absDir = path.isAbsolute(fullDir) ? fullDir : path.join(projectRoot, fullDir);
	if (!fs.existsSync(absDir)) return;
	const skipDirs = new Set(['node_modules', 'Pods', '.git', 'build', 'DerivedData', '.build', 'Carthage', '.xcodeproj', '.xcworkspace']);
	const entries = fs.readdirSync(absDir, { withFileTypes: true });
	for (const e of entries) {
		const rel = path.join(fullDir, e.name).replace(/\\/g, '/');
		if (e.isDirectory()) {
			if (!skipDirs.has(e.name)) collectObjcFiles(projectRoot, e.name, fullDir, out);
		} else if (e.isFile() && /\.(m|h)$/i.test(e.name)) {
			out.push(rel.replace(/\\/g, '/').replace(/^\.\//, ''));
		}
	}
}

/**
 * 同 target 维度：OC 同一 SPM target 内 Category 不能重名；对参与重复的每个 (文件,行) 都报一条违反（带 filePath），便于在 .m 上执行也能发现 .h 中的重名
 * @param {string} projectRoot
 * @param {string} _currentFilePath 当前文件相对路径（保留参数兼容，未使用）
 * @param {string[]} targetFilePaths 该 target 下所有 .m/.h 的绝对路径
 * @returns {Array<{ ruleId: string, message: string, severity: string, line: number, snippet: string, dimension: string, filePath: string }>}
 */
function runObjcCategoryDuplicateInTarget(projectRoot, _currentFilePath, targetFilePaths) {
	const violations = [];
	/** @type {Record<string, Array<{ filePath: string, line: number, snippet: string }>>} */
	const byKey = {};
	for (const abs of targetFilePaths) {
		let code;
		try {
			code = fs.readFileSync(abs, 'utf8');
		} catch (_) {
			continue;
		}
		const rel = path.relative(projectRoot, abs).replace(/\\/g, '/').replace(/^\.\//, '');
		const lines = (code || '').split(/\r?\n/);
		lines.forEach((line, i) => {
			const oneLine = line.trim();
			OBJC_CATEGORY_REGEX.lastIndex = 0;
			const m = OBJC_CATEGORY_REGEX.exec(oneLine);
			if (!m) return;
			const key = `${m[1]}(${m[2]})`;
			if (!byKey[key]) byKey[key] = [];
			byKey[key].push({ filePath: rel, line: i + 1, snippet: oneLine.slice(0, 120) });
		});
	}
	for (const [key, occurrences] of Object.entries(byKey)) {
		if (occurrences.length <= 1) continue;
		occurrences.forEach(occ => {
			const otherDesc = occurrences.filter(o => o.filePath !== occ.filePath || o.line !== occ.line).map(o => `${o.filePath}:${o.line}`).join(', ');
			violations.push({
				ruleId: 'objc-duplicate-category',
				message: `同 target 内 Category 重名：${key}，另见 ${otherDesc}`,
				severity: 'warning',
				line: occ.line,
				snippet: occ.snippet,
				dimension: 'target',
				filePath: occ.filePath
			});
		});
	}
	return violations;
}

/**
 * 同项目维度：OC 整个项目内 Category 不能重名；对参与重复的每个 (文件,行) 都报一条违反（带 filePath），便于在 .m 上执行也能发现 .h 中的重名
 * @param {string} projectRoot
 * @param {string} _currentFilePath 当前文件相对路径（保留参数兼容，未使用）
 * @returns {Array<{ ruleId: string, message: string, severity: string, line: number, snippet: string, dimension: string, filePath: string }>}
 */
function runObjcCategoryDuplicateCheckProject(projectRoot, _currentFilePath) {
	const violations = [];
	const files = [];
	collectObjcFiles(projectRoot, '.', '', files);
	/** @type {Record<string, Array<{ filePath: string, line: number, snippet: string }>>} */
	const byKey = {};
	for (const rel of files) {
		const abs = path.join(projectRoot, rel);
		let code;
		try {
			code = fs.readFileSync(abs, 'utf8');
		} catch (_) {
			continue;
		}
		const lines = (code || '').split(/\r?\n/);
		lines.forEach((line, i) => {
			const oneLine = line.trim();
			OBJC_CATEGORY_REGEX.lastIndex = 0;
			const m = OBJC_CATEGORY_REGEX.exec(oneLine);
			if (!m) return;
			const key = `${m[1]}(${m[2]})`;
			if (!byKey[key]) byKey[key] = [];
			byKey[key].push({ filePath: rel, line: i + 1, snippet: oneLine.slice(0, 120) });
		});
	}
	for (const [key, occurrences] of Object.entries(byKey)) {
		if (occurrences.length <= 1) continue;
		occurrences.forEach(occ => {
			const otherDesc = occurrences.filter(o => o.filePath !== occ.filePath || o.line !== occ.line).map(o => `${o.filePath}:${o.line}`).join(', ');
			violations.push({
				ruleId: 'objc-duplicate-category',
				message: `项目内 Category 重名：${key}，另见 ${otherDesc}`,
				severity: 'warning',
				line: occ.line,
				snippet: occ.snippet,
				dimension: 'project',
				filePath: occ.filePath
			});
		});
	}
	return violations;
}

/**
 * 按语言对接的审核能力：language -> { file, target, project } 审计函数
 * 新增语言时在此注册 file/target/project 维度的审计即可
 */
const AUDIT_BY_LANGUAGE = {
	objc: {
		file: (code) => runObjcCategoryDuplicateInFile(code),
		target: async (projectRoot, currentFilePathRelative, currentFilePathAbsolute) => {
			try {
				const targetScanner = require('../spm/targetScanner');
				const target = await targetScanner.findTargetContainingFile(projectRoot, currentFilePathAbsolute || path.join(projectRoot, currentFilePathRelative));
				if (!target) return [];
				const targetPaths = await targetScanner.getTargetSourcePaths(target);
				return runObjcCategoryDuplicateInTarget(projectRoot, currentFilePathRelative, targetPaths);
			} catch (_) {
				return [];
			}
		},
		project: (projectRoot, currentFilePathRelative) => runObjcCategoryDuplicateCheckProject(projectRoot, currentFilePathRelative)
	},
	// Swift 暂无多维度审计（OC 为 Category 重名）；占位便于后续扩展（如 extension 命名冲突等）
	swift: {
		file: () => [],
		target: async () => [],
		project: () => []
	}
};

/** 当前已对接审核的语言列表 */
function getSupportedAuditLanguages() {
	return Object.keys(AUDIT_BY_LANGUAGE);
}

/**
 * 文件级/ target 级/ 项目级审查入口（按语言对接，异步：target 需解析 SPM）
 * @param {string} projectRoot
 * @param {string} code 当前文件源代码
 * @param {string} language 'objc' | 'swift' | ...
 * @param {string} [currentFilePathRelative] 当前文件相对 projectRoot 的路径
 * @param {string} [currentFilePathAbsolute] 当前文件绝对路径，用于解析所属 target
 * @param {string|null} [scope] 审查规模：'file'|'target'|'project' 时仅运行该维度；null 时运行全部
 * @returns {Promise<Array<{ ruleId: string, message: string, severity: string, line: number, snippet: string, dimension?: string, filePath?: string }>>}
 */
async function runFileAudit(projectRoot, code, language, currentFilePathRelative, currentFilePathAbsolute, scope) {
	const audits = AUDIT_BY_LANGUAGE[language];
	if (!audits || !currentFilePathRelative) return [];

	const doFile = !scope || scope === 'file';
	const doTarget = !scope || scope === 'target';
	const doProject = !scope || scope === 'project';

	const vFile = (doFile && audits.file) ? audits.file(code) : [];
	const vTarget = (doTarget && audits.target) ? await audits.target(projectRoot, currentFilePathRelative, currentFilePathAbsolute) : [];
	const vProject = (doProject && audits.project) ? audits.project(projectRoot, currentFilePathRelative) : [];
	return [...vFile, ...vTarget, ...vProject];
}

module.exports = {
	getGuardRules,
	addOrUpdateRule,
	getRulesForLanguage,
	runStaticCheck,
	runFileAudit,
	runStaticCheckForScope,
	AUDIT_BY_LANGUAGE,
	getSupportedAuditLanguages,
	AUDIT_DIMENSIONS,
	runObjcCategoryDuplicateInFile,
	runObjcCategoryDuplicateInTarget,
	runObjcCategoryDuplicateCheckProject,
	getRulesPath,
	DEFAULT_RULES
};
