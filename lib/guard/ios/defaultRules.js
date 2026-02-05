/**
 * iOS Guard 默认规则与存储
 */

const fs = require('fs');
const path = require('path');
const Paths = require('../../infrastructure/config/Paths');

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
  return path.join(Paths.getProjectInternalDataPath(projectRoot), RULES_FILENAME);
}

function ensureDir(projectRoot) {
  const dir = Paths.getProjectInternalDataPath(projectRoot);
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

module.exports = {
  RULES_FILENAME,
  SCHEMA_VERSION,
  DEFAULT_RULES,
  getRulesPath,
  getGuardRules,
  addOrUpdateRule
};
