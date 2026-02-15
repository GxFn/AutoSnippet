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
  'objectivec:protocol-delegate:optional': {
    label: '@optional 方法声明',
    code: [
      '@protocol {PREFIX}ViewDelegate <NSObject>',
      '@required',
      '- (void)viewDidLoad;',
      '@optional',
      '- (void)viewWillAppear;',
      '- (void)viewDidDisappear;',
      '@end',
    ],
  },
  'objectivec:observer:notif_block': {
    label: 'Notification + Block',
    code: [
      'id observer = [[NSNotificationCenter defaultCenter]',
      '    addObserverForName:@"SomeEvent" object:nil queue:[NSOperationQueue mainQueue]',
      '    usingBlock:^(NSNotification *note) {',
      '        [self handleEvent:note];',
      '    }];',
    ],
  },
  'objectivec:builder:config_block': {
    label: '配置 Block',
    code: [
      '+ (instancetype)viewWithConfig:(void (^)({PREFIX}View *view))configBlock {',
      '    {PREFIX}View *view = [[self alloc] init];',
      '    if (configBlock) configBlock(view);',
      '    return view;',
      '}',
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
  'swift:singleton:private_init': {
    label: 'private init() 保护',
    code: [
      'final class Manager {',
      '    static let shared = Manager()',
      '    private init() {} // 防止外部创建实例',
      '}',
    ],
  },
  'swift:protocol-delegate:optional_chain': {
    label: 'delegate?.method 可选链',
    code: [
      'weak var delegate: SomeDelegate?',
      '',
      'func finish() {',
      '    delegate?.didComplete(result: data)',
      '}',
    ],
  },
  'swift:protocol-delegate:protocol_decl': {
    label: 'protocol Delegate 声明',
    code: [
      'protocol DataSourceDelegate: AnyObject {',
      '    func dataSource(_ ds: DataSource, didUpdate items: [Item])',
      '}',
    ],
  },
  'swift:factory:class_func': {
    label: 'class func make…',
    code: [
      'class func makeDefault() -> Self {',
      '    let instance = self.init()',
      '    instance.configure()',
      '    return instance',
      '}',
    ],
  },
  'swift:factory:static_func': {
    label: 'static func create/from',
    code: [
      'static func from(json: [String: Any]) -> Model? {',
      '    guard let name = json["name"] as? String else { return nil }',
      '    return Model(name: name)',
      '}',
    ],
  },
  'swift:builder:fluent': {
    label: '-> Self 流式构建',
    code: [
      'func setTitle(_ title: String) -> Self {',
      '    self.title = title',
      '    return self',
      '}',
      '',
      'let view = Builder().setTitle("hi").setColor(.red).build()',
    ],
  },
  'swift:builder:result_builder': {
    label: '@resultBuilder',
    code: [
      '@resultBuilder',
      'struct ViewBuilder {',
      '    static func buildBlock(_ components: View...) -> [View] {',
      '        components',
      '    }',
      '}',
    ],
  },
  'swift:observer:did_set': {
    label: 'willSet/didSet 观察',
    code: [
      'var score: Int = 0 {',
      '    didSet {',
      '        scoreLabel.text = "\\(score)"',
      '    }',
      '}',
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
  'objectivec:concurrency:dispatch_group': {
    label: 'GCD Group',
    code: [
      'dispatch_group_t group = dispatch_group_create();',
      'dispatch_group_enter(group);',
      '[self loadData:^{',
      '    dispatch_group_leave(group);',
      '}];',
      'dispatch_group_notify(group, dispatch_get_main_queue(), ^{',
      '    [self allTasksCompleted];',
      '});',
    ],
  },
  'objectivec:concurrency:semaphore': {
    label: '信号量 Semaphore',
    code: [
      'dispatch_semaphore_t sema = dispatch_semaphore_create(0);',
      '[self asyncTask:^{',
      '    dispatch_semaphore_signal(sema);',
      '}];',
      'dispatch_semaphore_wait(sema, DISPATCH_TIME_FOREVER);',
    ],
  },
  'objectivec:concurrency:nsoperation': {
    label: 'NSOperation 队列',
    code: [
      'NSOperationQueue *queue = [[NSOperationQueue alloc] init];',
      'queue.maxConcurrentOperationCount = 3;',
      '[queue addOperationWithBlock:^{',
      '    // 后台任务',
      '    [[NSOperationQueue mainQueue] addOperationWithBlock:^{',
      '        [self updateUI];',
      '    }];',
      '}];',
    ],
  },
  'objectivec:concurrency:synchronized': {
    label: '@synchronized 锁',
    code: [
      '@synchronized (self) {',
      '    [self.mutableArray addObject:obj];',
      '}',
    ],
  },
  'objectivec:errorHandling:try_catch': {
    label: '@try/@catch 异常',
    code: [
      '@try {',
      '    [self riskyOperation];',
      '} @catch (NSException *exception) {',
      '    NSLog(@"异常: %@", exception.reason);',
      '} @finally {',
      '    [self cleanup];',
      '}',
    ],
  },
  'objectivec:errorHandling:nil_check': {
    label: 'if (!result) 条件检查',
    code: [
      'id result = [self fetchData];',
      'if (!result) {',
      '    [self handleError];',
      '    return;',
      '}',
      '[self processData:result];',
    ],
  },
  'objectivec:memoryMgmt:dealloc_cleanup': {
    label: 'dealloc 清理',
    code: [
      '- (void)dealloc {',
      '    [[NSNotificationCenter defaultCenter] removeObserver:self];',
      '    [_timer invalidate];',
      '}',
    ],
  },
  'objectivec:memoryMgmt:autoreleasepool': {
    label: '@autoreleasepool',
    code: [
      '@autoreleasepool {',
      '    for (int i = 0; i < 10000; i++) {',
      '        NSString *str = [NSString stringWithFormat:@"%d", i];',
      '        [self process:str];',
      '    }',
      '}',
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
  'swift:concurrency:task_block': {
    label: 'Task { }',
    code: [
      'Task {',
      '    let data = try await fetchData()',
      '    await MainActor.run {',
      '        self.items = data',
      '    }',
      '}',
    ],
  },
  'swift:concurrency:dispatch_main': {
    label: 'DispatchQueue.main',
    code: [
      'DispatchQueue.main.async {',
      '    self.tableView.reloadData()',
      '}',
    ],
  },
  'swift:concurrency:dispatch_global': {
    label: 'DispatchQueue.global',
    code: [
      'DispatchQueue.global(qos: .userInitiated).async {',
      '    let result = self.heavyComputation()',
      '    DispatchQueue.main.async {',
      '        self.updateUI(with: result)',
      '    }',
      '}',
    ],
  },
  'swift:concurrency:actor': {
    label: 'actor',
    code: [
      'actor DataStore {',
      '    private var items: [Item] = []',
      '',
      '    func add(_ item: Item) {',
      '        items.append(item)',
      '    }',
      '',
      '    func getAll() -> [Item] { items }',
      '}',
    ],
  },
  'swift:errorHandling:result_type': {
    label: 'Result<Success, Failure>',
    code: [
      'func fetch(completion: @escaping (Result<Data, Error>) -> Void) {',
      '    URLSession.shared.dataTask(with: url) { data, _, error in',
      '        if let error { completion(.failure(error)) }',
      '        else if let data { completion(.success(data)) }',
      '    }.resume()',
      '}',
    ],
  },
  'swift:errorHandling:optional_try': {
    label: 'try? 可选尝试',
    code: [
      'let data = try? JSONSerialization.data(withJSONObject: dict)',
      'guard let data else { return }',
    ],
  },
  'swift:memoryMgmt:weak_self': {
    label: '[weak self] in',
    code: [
      'service.fetch { [weak self] result in',
      '    guard let self else { return }',
      '    self.handleResult(result)',
      '}',
    ],
  },
  'swift:memoryMgmt:guard_self': {
    label: 'guard let self = self',
    code: [
      'fetchData { [weak self] data in',
      '    guard let self else { return }',
      '    self.items = data',
      '    self.tableView.reloadData()',
      '}',
    ],
  },
  'swift:memoryMgmt:unowned': {
    label: '[unowned self]',
    code: [
      '// 仅当确定 self 不会在闭包执行前释放时使用',
      'lazy var formatter: NumberFormatter = { [unowned self] in',
      '    let f = NumberFormatter()',
      '    f.locale = self.locale',
      '    return f',
      '}()',
    ],
  },
  'swift:memoryMgmt:deinit': {
    label: 'deinit { } 清理',
    code: [
      'deinit {',
      '    NotificationCenter.default.removeObserver(self)',
      '    timer?.invalidate()',
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
  'objectivec:callback:typedef_block': {
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
  'objectivec:kvo:register': {
    label: 'KVO addObserver',
    code: [
      '[self.obj addObserver:self forKeyPath:@"prop"',
      '    options:NSKeyValueObservingOptionNew context:nil];',
    ],
  },
  'objectivec:notification:post': {
    label: 'postNotificationName: 发送',
    code: [
      '[[NSNotificationCenter defaultCenter]',
      '    postNotificationName:@"DataDidUpdate"',
      '    object:self',
      '    userInfo:@{@"count": @(self.items.count)}];',
    ],
  },
  'objectivec:callback:completion': {
    label: 'completionHandler 参数',
    code: [
      '- (void)loadWithCompletion:(void (^)(NSArray *items, NSError *error))completion {',
      '    dispatch_async(dispatch_get_global_queue(0, 0), ^{',
      '        NSArray *items = [self fetchFromDB];',
      '        dispatch_async(dispatch_get_main_queue(), ^{',
      '            if (completion) completion(items, nil);',
      '        });',
      '    });',
      '}',
    ],
  },
  'objectivec:callback:inline_block': {
    label: '内联 ^{ } Block',
    code: [
      '[UIView animateWithDuration:0.3 animations:^{',
      '    self.view.alpha = 1.0;',
      '} completion:^(BOOL finished) {',
      '    [self didFinishAnimation];',
      '}];',
    ],
  },
  'objectivec:callback:success_fail': {
    label: 'success/failure 双 Block',
    code: [
      '- (void)requestWithSuccess:(void (^)(id response))success',
      '                   failure:(void (^)(NSError *error))failure {',
      '    if (data) {',
      '        success(data);',
      '    } else {',
      '        failure(error);',
      '    }',
      '}',
    ],
  },
  'objectivec:kvo:callback': {
    label: 'observeValueForKeyPath: 回调',
    code: [
      '- (void)observeValueForKeyPath:(NSString *)keyPath',
      '                      ofObject:(id)object',
      '                        change:(NSDictionary *)change',
      '                       context:(void *)context {',
      '    if ([keyPath isEqualToString:@"status"]) {',
      '        [self handleStatusChange];',
      '    }',
      '}',
    ],
  },
  'objectivec:kvo:remove_kvo': {
    label: 'removeObserver:forKeyPath: 注销',
    code: [
      '- (void)dealloc {',
      '    [self.player removeObserver:self forKeyPath:@"status"];',
      '}',
    ],
  },
  'objectivec:target_action:add_target': {
    label: 'addTarget:action:forControlEvents:',
    code: [
      '[button addTarget:self',
      '           action:@selector(didTapButton:)',
      ' forControlEvents:UIControlEventTouchUpInside];',
    ],
  },
  'objectivec:target_action:selector': {
    label: '@selector() Action 方法',
    code: [
      '- (void)didTapButton:(UIButton *)sender {',
      '    sender.enabled = NO;',
      '    [self handleAction];',
      '}',
    ],
  },
  'objectivec:persistence:userdefaults': {
    label: 'NSUserDefaults',
    code: [
      '// 存储',
      '[[NSUserDefaults standardUserDefaults] setObject:@"value" forKey:@"key"];',
      '[[NSUserDefaults standardUserDefaults] synchronize];',
      '',
      '// 读取',
      'NSString *val = [[NSUserDefaults standardUserDefaults] objectForKey:@"key"];',
    ],
  },
  'objectivec:persistence:coredata': {
    label: 'Core Data',
    code: [
      'NSFetchRequest *req = [NSFetchRequest fetchRequestWithEntityName:@"Item"];',
      'req.predicate = [NSPredicate predicateWithFormat:@"name == %@", name];',
      'NSArray *results = [context executeFetchRequest:req error:nil];',
    ],
  },
  'objectivec:persistence:nscoding': {
    label: 'NSCoding 归档',
    code: [
      '// 归档',
      'NSData *data = [NSKeyedArchiver archivedDataWithRootObject:obj',
      '    requiringSecureCoding:NO error:nil];',
      '',
      '// 解档',
      'id obj = [NSKeyedUnarchiver unarchivedObjectOfClass:[MyClass class]',
      '    fromData:data error:nil];',
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
  'swift:callback:escaping': {
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
  'swift:notification:publisher': {
    label: 'NotificationCenter.publisher (Combine)',
    code: [
      'NotificationCenter.default.publisher(for: .didUpdate)',
      '    .sink { [weak self] _ in',
      '        self?.refresh()',
      '    }',
      '    .store(in: &cancellables)',
    ],
  },
  'swift:notification:post': {
    label: '.post 发送',
    code: [
      'NotificationCenter.default.post(',
      '    name: .dataDidUpdate, object: self,',
      '    userInfo: ["count": items.count]',
      ')',
    ],
  },
  'swift:callback:completion': {
    label: 'completion: Handler',
    code: [
      'func fetch(completion: @escaping (Result<[Item], Error>) -> Void) {',
      '    URLSession.shared.dataTask(with: url) { data, _, error in',
      '        completion(.success(items))',
      '    }.resume()',
      '}',
    ],
  },
  'swift:kvo:did_set': {
    label: 'didSet 属性观察',
    code: [
      'var score: Int = 0 {',
      '    didSet {',
      '        scoreLabel.text = "\\(score)"',
      '    }',
      '}',
    ],
  },
  'swift:kvo:will_set': {
    label: 'willSet 属性观察',
    code: [
      'var name: String = "" {',
      '    willSet { print("即将变为: \\(newValue)") }',
      '    didSet  { nameLabel.text = name }',
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
