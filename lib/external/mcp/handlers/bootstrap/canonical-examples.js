/**
 * Bootstrap — 业界标准完整示例 & 完整性检查 & 基本使用模板
 *
 * 当项目代码只有"半截"时（如 KVO 只有注册没有回调），
 * 提供业界标准的完整使用链示例作为补充。
 *
 * BASIC_USAGE: 每种写法变体的最精简基本用法模板。
 * 用于在「写法」和「项目示例」之间提供纯粹的模式用法参考。
 */

// ─── 基本使用模板 ────────────────────────────────────────
// key 格式: `${lang}:${patternKey}:${variantKey}`
// 模板中可用 {PREFIX} 占位符替换为项目前缀

export const BASIC_USAGE = {
  // ══════════════ ObjC: code-pattern ══════════════
  'objectivec:singleton:dispatch_once': {
    label: 'dispatch_once 单例',
    code: [
      '+ (instancetype)sharedInstance {',
      '    static id instance = nil;',
      '    static dispatch_once_t onceToken;',
      '    dispatch_once(&onceToken, ^{',
      '        instance = [[self alloc] init];',
      '    });',
      '    return instance;',
      '}',
    ],
  },
  'objectivec:singleton:static_lazy': {
    label: '静态变量单例',
    code: [
      '+ (instancetype)sharedInstance {',
      '    static {PREFIX}Manager *_instance = nil;',
      '    if (!_instance) {',
      '        _instance = [[{PREFIX}Manager alloc] init];',
      '    }',
      '    return _instance;',
      '}',
    ],
  },
  'objectivec:protocol-delegate:responds_check': {
    label: 'respondsToSelector 安全调用',
    code: [
      '// 声明协议',
      '@protocol {PREFIX}ServiceDelegate <NSObject>',
      '@optional',
      '- (void)serviceDidFinish:(id)result;',
      '@end',
      '',
      '// 安全调用代理',
      'if ([self.delegate respondsToSelector:@selector(serviceDidFinish:)]) {',
      '    [self.delegate serviceDidFinish:result];',
      '}',
    ],
  },
  'objectivec:protocol-delegate:direct_call': {
    label: 'delegate 直接调用',
    code: [
      '@protocol {PREFIX}ViewDelegate <NSObject>',
      '- (void)viewDidTapConfirm;',
      '@end',
      '',
      '@property (nonatomic, weak) id<{PREFIX}ViewDelegate> delegate;',
      '',
      '// 直接调用（方法为 @required）',
      '[self.delegate viewDidTapConfirm];',
    ],
  },
  'objectivec:category:named': {
    label: '命名 Category',
    code: [
      '@interface NSString (Validation)',
      '- (BOOL)isValidEmail;',
      '@end',
      '',
      '@implementation NSString (Validation)',
      '- (BOOL)isValidEmail {',
      '    // 纯粹的扩展实现',
      '    return [self rangeOfString:@"@"].location != NSNotFound;',
      '}',
      '@end',
    ],
  },
  'objectivec:category:anonymous': {
    label: '匿名 Category（类扩展）',
    code: [
      '// .m 文件中的私有声明',
      '@interface {PREFIX}ViewController ()',
      '@property (nonatomic, strong) UILabel *titleLabel;',
      '@end',
    ],
  },
  'objectivec:factory:class_method': {
    label: '类工厂方法',
    code: [
      '+ (instancetype)managerWithConfig:(NSDictionary *)config {',
      '    {PREFIX}Manager *mgr = [[self alloc] init];',
      '    [mgr applyConfig:config];',
      '    return mgr;',
      '}',
    ],
  },
  'objectivec:factory:init_with': {
    label: 'initWith 便捷初始化',
    code: [
      '- (instancetype)initWithTitle:(NSString *)title {',
      '    self = [super init];',
      '    if (self) {',
      '        _title = [title copy];',
      '    }',
      '    return self;',
      '}',
    ],
  },
  'objectivec:observer:notif_selector': {
    label: 'Notification + Selector',
    code: [
      '// 注册',
      '[[NSNotificationCenter defaultCenter] addObserver:self',
      '    selector:@selector(handleNotification:)',
      '        name:@"SomeNotification" object:nil];',
      '',
      '// 处理',
      '- (void)handleNotification:(NSNotification *)note { /* ... */ }',
      '',
      '// 移除（dealloc）',
      '[[NSNotificationCenter defaultCenter] removeObserver:self];',
    ],
  },
  'objectivec:observer:kvo': {
    label: 'KVO observeValue',
    code: [
      '// 注册',
      '[self.model addObserver:self forKeyPath:@"status"',
      '    options:NSKeyValueObservingOptionNew context:nil];',
      '',
      '// 回调',
      '- (void)observeValueForKeyPath:(NSString *)keyPath',
      '    ofObject:(id)object change:(NSDictionary *)change',
      '    context:(void *)context {',
      '    // 处理变化',
      '}',
      '',
      '// 移除',
      '[self.model removeObserver:self forKeyPath:@"status"];',
    ],
  },
  'objectivec:builder:method_chain': {
    label: '方法链',
    code: [
      '- ({PREFIX}Builder *)setTitle:(NSString *)title {',
      '    _title = title;',
      '    return self;',
      '}',
      '',
      '// 使用',
      'id result = [[[{PREFIX}Builder new] setTitle:@"hi"] build];',
    ],
  },

  // ══════════════ Swift: code-pattern ══════════════
  'swift:singleton:static_let': {
    label: 'static let shared',
    code: [
      'final class SomeManager {',
      '    static let shared = SomeManager()',
      '    private init() {}',
      '}',
    ],
  },
  'swift:protocol-delegate:weak_delegate': {
    label: 'weak var delegate',
    code: [
      'protocol SomeDelegate: AnyObject {',
      '    func didComplete(result: String)',
      '}',
      '',
      'class SomeView {',
      '    weak var delegate: SomeDelegate?',
      '',
      '    func finish() {',
      '        delegate?.didComplete(result: "done")',
      '    }',
      '}',
    ],
  },
  'swift:factory:convenience_init': {
    label: 'convenience init',
    code: [
      'convenience init(title: String) {',
      '    self.init()',
      '    self.title = title',
      '}',
    ],
  },
  'swift:observer:notif_closure': {
    label: 'NotificationCenter closure',
    code: [
      'let observer = NotificationCenter.default.addObserver(',
      '    forName: .someEvent, object: nil, queue: .main',
      ') { [weak self] _ in',
      '    self?.handleEvent()',
      '}',
    ],
  },
  'swift:observer:published': {
    label: '@Published 属性',
    code: [
      'class ViewModel: ObservableObject {',
      '    @Published var items: [Item] = []',
      '}',
    ],
  },
  'swift:observer:combine': {
    label: 'Combine .sink',
    code: [
      'viewModel.$items',
      '    .sink { [weak self] newItems in',
      '        self?.updateUI(with: newItems)',
      '    }',
      '    .store(in: &cancellables)',
    ],
  },

  // ══════════════ ObjC: best-practice ══════════════
  'objectivec:errorHandling:nserror_out': {
    label: 'NSError** 输出参数',
    code: [
      '- (BOOL)doSomethingWithError:(NSError **)error {',
      '    if (/* 失败条件 */) {',
      '        if (error) {',
      '            *error = [NSError errorWithDomain:@"{PREFIX}ErrorDomain"',
      '                code:100 userInfo:@{NSLocalizedDescriptionKey: @"描述"}];',
      '        }',
      '        return NO;',
      '    }',
      '    return YES;',
      '}',
    ],
  },
  'objectivec:concurrency:dispatch_main': {
    label: 'dispatch_async 主线程',
    code: [
      'dispatch_async(dispatch_get_main_queue(), ^{',
      '    [self updateUI];',
      '});',
    ],
  },
  'objectivec:concurrency:dispatch_global': {
    label: 'dispatch_async 后台线程',
    code: [
      'dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{',
      '    // 后台任务',
      '    dispatch_async(dispatch_get_main_queue(), ^{',
      '        [self updateUI];',
      '    });',
      '});',
    ],
  },
  'objectivec:memoryMgmt:weak_strong': {
    label: '手动 weakSelf/strongSelf',
    code: [
      '__weak typeof(self) weakSelf = self;',
      '[self doAsync:^{',
      '    __strong typeof(weakSelf) strongSelf = weakSelf;',
      '    if (!strongSelf) return;',
      '    [strongSelf doWork];',
      '}];',
    ],
  },
  'objectivec:memoryMgmt:weakify': {
    label: '@weakify/@strongify 宏',
    code: [
      '@weakify(self);',
      '[self doAsync:^{',
      '    @strongify(self);',
      '    [self doWork];',
      '}];',
    ],
  },

  // ══════════════ Swift: best-practice ══════════════
  'swift:errorHandling:guard_let': {
    label: 'guard let...else',
    code: [
      'func process(data: Data?) throws {',
      '    guard let data = data else {',
      '        throw SomeError.noData',
      '    }',
      '    // 使用 data',
      '}',
    ],
  },
  'swift:errorHandling:do_try_catch': {
    label: 'do { try } catch',
    code: [
      'do {',
      '    let result = try service.fetch()',
      '    handle(result)',
      '} catch {',
      '    showError(error)',
      '}',
    ],
  },
  'swift:concurrency:async_await': {
    label: 'async/await',
    code: [
      'func fetchData() async throws -> Data {',
      '    let (data, _) = try await URLSession.shared.data(from: url)',
      '    return data',
      '}',
    ],
  },

  // ══════════════ ObjC: event-and-data-flow ══════════════
  'objectivec:notification:selector_add': {
    label: 'addObserver:selector: 注册',
    code: [
      '[[NSNotificationCenter defaultCenter] addObserver:self',
      '    selector:@selector(handleEvent:)',
      '        name:kSomeNotification object:nil];',
    ],
  },
  'objectivec:notification:block_add': {
    label: 'addObserverForName:usingBlock:',
    code: [
      'id __block token = [[NSNotificationCenter defaultCenter]',
      '    addObserverForName:kSomeNotification object:nil queue:nil',
      '    usingBlock:^(NSNotification *note) {',
      '        // 处理',
      '    }];',
    ],
  },
  'objectivec:callback:block_typedef': {
    label: 'Block typedef 回调',
    code: [
      'typedef void (^CompletionBlock)(id result, NSError *error);',
      '',
      '- (void)loadWithCompletion:(CompletionBlock)completion {',
      '    // ...',
      '    if (completion) completion(data, nil);',
      '}',
    ],
  },
  'objectivec:kvo:add_observer': {
    label: 'KVO addObserver',
    code: [
      '[self.obj addObserver:self forKeyPath:@"prop"',
      '    options:NSKeyValueObservingOptionNew context:nil];',
    ],
  },

  // ══════════════ Swift: event-and-data-flow ══════════════
  'swift:notification:closure_add': {
    label: 'addObserver(forName:) closure',
    code: [
      'NotificationCenter.default.addObserver(',
      '    forName: .didUpdate, object: nil, queue: .main',
      ') { [weak self] note in',
      '    self?.refresh()',
      '}',
    ],
  },
  'swift:callback:trailing_closure': {
    label: '尾随闭包回调',
    code: [
      'func fetch(completion: @escaping (Result<Data, Error>) -> Void) {',
      '    // ...',
      '    completion(.success(data))',
      '}',
      '',
      'fetch { result in',
      '    switch result {',
      '    case .success(let d): handle(d)',
      '    case .failure(let e): show(e)',
      '    }',
      '}',
    ],
  },
};

/**
 * 业界标准完整示例
 * 每个 key 格式为 `${lang}:${patternKey}`，对应 patterns.js 中的 pattern key
 */
export const CANONICAL_EXAMPLES = {
  // ── ObjC ──
  'objectivec:notification': {
    label: 'NSNotification 完整使用链',
    code: [
      '// ✅ 标准写法：注册 + 处理 + 移除（三件套）',
      '// 1. 注册通知',
      '[[NSNotificationCenter defaultCenter] addObserver:self',
      '                                         selector:@selector(handleUserDidLogin:)',
      '                                             name:@"UserDidLoginNotification"',
      '                                           object:nil];',
      '',
      '// 2. 处理通知',
      '- (void)handleUserDidLogin:(NSNotification *)notification {',
      '    NSDictionary *userInfo = notification.userInfo;',
      '    NSString *userId = userInfo[@"userId"];',
      '    [self refreshDataForUser:userId];',
      '}',
      '',
      '// 3. 移除通知（dealloc 中）',
      '- (void)dealloc {',
      '    [[NSNotificationCenter defaultCenter] removeObserver:self];',
      '}',
      '',
      '// 4. 发送通知',
      '[[NSNotificationCenter defaultCenter] postNotificationName:@"UserDidLoginNotification"',
      '                                                    object:self',
      '                                                  userInfo:@{@"userId": userId}];',
    ],
  },
  'objectivec:kvo': {
    label: 'KVO 完整使用链',
    code: [
      '// ✅ 标准写法：注册观察 + 响应变化 + 移除观察（三件套）',
      '// 1. 注册 KVO 观察',
      '[self.player addObserver:self',
      '                forKeyPath:@"status"',
      '                   options:NSKeyValueObservingOptionNew | NSKeyValueObservingOptionOld',
      '                   context:nil];',
      '',
      '// 2. 响应属性变化',
      '- (void)observeValueForKeyPath:(NSString *)keyPath',
      '                      ofObject:(id)object',
      '                        change:(NSDictionary<NSKeyValueChangeKey,id> *)change',
      '                       context:(void *)context {',
      '    if ([keyPath isEqualToString:@"status"]) {',
      '        NSInteger newStatus = [change[NSKeyValueChangeNewKey] integerValue];',
      '        [self handleStatusChange:newStatus];',
      '    }',
      '}',
      '',
      '// 3. 移除观察（dealloc 中，防止崩溃）',
      '- (void)dealloc {',
      '    [self.player removeObserver:self forKeyPath:@"status"];',
      '}',
    ],
  },
  'objectivec:callback': {
    label: 'Block 回调完整写法',
    code: [
      '// ✅ 标准写法：定义 + 调用 + 弱引用防循环',
      '// 1. 定义 Block 类型',
      'typedef void (^CompletionHandler)(NSData * _Nullable data, NSError * _Nullable error);',
      '',
      '// 2. 方法声明',
      '- (void)fetchDataWithCompletion:(CompletionHandler)completion;',
      '',
      '// 3. 调用时使用 weakSelf 防循环引用',
      '__weak typeof(self) weakSelf = self;',
      '[self fetchDataWithCompletion:^(NSData *data, NSError *error) {',
      '    __strong typeof(weakSelf) strongSelf = weakSelf;',
      '    if (!strongSelf) return;',
      '    if (error) {',
      '        [strongSelf handleError:error];',
      '    } else {',
      '        [strongSelf processData:data];',
      '    }',
      '}];',
    ],
  },
  'objectivec:target_action': {
    label: 'Target-Action 完整写法',
    code: [
      '// ✅ 标准写法：添加 Target + 实现 Action',
      '// 1. 添加 Target-Action',
      '[button addTarget:self action:@selector(didTapSubmitButton:)',
      '    forControlEvents:UIControlEventTouchUpInside];',
      '',
      '// 2. 实现 Action 方法',
      '- (void)didTapSubmitButton:(UIButton *)sender {',
      '    sender.enabled = NO;',
      '    [self submitForm];',
      '}',
    ],
  },
  // ── Swift ──
  'swift:notification': {
    label: 'NotificationCenter 完整使用链',
    code: [
      '// ✅ 标准写法：注册 + 处理 + 移除',
      '// 1. 注册通知（推荐 Closure 方式，自动管理生命周期）',
      'private var loginObserver: NSObjectProtocol?',
      '',
      'func setupObservers() {',
      '    loginObserver = NotificationCenter.default.addObserver(',
      '        forName: .userDidLogin,',
      '        object: nil,',
      '        queue: .main',
      '    ) { [weak self] notification in',
      '        guard let userId = notification.userInfo?["userId"] as? String else { return }',
      '        self?.refreshData(for: userId)',
      '    }',
      '}',
      '',
      '// 2. 发送通知',
      'NotificationCenter.default.post(',
      '    name: .userDidLogin,',
      '    object: self,',
      '    userInfo: ["userId": userId]',
      ')',
      '',
      '// 3. 移除（deinit 中）',
      'deinit {',
      '    if let observer = loginObserver {',
      '        NotificationCenter.default.removeObserver(observer)',
      '    }',
      '}',
    ],
  },
  'swift:kvo': {
    label: 'KVO / 属性观察完整写法',
    code: [
      '// ✅ 方式 1：Swift 原生属性观察器',
      'var score: Int = 0 {',
      '    willSet { print("即将变为 \\(newValue)") }',
      '    didSet  { updateScoreLabel(oldValue: oldValue) }',
      '}',
      '',
      '// ✅ 方式 2：KVO observe API（观察 ObjC 动态属性）',
      'private var observation: NSKeyValueObservation?',
      '',
      'func startObserving() {',
      '    observation = player.observe(\\.status, options: [.new, .old]) { [weak self] player, change in',
      '        guard let newStatus = change.newValue else { return }',
      '        self?.handleStatusChange(newStatus)',
      '    }',
      '}',
      '',
      '// observation 在 deinit 时自动释放，无需手动 removeObserver',
    ],
  },
  'swift:callback': {
    label: 'Closure 回调完整写法',
    code: [
      '// ✅ 标准写法：typealias + [weak self] + Result',
      'typealias FetchCompletion = (Result<Data, Error>) -> Void',
      '',
      'func fetchData(completion: @escaping FetchCompletion) {',
      '    URLSession.shared.dataTask(with: url) { data, _, error in',
      '        if let error = error {',
      '            completion(.failure(error))',
      '        } else if let data = data {',
      '            completion(.success(data))',
      '        }',
      '    }.resume()',
      '}',
      '',
      '// 调用时使用 [weak self]',
      'fetchData { [weak self] result in',
      '    switch result {',
      '    case .success(let data): self?.process(data)',
      '    case .failure(let error): self?.showError(error)',
      '    }',
      '}',
    ],
  },
  'swift:reactive': {
    label: 'Combine 响应式完整写法',
    code: [
      '// ✅ 标准写法：Publisher + Subscriber + cancellable 管理',
      'private var cancellables = Set<AnyCancellable>()',
      '',
      '// 1. 发布者',
      '@Published var searchText: String = ""',
      '',
      '// 2. 订阅并处理',
      'func setupBindings() {',
      '    $searchText',
      '        .debounce(for: .milliseconds(300), scheduler: RunLoop.main)',
      '        .removeDuplicates()',
      '        .sink { [weak self] text in',
      '            self?.performSearch(text)',
      '        }',
      '        .store(in: &cancellables)',
      '}',
      '',
      '// cancellables 在 deinit 时自动取消订阅',
    ],
  },
};

/**
 * 检查项目中是否包含"完整使用链"的各个环节
 *
 * 重要：扫描 matchingFiles 的完整内容（而非仅提取的代码块），
 * 因为 extractEnclosingBlock 只提取 ~35 行，而 KVO 的 addObserver / observeValueForKeyPath
 * 通常在不同方法中，单靠代码块会产生大量误报。
 *
 * @param {string} key - pattern key
 * @param {string} lang - 语言
 * @param {object[]} matchingFiles - 所有匹配该 pattern 的文件（含完整 content）
 * @returns {string[]|null} 缺失环节列表，完整则返回 null
 */
export function checkCompleteness(key, lang, matchingFiles) {
  // 扫描所有匹配文件的完整内容（而非仅提取的代码块），避免误报
  const allCode = matchingFiles.slice(0, 10).map(f => f.content).join('\n');

  if (key === 'notification') {
    if (lang === 'objectivec') {
      const hasRegister = /addObserver:/.test(allCode);
      const hasHandler = /@selector\(\w+:\)/.test(allCode) && /(void)\s*\w+.*NSNotification/.test(allCode);
      const hasPost = /postNotificationName:/.test(allCode);
      const hasRemove = /removeObserver:/.test(allCode);
      const missing = [];
      if (!hasRegister) missing.push('注册观察');
      if (!hasHandler) missing.push('处理方法');
      if (!hasPost) missing.push('发送通知');
      if (!hasRemove) missing.push('移除观察');
      return missing.length > 0 ? missing : null;
    }
    if (lang === 'swift') {
      const hasAdd = /addObserver/.test(allCode);
      const hasPost = /\.post\(/.test(allCode);
      const hasRemove = /removeObserver/.test(allCode) || /deinit/.test(allCode);
      const missing = [];
      if (!hasAdd) missing.push('注册观察');
      if (!hasPost) missing.push('发送通知');
      if (!hasRemove) missing.push('移除/deinit');
      return missing.length > 0 ? missing : null;
    }
  }

  if (key === 'kvo') {
    if (lang === 'objectivec') {
      const hasAdd = /addObserver:.*forKeyPath/.test(allCode);
      const hasObserve = /observeValueForKeyPath:/.test(allCode);
      const hasRemove = /removeObserver:.*forKeyPath/.test(allCode);
      const missing = [];
      if (!hasAdd) missing.push('注册观察');
      if (!hasObserve) missing.push('observeValueForKeyPath 回调');
      if (!hasRemove) missing.push('removeObserver');
      return missing.length > 0 ? missing : null;
    }
    if (lang === 'swift') {
      const hasObserve = /\.observe\(/.test(allCode) || /didSet|willSet/.test(allCode);
      const hasHandler = /change\.newValue|oldValue/.test(allCode) || /didSet|willSet/.test(allCode);
      return (!hasObserve || !hasHandler) ? ['完整观察+处理链'] : null;
    }
  }

  if (key === 'callback') {
    if (lang === 'objectivec') {
      const hasDef = /typedef\s+void\s*\(\^|completion[Hh]andler|Block\b/.test(allCode);
      const hasWeakSelf = /weakSelf|__weak/.test(allCode);
      const missing = [];
      if (!hasDef) missing.push('Block 定义');
      if (!hasWeakSelf) missing.push('弱引用防循环');
      return missing.length > 0 ? missing : null;
    }
  }

  return null; // 不做完整性检查的 pattern
}
