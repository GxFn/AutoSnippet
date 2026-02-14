/**
 * 代码模式变体定义 — 声明式数据
 *
 * 从 extractors-micro.js 的 _getCodePatternVariants() 提取。
 * 每个语言返回一组 pattern 定义，包含 mainRegex + 写法变体。
 *
 * @module shared/patterns/code-patterns
 */

// ═══════════════════════════════════════════════════════════
//  ObjC 代码模式
// ═══════════════════════════════════════════════════════════

const OBJC_CODE_PATTERNS = {
  singleton: {
    label: '单例模式', mainRegex: /\bsharedInstance\b|dispatch_once/,
    variants: {
      dispatch_once: { label: 'dispatch_once 写法', regex: /dispatch_once\s*\(/ },
      static_lazy:   { label: '静态变量懒加载', regex: /static\s+\w+\s*\*\s*_?\w*(instance|shared)\b/i },
    },
  },
  'protocol-delegate': {
    label: '协议委托模式', mainRegex: /@protocol\s+\w+Delegate|<\w+Delegate>/,
    variants: {
      responds_check: { label: 'respondsToSelector 安全调用', regex: /respondsToSelector/ },
      direct_call:    { label: 'delegate 直接调用', regex: /\bself\.delegate\b/ },
      optional:       { label: '@optional 方法声明', regex: /@optional/ },
    },
  },
  category: {
    label: 'Category 扩展', mainRegex: /@interface\s+\w+\s*\(\w*\)/,
    variants: {
      named:     { label: '命名 Category', regex: /@interface\s+\w+\s*\(\w+\)/ },
      anonymous: { label: '匿名 Category（类扩展）', regex: /@interface\s+\w+\s*\(\s*\)/ },
    },
  },
  factory: {
    label: '工厂方法', mainRegex: /\+\s*\(instancetype\)|initWith\w+/,
    variants: {
      class_method: { label: '+ (instancetype) 类工厂', regex: /\+\s*\(instancetype\)\s*\w+/ },
      init_with:    { label: 'initWith... 便捷初始化', regex: /-\s*\(instancetype\)\s*initWith/ },
    },
  },
  builder: {
    // P2 Fix: 移除 return\s+self — ObjC 每个 init 方法都有 return self，极易误判
    label: 'Builder 构建器', mainRegex: /\bBuilder\b/,
    minCount: 2,
    variants: {
      method_chain: { label: '方法链（return self）', regex: /return\s+self\s*;/ },
      config_block: { label: '配置 Block', regex: /\(\s*void\s*\(\s*\^\s*\)/ },
    },
  },
  observer: {
    label: '观察者模式', mainRegex: /\bNSNotificationCenter\b|addObserver:|KVO/,
    variants: {
      notif_selector: { label: 'Notification + Selector', regex: /addObserver:.*selector:/ },
      notif_block:    { label: 'Notification + Block', regex: /addObserverForName:.*usingBlock:/ },
      kvo:            { label: 'KVO observeValue', regex: /addObserver:.*forKeyPath:/ },
    },
  },
  coordinator: {
    label: 'Coordinator/Router 导航模式',
    mainRegex: /(@interface|@protocol|@implementation)\s+\w*(Coordinator|Router|Navigator)/,
    minCount: 2,
    variants: {
      coordinator: { label: 'Coordinator 类', regex: /\w*Coordinator\b/ },
      router:      { label: 'Router 路由', regex: /\w*Router\b/ },
      navigator:   { label: 'Navigator 导航', regex: /\w*Navigator\b/ },
    },
  },
};

// ═══════════════════════════════════════════════════════════
//  Swift 代码模式
// ═══════════════════════════════════════════════════════════

const SWIFT_CODE_PATTERNS = {
  singleton: {
    label: '单例模式', mainRegex: /\bstatic\s+(let|var)\s+shared\b/,
    variants: {
      static_let:   { label: 'static let shared', regex: /static\s+let\s+shared\b/ },
      private_init: { label: 'private init() 保护', regex: /private\s+init\s*\(\s*\)/ },
    },
  },
  'protocol-delegate': {
    label: '协议委托模式', mainRegex: /protocol\s+\w+Delegate|\.delegate\s*=/,
    variants: {
      optional_chain:  { label: 'delegate?.method 可选链', regex: /delegate\?\.\w+/ },
      weak_delegate:   { label: 'weak var delegate', regex: /weak\s+var\s+\w*delegate/i },
      protocol_decl:   { label: 'protocol Delegate 声明', regex: /protocol\s+\w+Delegate/ },
    },
  },
  factory: {
    label: '工厂方法',
    mainRegex: /class\s+func\s+make|static\s+(func|create|from)|convenience\s+init/,
    variants: {
      class_func:      { label: 'class func make…', regex: /class\s+func\s+\w*[Mm]ake/ },
      static_func:     { label: 'static func create/from', regex: /static\s+func\s+\w*(create|from|with)/i },
      convenience_init: { label: 'convenience init', regex: /convenience\s+init/ },
    },
  },
  builder: {
    label: 'Builder 构建器',
    mainRegex: /\bBuilder\b|func\s+\w+\([^)]*\)\s*->\s*Self|@resultBuilder/,
    minCount: 2,
    variants: {
      fluent:         { label: '-> Self 流式构建', regex: /->\s*Self/ },
      result_builder: { label: '@resultBuilder', regex: /@resultBuilder/ },
    },
  },
  observer: {
    label: '观察者模式',
    mainRegex: /\bNotificationCenter\b|@Published\b|willSet\s*\{|didSet\s*\{/,
    variants: {
      notif_closure: { label: 'NotificationCenter closure', regex: /addObserver\(forName:/ },
      published:     { label: '@Published 属性', regex: /@Published\s/ },
      did_set:       { label: 'willSet/didSet 观察', regex: /(willSet|didSet)\s*\{/ },
      combine:       { label: 'Combine .sink', regex: /\.sink\s*\{/ },
    },
  },
  coordinator: {
    label: 'Coordinator/Router 导航模式',
    mainRegex: /\bCoordinator\b|protocol\s+\w*Coordinator|class\s+\w*(Router|Navigator)/,
    minCount: 2,
    variants: {
      protocol_coord: { label: 'Coordinator 协议', regex: /protocol\s+\w*Coordinator/ },
      class_coord:    { label: 'Coordinator 类', regex: /class\s+\w*Coordinator/ },
      router:         { label: 'Router 路由', regex: /class\s+\w*Router/ },
    },
  },
};

// ═══════════════════════════════════════════════════════════
//  通用 fallback
// ═══════════════════════════════════════════════════════════

const GENERIC_CODE_PATTERNS = {
  singleton: {
    label: '单例模式', mainRegex: /\bgetInstance\b|\bshared\b|\binstance\b/,
    variants: {
      get_instance: { label: 'getInstance()', regex: /getInstance\s*\(/ },
      shared_prop:  { label: 'shared 属性', regex: /\bshared\b/ },
    },
  },
};

// ═══════════════════════════════════════════════════════════
//  查询接口
// ═══════════════════════════════════════════════════════════

const LANG_MAP = {
  objectivec: OBJC_CODE_PATTERNS,
  swift: SWIFT_CODE_PATTERNS,
};

/**
 * 获取指定语言的代码模式变体定义
 * @param {string} lang — 'objectivec' | 'swift' | other
 * @returns {object} pattern definitions keyed by pattern name
 */
export function getCodePatternVariants(lang) {
  return LANG_MAP[lang] || GENERIC_CODE_PATTERNS;
}
