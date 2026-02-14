/**
 * Bootstrap — 多语言代码模式匹配
 *
 * 提供各语言的正则模式集合和代码块提取工具，
 * 供维度提取器（dimensions.js）使用。
 */

/**
 * 获取语言对应的类型定义正则
 */
export function getTypeDefPattern(lang) {
  switch (lang) {
    case 'objectivec':
      return /^\s*@(interface|implementation|protocol)\s+\w+/m;
    case 'swift':
      return /^\s*(public |open |internal |private |fileprivate )?(final\s+)?(class|struct|protocol|enum)\s+\w+/m;
    case 'javascript': case 'typescript':
      return /^\s*(export\s+)?(default\s+)?(abstract\s+)?(class|interface|type|enum)\s+\w+/m;
    case 'python':
      return /^\s*class\s+\w+/m;
    case 'java': case 'kotlin':
      return /^\s*(public |private |protected )?(abstract |data |sealed |open )?(class|interface|enum|object)\s+\w+/m;
    case 'go':
      return /^\s*type\s+\w+\s+(struct|interface)\b/m;
    case 'rust':
      return /^\s*(pub\s+)?(struct|enum|trait|impl)\s+\w+/m;
    default:
      return /^\s*(class|struct|protocol|enum|interface|type)\s+\w+/m;
  }
}

/**
 * 获取语言对应的最佳实践模式集合
 */
export function getBestPracticePatterns(lang) {
  switch (lang) {
    case 'objectivec':
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(NSError\s*\*|@try\b|@catch\b|@throw\b|@finally\b|error:\s*\(NSError|if\s*\(\s*error\b|if\s*\(\s*!\s*\w+\s*\))/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(dispatch_async|dispatch_sync|dispatch_queue_create|dispatch_group|dispatch_semaphore|NSOperation|NSThread|@synchronized|performSelector.*Thread|dispatch_barrier)/,
        },
        memoryMgmt: { label: '内存管理',
          regex: /\b(__weak|__strong|__unsafe_unretained|weakSelf|strongSelf|typeof\(self\)|__block|dealloc\b|autoreleasepool|removeObserver)/,
        },
      };
    case 'swift':
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(guard .+ else|throw\s|catch\s*[{(]|do\s*\{|Result<|try[?!]?\s)/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(async\b|await\b|Task\s*\{|Task\.detached|actor\b|@MainActor|@Sendable|DispatchQueue|TaskGroup)/,
        },
        memoryMgmt: { label: '内存管理',
          regex: /\b(\[weak\s|weak\s+var|unowned\s|autoreleasepool|deinit\b|\[unowned\s)/,
        },
      };
    case 'javascript': case 'typescript':
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(try\s*\{|catch\s*\(|throw\s+new|\.catch\(|Promise\.reject|if\s*\(\s*err\b)/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(async\s+function|await\s|Promise\.all|Promise\.allSettled|new\s+Worker|setTimeout|setInterval|process\.nextTick)/,
        },
        memoryMgmt: { label: '资源管理',
          regex: /\b(\.close\(\)|\.destroy\(\)|\.dispose\(\)|finally\s*\{|AbortController|clearTimeout|clearInterval|removeEventListener)/,
        },
      };
    case 'python':
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(try:|except\s|raise\s|finally:|with\s.*as\s)/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(async\s+def|await\s|asyncio\.|threading\.|multiprocessing\.|concurrent\.futures|Lock\(\)|Semaphore\()/,
        },
        memoryMgmt: { label: '资源管理',
          regex: /\b(with\s+open|__enter__|__exit__|contextmanager|\.close\(\)|atexit|weakref|gc\.collect)/,
        },
      };
    default:
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(try|catch|throw|except|raise|error|Error)\b/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(async|await|thread|Thread|dispatch|concurrent|parallel|mutex|lock|Lock)\b/,
        },
        memoryMgmt: { label: '内存/资源管理',
          regex: /\b(close|dispose|destroy|cleanup|dealloc|free|release|finalize|defer)\b/,
        },
      };
  }
}

/**
 * 获取语言对应的调用链模式集合
 */
export function getCallChainPatterns(lang) {
  switch (lang) {
    case 'objectivec':
      return {
        delegate: { label: 'Delegate 委托',
          regex: /\b(delegate\b|Delegate\b|<\w+Delegate>|setDelegate:|\.delegate\s*=)/,
        },
        notification: { label: 'Notification 通知',
          regex: /\b(NSNotificationCenter|addObserver:|removeObserver:|postNotificationName:|NSNotification\b|\[\[NSNotificationCenter)/,
        },
        callback: { label: 'Block 回调',
          regex: /\b(completion[Hh]andler|completionBlock|success[Bb]lock|failure[Bb]lock|callback\b|\^\s*void|\^\s*\(|typedef\s+void\s*\(\^)/,
        },
        target_action: { label: 'Target-Action',
          regex: /\b(addTarget:|@selector\(|performSelector|action:@selector|SEL\s)/,
        },
      };
    case 'swift':
      return {
        delegate: { label: 'Delegate 委托',
          regex: /\b(delegate\b|Delegate\b|\.delegate\s*=|protocol\s+\w+Delegate)/,
        },
        notification: { label: 'Notification 通知',
          regex: /\b(NotificationCenter|\.post\(|\.addObserver|Notification\.Name)/,
        },
        reactive: { label: '响应式 (Combine/Rx)',
          regex: /\b(Publisher|Subscriber|\.sink\s*\{|\.subscribe|Combine|RxSwift|AnyPublisher|eraseToAnyPublisher)/,
        },
        callback: { label: 'Callback / Closure',
          regex: /\b(completion\s*:|handler\s*:|callback\s*:|escaping\s|@escaping)/,
        },
      };
    case 'javascript': case 'typescript':
      return {
        eventEmitter: { label: 'EventEmitter',
          regex: /\b(\.on\(|\.emit\(|\.addEventListener\(|\.removeEventListener|EventEmitter|EventTarget)/,
        },
        callback: { label: 'Callback / Promise',
          regex: /\b(\.then\(|\.catch\(|callback\s*[:(]|\.subscribe\(|new\s+Promise)/,
        },
        observable: { label: '响应式 (RxJS)',
          regex: /\b(Observable|Subject|BehaviorSubject|pipe\(|switchMap|mergeMap|combineLatest)/,
        },
      };
    default:
      return {
        delegate: { label: 'Delegate / 委托',
          regex: /\b(delegate|Delegate|listener|Listener|handler|Handler|callback|Callback)\b/,
        },
        notification: { label: '事件/通知',
          regex: /\b(notify|Notification|event|Event|emit|signal|Signal|publish|subscribe)\b/,
        },
      };
  }
}

/**
 * 获取语言对应的数据流模式集合
 */
export function getDataFlowPatterns(lang) {
  switch (lang) {
    case 'objectivec':
      return {
        kvo: { label: 'KVO',
          regex: /\b(addObserver:.*forKeyPath|observeValueForKeyPath|removeObserver:.*forKeyPath|NSKeyValueObservingOptionNew)/,
        },
        property: { label: '属性声明',
          regex: /^\s*@property\s*\(/m,
        },
        persistence: { label: '数据持久化',
          regex: /\b(NSUserDefaults|NSCoding|NSCoreDataStack|NSManagedObject|NSFetchRequest|CoreData\b|sqlite|\bRealm\b|\bFMDB\b)/,
        },
        singleton: { label: 'Singleton',
          regex: /\b(sharedInstance|shared\b|defaultManager|dispatch_once|static\s+\w+\s*\*\s*_instance)/,
        },
      };
    case 'swift':
      return {
        swiftui: { label: 'SwiftUI 状态',
          regex: /\b(@Published|@State|@Binding|@Observable|@Environment|@ObservedObject|@StateObject|@EnvironmentObject)\b/,
        },
        combine: { label: 'Combine / Subject',
          regex: /\b(CurrentValueSubject|PassthroughSubject|AnyPublisher|Just\(|Future\(|\.assign\(to:)/,
        },
        kvo: { label: 'KVO / 属性观察',
          regex: /\b(willSet|didSet|observe\(|@objc\s+dynamic)/,
        },
      };
    case 'javascript': case 'typescript':
      return {
        stateManagement: { label: '状态管理',
          regex: /\b(useState|useReducer|createStore|createSlice|atom\(|ref\(|reactive\(|writable\(|signal\()/,
        },
        dataBinding: { label: '数据绑定',
          regex: /\b(useEffect|useMemo|computed|watch\(|subscribe|mobx|observable)/,
        },
      };
    case 'python':
      return {
        dataclass: { label: '数据模型',
          regex: /\b(@dataclass|BaseModel|pydantic|@property|__init__\s*\(self)/,
        },
        stateManagement: { label: '状态管理',
          regex: /\b(signal|slot|@receiver|django\.dispatch|celery|redis|queue\.Queue)/,
        },
      };
    default:
      return {
        stateManagement: { label: '状态/数据管理',
          regex: /\b(state|State|store|Store|model|Model|repository|Repository|cache|Cache)\b/,
        },
      };
  }
}

/**
 * 提取包含目标行的完整方法/函数体（大括号平衡法，适用 C 系语言）。
 * 返回提取的代码行数组。如果无法找到方法边界则返回上下文。
 *
 * @param {string[]} lines - 文件所有行
 * @param {number} targetIdx - 0-based 行索引
 * @param {string} lang - 语言标识
 * @param {number} maxLines - 最大提取行数
 * @returns {string[]}
 */
export function extractEnclosingBlock(lines, targetIdx, lang, maxLines = 40) {
  // Python：基于缩进
  if (lang === 'python') {
    let startIdx = targetIdx;
    for (let i = targetIdx; i >= Math.max(0, targetIdx - 50); i--) {
      if (/^\s*(def |class |async\s+def )/.test(lines[i])) { startIdx = i; break; }
    }
    const baseIndent = lines[startIdx].search(/\S/);
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + maxLines); i++) {
      if (lines[i].trim() === '') { endIdx = i; continue; }
      const indent = lines[i].search(/\S/);
      if (indent <= baseIndent) break;
      endIdx = i;
    }
    return lines.slice(startIdx, endIdx + 1);
  }

  // C 系语言（ObjC, Swift, JS/TS, Java, Go, Rust, etc.）：大括号平衡
  // Step 1: 向上找方法/函数起始行
  let startIdx = targetIdx;
  const methodStartRe = getMethodStartRe(lang);
  for (let i = targetIdx; i >= Math.max(0, targetIdx - 60); i--) {
    if (methodStartRe.test(lines[i])) { startIdx = i; break; }
  }

  // Step 2: 向下用大括号计数找结束
  let braceCount = 0;
  let foundBrace = false;
  let endIdx = startIdx;
  for (let i = startIdx; i < Math.min(lines.length, startIdx + maxLines + 20); i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { braceCount++; foundBrace = true; }
      if (ch === '}') braceCount--;
    }
    endIdx = i;
    if (foundBrace && braceCount <= 0) break;
  }

  // 限制最大行数
  const extracted = lines.slice(startIdx, endIdx + 1);
  if (extracted.length > maxLines) {
    return [...extracted.slice(0, maxLines - 1), '    // ... (truncated)'];
  }
  return extracted;
}

/**
 * 获取"方法/函数起始行"识别正则
 */
export function getMethodStartRe(lang) {
  switch (lang) {
    case 'objectivec':
      return /^[-+]\s*\(|^@implementation\b|^@interface\b|^@protocol\b/;
    case 'swift':
      return /^\s*(public |open |internal |private |fileprivate )?(override\s+)?(static |class )?(func\s|init[?(]|deinit\b|subscript\s*[[(]|var\s+\w+.*\{\s*$)/;
    case 'javascript': case 'typescript':
      return /^\s*(export\s+)?(default\s+)?(async\s+)?function\b|^\s*(export\s+)?(default\s+)?class\b|^\s*(public |private |protected |static |async |get |set |readonly )*[\w$]+\s*\(|^\s*(const|let|var)\s+\w+\s*=/;
    case 'python':
      return /^\s*(async\s+)?def\s+|^\s*class\s+/;
    case 'java': case 'kotlin':
      return /^\s*(public |private |protected |static |final |abstract |override |suspend |open )*(fun |void |int |long |String |boolean |class |interface |Object |List |Map )/;
    case 'go':
      return /^\s*func\s/;
    case 'rust':
      return /^\s*(pub\s+)?(fn|impl|struct|enum|trait)\s/;
    default:
      return /^\s*(function|def|class|func|fn|pub fn|pub async fn|sub|proc)\b/;
  }
}
