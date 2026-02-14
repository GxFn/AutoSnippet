/**
 * 事件传播与数据状态管理变体定义 — 声明式数据
 *
 * 从 extractors-micro.js 的 _getEventFlowVariants() 提取。
 * 按 eventKey + lang 返回写法变体定义。
 *
 * @module shared/patterns/event-patterns
 */

// ═══════════════════════════════════════════════════════════
//  事件传播 — notification
// ═══════════════════════════════════════════════════════════

const NOTIFICATION = {
  objectivec: {
    selector_add: { label: 'addObserver:selector: 注册', regex: /addObserver:.*selector:/ },
    block_add:    { label: 'addObserverForName:usingBlock:', regex: /addObserverForName:.*usingBlock:/ },
    post:         { label: 'postNotificationName: 发送', regex: /postNotificationName:/ },
  },
  swift: {
    closure_add: { label: 'addObserver(forName:) closure', regex: /addObserver\s*\(\s*forName:/ },
    publisher:   { label: 'NotificationCenter.publisher (Combine)', regex: /\.publisher\s*\(\s*for:/ },
    post:        { label: '.post 发送', regex: /\.post\s*\(/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  事件传播 — callback
// ═══════════════════════════════════════════════════════════

const CALLBACK = {
  objectivec: {
    typedef_block:  { label: 'typedef Block 声明', regex: /typedef\s+void\s*\(\^/ },
    completion:     { label: 'completionHandler 参数', regex: /completion[Hh]andler|completionBlock/ },
    inline_block:   { label: '内联 ^{ } Block', regex: /\^\s*\(|\^\s*\{/ },
    success_fail:   { label: 'success/failure 双 Block', regex: /success\w*Block|failure\w*Block/ },
  },
  swift: {
    escaping:    { label: '@escaping Closure', regex: /@escaping/ },
    completion:  { label: 'completion: Handler', regex: /completion\s*:/ },
    result_cb:   { label: 'Result<> 回调', regex: /Result\s*<.*>\s*\)\s*->/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  事件传播 — target_action (通用 / ObjC 为主)
// ═══════════════════════════════════════════════════════════

const TARGET_ACTION = {
  _shared: {
    add_target: { label: 'addTarget:action:forControlEvents:', regex: /addTarget:.*action:/ },
    selector:   { label: '@selector() 定义', regex: /@selector\s*\(/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  事件传播 — reactive (Combine / RxSwift)
// ═══════════════════════════════════════════════════════════

const REACTIVE = {
  _shared: {
    combine_sink:   { label: 'Combine .sink', regex: /\.sink\s*\{/ },
    combine_assign: { label: 'Combine .assign', regex: /\.assign\s*\(to:/ },
    rx_subscribe:   { label: 'RxSwift .subscribe', regex: /\.subscribe\s*\(/ },
    rx_bind:        { label: 'RxSwift .bind', regex: /\.bind\s*\(to:/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  数据状态管理 — kvo
// ═══════════════════════════════════════════════════════════

const KVO = {
  objectivec: {
    register:   { label: 'addObserver:forKeyPath: 注册', regex: /addObserver:.*forKeyPath:/ },
    callback:   { label: 'observeValueForKeyPath: 回调', regex: /observeValueForKeyPath:/ },
    remove_kvo: { label: 'removeObserver:forKeyPath: 注销', regex: /removeObserver:.*forKeyPath:/ },
  },
  swift: {
    did_set:      { label: 'didSet 属性观察', regex: /didSet\s*\{/ },
    will_set:     { label: 'willSet 属性观察', regex: /willSet\s*\{/ },
    objc_dynamic: { label: '@objc dynamic KVO', regex: /@objc\s+dynamic/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  数据状态管理 — property (ObjC)
// ═══════════════════════════════════════════════════════════

const PROPERTY = {
  _shared: {
    nonatomic_strong: { label: 'nonatomic, strong', regex: /@property\s*\([^)]*nonatomic[^)]*strong/ },
    nonatomic_copy:   { label: 'nonatomic, copy', regex: /@property\s*\([^)]*nonatomic[^)]*copy/ },
    nonatomic_weak:   { label: 'nonatomic, weak', regex: /@property\s*\([^)]*nonatomic[^)]*weak/ },
    nonatomic_assign: { label: 'nonatomic, assign', regex: /@property\s*\([^)]*nonatomic[^)]*assign/ },
    readonly:         { label: 'readonly', regex: /@property\s*\([^)]*readonly/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  数据状态管理 — persistence
// ═══════════════════════════════════════════════════════════

const PERSISTENCE = {
  objectivec: {
    userdefaults: { label: 'NSUserDefaults', regex: /NSUserDefaults/ },
    coredata:     { label: 'Core Data', regex: /NSManagedObject|NSFetchRequest|CoreData/ },
    realm:        { label: 'Realm', regex: /\bRealm\b|RLMObject/ },
    fmdb:         { label: 'FMDB / SQLite', regex: /\bFMDB\b|\bFMDatabase\b|sqlite/ },
    nscoding:     { label: 'NSCoding 归档', regex: /NSCoding|NSKeyedArchiver/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  数据状态管理 — swiftui
// ═══════════════════════════════════════════════════════════

const SWIFTUI = {
  _shared: {
    state:            { label: '@State', regex: /@State\s+/ },
    published:        { label: '@Published', regex: /@Published\s+/ },
    binding:          { label: '@Binding', regex: /@Binding\s+/ },
    observed_object:  { label: '@ObservedObject', regex: /@ObservedObject\s+/ },
    state_object:     { label: '@StateObject', regex: /@StateObject\s+/ },
    environment:      { label: '@Environment', regex: /@Environment\s*\(/ },
    environment_obj:  { label: '@EnvironmentObject', regex: /@EnvironmentObject\s+/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  数据状态管理 — combine
// ═══════════════════════════════════════════════════════════

const COMBINE = {
  _shared: {
    current_value: { label: 'CurrentValueSubject', regex: /CurrentValueSubject/ },
    passthrough:   { label: 'PassthroughSubject', regex: /PassthroughSubject/ },
    future:        { label: 'Future { }', regex: /Future\s*\{/ },
    just:          { label: 'Just()', regex: /\bJust\s*\(/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  JS/TS/Python 通用 — eventEmitter
// ═══════════════════════════════════════════════════════════

const EVENT_EMITTER = {
  _shared: {
    addEventListener: { label: 'addEventListener', regex: /\.addEventListener\s*\(/ },
    on_event:         { label: '.on() 事件', regex: /\.on\s*\(/ },
    emit:             { label: '.emit() 发送', regex: /\.emit\s*\(/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  JS/TS 通用 — observable (RxJS)
// ═══════════════════════════════════════════════════════════

const OBSERVABLE = {
  _shared: {
    rxjs_pipe:     { label: 'RxJS pipe()', regex: /\.pipe\s*\(/ },
    subscribe:     { label: '.subscribe()', regex: /\.subscribe\s*\(/ },
    behavior_subj: { label: 'BehaviorSubject', regex: /BehaviorSubject/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  JS/TS 通用 — stateManagement
// ═══════════════════════════════════════════════════════════

const STATE_MANAGEMENT = {
  _shared: {
    useState:     { label: 'useState', regex: /\buseState\s*[(<]/ },
    useReducer:   { label: 'useReducer', regex: /\buseReducer\s*\(/ },
    redux:        { label: 'Redux createStore/createSlice', regex: /createStore|createSlice/ },
    zustand:      { label: 'Zustand/Jotai atom', regex: /\batom\s*\(|\bcreate\s*\(/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  JS/TS 通用 — dataBinding
// ═══════════════════════════════════════════════════════════

const DATA_BINDING = {
  _shared: {
    useEffect:  { label: 'useEffect', regex: /\buseEffect\s*\(/ },
    useMemo:    { label: 'useMemo', regex: /\buseMemo\s*\(/ },
    computed:   { label: 'computed', regex: /\bcomputed\s*[({]/ },
    watch:      { label: 'watch()', regex: /\bwatch\s*\(/ },
  },
};

// ═══════════════════════════════════════════════════════════
//  查询表 & 接口
// ═══════════════════════════════════════════════════════════

const EVENT_MAP = {
  notification:    NOTIFICATION,
  callback:        CALLBACK,
  target_action:   TARGET_ACTION,
  reactive:        REACTIVE,
  kvo:             KVO,
  property:        PROPERTY,
  persistence:     PERSISTENCE,
  swiftui:         SWIFTUI,
  combine:         COMBINE,
  eventEmitter:    EVENT_EMITTER,
  observable:      OBSERVABLE,
  stateManagement: STATE_MANAGEMENT,
  dataBinding:     DATA_BINDING,
};

/**
 * 获取指定事件/数据模式 + 语言的写法变体定义
 * @param {string} key — 模式名称（如 'notification', 'callback', 'kvo' 等）
 * @param {string} lang — 语言标识（如 'objectivec', 'swift'）
 * @returns {object} variant definitions keyed by variant name, or empty object
 */
export function getEventFlowVariants(key, lang) {
  const group = EVENT_MAP[key];
  if (!group) return {};
  // 优先使用语言特定定义，fallback 到 _shared
  return group[lang] || group._shared || {};
}
