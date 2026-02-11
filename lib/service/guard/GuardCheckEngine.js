/**
 * GuardCheckEngine - Guard 规则检查引擎
 * 
 * 从 V1 guard/ios 迁移，适配 V2 架构
 * 支持: 正则模式匹配 + code-level 检查 + 多维度审计
 */

import Logger from '../../infrastructure/logging/Logger.js';

/**
 * 内置默认规则集（iOS: ObjC + Swift）
 * 用于在数据库为空时提供基础检查能力
 */
const BUILT_IN_RULES = {
  'no-main-thread-sync': {
    message: '禁止在主线程上使用 dispatch_sync(main)，易死锁',
    severity: 'error',
    pattern: 'dispatch_sync\\s*\\([^)]*main',
    languages: ['objc', 'swift'],
    dimension: 'file',
  },
  'main-thread-sync-swift': {
    message: '禁止在主线程上使用 DispatchQueue.main.sync，易死锁',
    severity: 'error',
    pattern: 'DispatchQueue\\.main\\.sync',
    languages: ['swift'],
    dimension: 'file',
  },
  'objc-dealloc-async': {
    message: 'dealloc 内禁止使用 dispatch_async/dispatch_after/postNotification 等',
    severity: 'error',
    pattern: '(dealloc.*(dispatch_async|dispatch_after|postNotification|performSelector.*afterDelay))',
    languages: ['objc'],
    dimension: 'file',
  },
  'objc-block-retain-cycle': {
    message: 'block 内直接使用 self 可能循环引用，建议 weakSelf',
    severity: 'warning',
    pattern: '\\^\\s*[({][^}]*\\bself\\b',
    languages: ['objc'],
    dimension: 'file',
  },
  'objc-assign-object': {
    message: 'assign 用于对象类型会产生悬垂指针，建议改为 weak 或 strong',
    severity: 'warning',
    pattern: '@property\\s*\\([^)]*\\bassign\\b[^)]*\\)[^;]*(\\*|id\\s*<|\\bid\\s+)',
    languages: ['objc'],
    dimension: 'file',
  },
  'swift-force-cast': {
    message: '强制类型转换 as! 在失败时崩溃，建议 as? 或 guard let',
    severity: 'warning',
    pattern: 'as\\s*!',
    languages: ['swift'],
    dimension: 'file',
  },
  'swift-force-try': {
    message: 'try! 在异常时崩溃，建议 do-catch 或 try?',
    severity: 'warning',
    pattern: 'try\\s*!',
    languages: ['swift'],
    dimension: 'file',
  },
  'objc-timer-retain-cycle': {
    message: 'NSTimer 以 self 为 target 会强引用 self，需在 dealloc 前 invalidate 或使用 block 形式',
    severity: 'warning',
    pattern: '(scheduledTimerWithTimeInterval|timerWithTimeInterval)[^;]*target\\s*:\\s*self',
    languages: ['objc'],
    dimension: 'file',
  },
  'objc-possible-main-thread-blocking': {
    message: 'sleep/usleep 可能造成主线程阻塞',
    severity: 'warning',
    pattern: '\\b(sleep|usleep)\\s*\\(',
    languages: ['objc'],
    dimension: 'file',
  },
};

/**
 * 从文件扩展名推断语言
 */
export function detectLanguage(filePath) {
  if (!filePath) return 'unknown';
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'swift': return 'swift';
    case 'm': case 'mm': case 'h': return 'objc';
    case 'js': case 'mjs': case 'cjs': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'py': return 'python';
    case 'java': return 'java';
    case 'kt': case 'kts': return 'kotlin';
    case 'rb': return 'ruby';
    case 'go': return 'go';
    case 'rs': return 'rust';
    default: return 'unknown';
  }
}

/**
 * GuardCheckEngine - 核心检查引擎
 */
export class GuardCheckEngine {
  constructor(db, options = {}) {
    this.db = typeof db?.getDb === 'function' ? db.getDb() : db;
    this.logger = Logger.getInstance();
    this._builtInRules = BUILT_IN_RULES;
    this._customRulesCache = null;
    this._cacheTime = 0;
    this._cacheTTL = options.cacheTTL || 60_000; // 1min
  }

  /**
   * 获取所有启用的规则 (数据库 + 内置)
   */
  getRules(language = null) {
    let rules = [];

    // 从数据库加载自定义规则（boundary-constraint 类型的 Recipe）
    try {
      const now = Date.now();
      if (!this._customRulesCache || now - this._cacheTime > this._cacheTTL) {
        const rows = this.db.prepare(
          `SELECT id, title, description, language, scope, constraints_json
           FROM recipes WHERE knowledge_type = 'boundary-constraint' AND status = 'active'`
        ).all();
        this._customRulesCache = rows.map(r => {
          let guards = [];
          try {
            const constraints = JSON.parse(r.constraints_json || '{}');
            guards = constraints.guards || [];
          } catch { /* ignore */ }
          // Each guard entry becomes a rule
          return guards.map(g => ({
            id: g.id || r.id,
            name: g.name || r.title,
            message: g.message || r.description || r.title,
            pattern: g.pattern || '',
            languages: r.language ? [r.language] : [],
            severity: g.severity || 'warning',
            dimension: r.scope || 'file',
            source: 'database',
          }));
        }).flat().filter(r => r.pattern);
        this._cacheTime = now;
      }
      rules.push(...this._customRulesCache);
    } catch {
      // recipes table or knowledge_type column may not exist
    }

    // 合并内置规则（不覆盖同名数据库规则）
    const existingIds = new Set(rules.map(r => r.id || r.name));
    for (const [ruleId, rule] of Object.entries(this._builtInRules)) {
      if (!existingIds.has(ruleId)) {
        rules.push({
          id: ruleId,
          name: ruleId,
          message: rule.message,
          pattern: rule.pattern,
          languages: rule.languages,
          severity: rule.severity,
          dimension: rule.dimension || 'file',
          source: 'built-in',
        });
      }
    }

    // 按语言过滤
    if (language) {
      rules = rules.filter(r => !r.languages?.length || r.languages.includes(language));
    }

    return rules;
  }

  /**
   * 对代码运行静态检查
   * @param {string} code - 源代码
   * @param {string} language - 'objc'|'swift'|'javascript' 等
   * @param {object} options - {scope, filePath}
   * @returns {Array<{ruleId, message, severity, line, snippet, dimension?}>}
   */
  checkCode(code, language, options = {}) {
    const { scope = null } = options;
    const violations = [];

    // 获取匹配语言的规则
    let rules = this.getRules(language);

    // 如果有 scope，按层级过滤：project ⊇ target ⊇ file
    // project 范围包含所有维度的规则；target 包含 file+target；file 仅匹配 file
    if (scope) {
      const SCOPE_HIERARCHY = { project: ['file', 'target', 'project'], target: ['file', 'target'], file: ['file'] };
      const allowedDimensions = SCOPE_HIERARCHY[scope] || [scope];
      rules = rules.filter(r => !r.dimension || allowedDimensions.includes(r.dimension));
    }

    const lines = (code || '').split(/\r?\n/);

    for (const rule of rules) {
      // 跳过空模式或特殊标记 (?!) — 由 code-level 检查接管
      if (!rule.pattern || rule.pattern === '(?!)') continue;

      let re;
      try {
        re = new RegExp(rule.pattern);
      } catch {
        this.logger.debug(`Invalid regex in rule ${rule.id}: ${rule.pattern}`);
        continue;
      }

      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          violations.push({
            ruleId: rule.id || rule.name,
            message: rule.message,
            severity: rule.severity || 'warning',
            line: i + 1,
            snippet: lines[i].trim().slice(0, 120),
            ...(rule.dimension ? { dimension: rule.dimension } : {}),
          });
        }
      }
    }

    // Code-level 检查（不依赖正则）
    violations.push(...this._runCodeLevelChecks(code, language, lines));

    return violations;
  }

  /**
   * 代码级别检查 - 需要上下文理解的检查
   */
  _runCodeLevelChecks(code, language, lines) {
    const violations = [];

    if (language === 'objc') {
      // KVO 观察者未移除检查
      if (code.includes('addObserver') && !code.includes('removeObserver')) {
        const lineIdx = lines.findIndex(l => /addObserver/.test(l));
        violations.push({
          ruleId: 'objc-kvo-missing-remove',
          message: '存在 addObserver 未发现配对 removeObserver，请在 dealloc 或合适时机移除',
          severity: 'warning',
          line: lineIdx >= 0 ? lineIdx + 1 : 1,
          snippet: lineIdx >= 0 ? lines[lineIdx].trim().slice(0, 120) : '',
          dimension: 'file',
        });
      }

      // ObjC Category 重名检查 (同文件)
      const categoryRegex = /@interface\s+(\w+)\s*\(\s*(\w+)\s*\)/g;
      const categories = {};
      for (let i = 0; i < lines.length; i++) {
        categoryRegex.lastIndex = 0;
        const m = categoryRegex.exec(lines[i]);
        if (!m) continue;
        const key = `${m[1]}(${m[2]})`;
        if (!categories[key]) categories[key] = [];
        categories[key].push({ line: i + 1, snippet: lines[i].trim().slice(0, 120) });
      }
      for (const [key, occs] of Object.entries(categories)) {
        if (occs.length <= 1) continue;
        for (let j = 1; j < occs.length; j++) {
          violations.push({
            ruleId: 'objc-duplicate-category',
            message: `同文件内 Category 重名：${key}，首次在第 ${occs[0].line} 行`,
            severity: 'warning',
            line: occs[j].line,
            snippet: occs[j].snippet,
            dimension: 'file',
          });
        }
      }
    }

    return violations;
  }

  /**
   * 文件审计 - 读取文件并检查
   * @param {string} filePath - 绝对路径
   * @param {string} code - 文件内容
   * @param {object} options - {scope}
   */
  auditFile(filePath, code, options = {}) {
    const language = detectLanguage(filePath);
    const violations = this.checkCode(code, language, { ...options, filePath });
    return {
      filePath,
      language,
      violations,
      summary: {
        total: violations.length,
        errors: violations.filter(v => v.severity === 'error').length,
        warnings: violations.filter(v => v.severity === 'warning').length,
      },
    };
  }

  /**
   * 批量文件审计
   */
  auditFiles(files, options = {}) {
    const results = [];
    let totalViolations = 0;
    let totalErrors = 0;

    for (const { path: filePath, content } of files) {
      const result = this.auditFile(filePath, content, options);
      results.push(result);
      totalViolations += result.summary.total;
      totalErrors += result.summary.errors;
    }

    return {
      files: results,
      summary: {
        filesChecked: results.length,
        totalViolations,
        totalErrors,
        filesWithViolations: results.filter(r => r.summary.total > 0).length,
      },
    };
  }

  /**
   * 清除规则缓存
   */
  clearCache() {
    this._customRulesCache = null;
    this._cacheTime = 0;
  }

  /**
   * 获取内置规则列表
   */
  getBuiltInRules() {
    return { ...this._builtInRules };
  }
}

export default GuardCheckEngine;
