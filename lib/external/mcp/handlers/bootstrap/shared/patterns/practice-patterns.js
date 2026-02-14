/**
 * 最佳实践变体定义 — 声明式数据
 *
 * 从 extractors-micro.js 的 _getBestPracticeVariants() 提取。
 * 按 practiceKey + lang 返回写法变体定义。
 *
 * @module shared/patterns/practice-patterns
 */

// ═══════════════════════════════════════════════════════════
//  errorHandling 变体
// ═══════════════════════════════════════════════════════════

const ERROR_HANDLING = {
  objectivec: {
    nserror_out: { label: 'NSError** 输出参数', regex: /error:\s*\(NSError\s*\*\s*\*\s*\)/ },
    try_catch:   { label: '@try/@catch 异常', regex: /@try\s*\{/ },
    nil_check:   { label: 'if (error) / if (!result) 条件', regex: /if\s*\(\s*!?\s*\w+\s*\)/ },
  },
  swift: {
    guard_let:    { label: 'guard let...else', regex: /guard\s+let\s+.*else/ },
    do_try_catch: { label: 'do { try } catch', regex: /do\s*\{[^}]*\btry\b/ },
    result_type:  { label: 'Result<Success, Failure>', regex: /Result\s*</ },
    optional_try: { label: 'try? 可选尝试', regex: /\btry\?\s/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  concurrency 变体
// ═══════════════════════════════════════════════════════════

const CONCURRENCY = {
  objectivec: {
    dispatch_main:   { label: 'dispatch_async 主线程', regex: /dispatch_async\s*\(\s*dispatch_get_main_queue/ },
    dispatch_global: { label: 'dispatch_async 后台线程', regex: /dispatch_async\s*\(\s*dispatch_get_global_queue/ },
    dispatch_group:  { label: 'GCD Group', regex: /dispatch_group/ },
    semaphore:       { label: '信号量 Semaphore', regex: /dispatch_semaphore/ },
    nsoperation:     { label: 'NSOperation 队列', regex: /NSOperation|NSOperationQueue/ },
    synchronized:    { label: '@synchronized 锁', regex: /@synchronized/ },
  },
  swift: {
    async_await:    { label: 'async/await', regex: /\bawait\s/ },
    task_block:     { label: 'Task { }', regex: /Task\s*\{/ },
    dispatch_main:  { label: 'DispatchQueue.main', regex: /DispatchQueue\.main/ },
    dispatch_global: { label: 'DispatchQueue.global', regex: /DispatchQueue\.global/ },
    actor:          { label: 'actor', regex: /\bactor\s+\w+/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  memoryMgmt 变体
// ═══════════════════════════════════════════════════════════

const MEMORY_MGMT = {
  objectivec: {
    weakify:         { label: '@weakify/@strongify 宏', regex: /@weakify|@strongify/ },
    weak_strong:     { label: '手动 weakSelf/strongSelf', regex: /__weak\s+typeof\s*\(\s*self\s*\)|weakSelf/ },
    dealloc_cleanup: { label: 'dealloc 清理', regex: /-\s*\(void\)\s*dealloc/ },
    autoreleasepool: { label: '@autoreleasepool', regex: /@autoreleasepool/ },
  },
  swift: {
    weak_self:  { label: '[weak self] in', regex: /\[weak\s+self\]/ },
    guard_self: { label: 'guard let self = self', regex: /guard\s+let\s+self\s*=\s*self/ },
    unowned:    { label: '[unowned self]', regex: /\[unowned\s/ },
    deinit:     { label: 'deinit { } 清理', regex: /\bdeinit\s*\{/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  查询表 & 接口
// ═══════════════════════════════════════════════════════════

const PRACTICE_MAP = {
  errorHandling: ERROR_HANDLING,
  concurrency: CONCURRENCY,
  memoryMgmt: MEMORY_MGMT,
};

/**
 * 获取指定实践类型 + 语言的写法变体定义
 * @param {string} key — 'errorHandling' | 'concurrency' | 'memoryMgmt'
 * @param {string} lang — 'objectivec' | 'swift'
 * @returns {object} variant definitions, or empty object
 */
export function getBestPracticeVariants(key, lang) {
  const group = PRACTICE_MAP[key];
  if (!group) return {};
  return group[lang] || {};
}
