# Guard 误报与排除策略

本文档汇总 iOS Guard 规则中已知的误报场景及当前排除策略，便于举一反三、后续扩展与人工判断。

---

## 前置条件

使用 Guard 或理解本文档前，建议满足以下条件：

| 条件 | 说明 |
|------|------|
| **项目根** | 当前目录或其上级含有 `AutoSnippetRoot.boxspec.json`，即被识别为 AutoSnippet 项目根。 |
| **watch / ui 运行中** | 需先执行 `asd watch` 或 `asd ui`；编辑器内写入 `// as:guard` 并保存后，由 watch 触发检查并写入违反记录。 |
| **规则与记录路径** | 规则文件：`Knowledge/.autosnippet/guard-rules.json`；违反记录：同目录下 `guard-violations.json`。若项目尚无 `Knowledge`，首次读写时会自动创建 `Knowledge/.autosnippet`。 |
| **Dashboard Guard 页** | 在浏览器中查看规则表与违反记录前，需通过 `asd ui` 打开 Dashboard，Guard 页数据来自上述 JSON 文件。 |

---

## 1. Block 循环引用（objc-block-retain-cycle）

**规则含义**：block 内直接使用 `self` 且未 weakify 时，若 block 被对象强引用则可能形成循环引用。

**已排除（不报）的场景**：

| 场景 | 原因 |
|------|------|
| GCD：`dispatch_async` / `dispatch_sync` / `dispatch_after` / `dispatch_once` / `dispatch_group_async` / `dispatch_barrier_async` 的 block 参数 | GCD 仅临时持有 block，执行完即释放，不形成环 |
| GCD 封装宏：如 `BBA_GCD_SYNC_MAIN(^{ ... })` 等 `*GCD*SYNC*` / `*GCD*ASYNC*` 形式 | 同上 |
| UIView 动画：`animations:` / `completion:` 后的 block | 系统仅临时持有，执行完即释放 |
| 枚举：`enumerateObjectsUsingBlock:` / `enumerateKeysAndObjectsUsingBlock:` / `enumerateIndexesUsingBlock:` | 一次性同步执行，不长期持有 block |
| 无动画：`performWithoutAnimation:` 的 block | 同上 |
| NSOperationQueue：`addOperationWithBlock:` | 与 GCD 类似，执行完即释放 |

**仍可能误报**：

- Block 作为**属性**或**成员变量**被 self 强引用，但当前逻辑只按「block 作为参数」的上下文排除；若代码风格是「先赋给局部变量再传入」可能仍会报。
- 第三方 API 的 block 若语义为「一次性回调」（如某网络库的 `completion:`），未在排除列表中的会照常报；可后续按需加入排除列表。

**不排除（故意报）**：

- `completionHandler:` / `success:` / `failure:` 等网络/异步回调：很多 API 会长期持有 block 直到请求结束，block 里用 self 确有循环引用风险，故不泛化排除。

---

## 2. KVO / NSNotificationCenter 未配对 remove（objc-kvo-missing-remove）

**规则含义**：文件内出现 `addObserver` 但未发现配对 `removeObserver` 时提示。

**已排除**：

- 任意包含 `removeObserver` 的方法名均视为「有移除」，如 `bd_removeObserver`、`removeObserver:forKeyPath:` 等，避免封装方法被误报。

**仍可能误报**：

- **跨文件**：add 在 A 文件，remove 在 B 文件（如集中管理类在 dealloc 里统一移除），当前仅文件级扫描，会报 A 文件。
- **自定义移除命名**：若项目用 `unobserve`、`stopObserving` 等非 `removeObserver` 命名，可考虑在规则中扩展识别（或保持现状，由人工忽略）。

---

## 3. copy 修饰自定义类型（objc-copy-custom-type）

**规则含义**：`@property (copy)` 修饰非系统、非 id 类型时，须确保该类型实现 NSCopying，否则 setter 可能崩溃。

**已排除**：

- 类型为 `id` 或 `NS*` 前缀（系统类型默认已实现或另有规则）。
- 已知实现 NSCopying 的第三方类型：如 `MASConstraint`（Masonry）。
- 属性类型为 **block 类型**（如 `BDPContext *(^context)(void)`）：copy 的是 block，不需 NSCopying。
- 位于 `#if TARGET_OS_MAC` 等 macOS 专属编译块内的属性（避免与 iOS 混用时的误报）。

**仍可能误报**：

- 项目内自定义类型已实现 `copyWithZone:` 但未加入「已知类型」白名单，会继续报；可把该类型加入 `copyKnownTypes` 白名单。
- **typedef**：如 `typedef NSString * MyString;` 且 `@property (copy) MyString name;`，当前按类型名 `MyString` 匹配，可能被当成自定义类型报出；需人工确认或后续支持 typedef 解析。

---

## 4. init 中 return nil 前应有 super init（objc-init-return-nil）

**规则含义**：在 init 方法内若存在 `return nil`，其前应有 `[super init]` 或委托初始化，否则可能未正确初始化。

**已排除**：

- 方法体内已出现 `[super init]` 或 `self = [super init]`。
- **委托初始化**：已出现 `[self initWith...]` 或 `self = [self initWith...]`（如 `self = [self initWithFrame:frame]`），视为由 designated initializer 负责 super init，不报。

**仍可能误报**：

- 极少数「工厂类方法」里先 `return nil` 再在其他分支调用 init，若方法名也被匹配为 init 且中间无 `[super init]`/`[self initWith...]`，可能误报；依赖人工确认。

---

## 5. UIKit 应在主线程（ui-off-main-swift）

**规则含义**：Swift 中 UIKit/UI 相关调用应在主线程执行。

**已修复误报**：

- **DispatchQueue.main.async**：此前被错误地包含在「违规」模式中；使用 `DispatchQueue.main.async` 正是正确的切主线程方式，已从违规模式中移除，不再误报。

---

## 6. 其他规则的已知局限

- **objc-possible-main-thread-blocking**（sleep/usleep）：仅按行匹配，无法区分是否在后台线程；若确定在 `dispatch_async(backgroundQueue, ^{ ... })` 或子线程内，可人工忽略。
- **objc-dealloc-async**、**objc-nested-dispatch-sync** 等：按**同一行**匹配，若 `dealloc` 与 `dispatch_async` 分两行写则不会报；注释或字符串中同时出现两关键词时可能误报。
- **objc-duplicate-category**：同项目多 target（如 iOS / macOS）故意对同一类写不同平台的 Category 时，可能被报「重名」；可人工忽略或按 target 维度审查。
- **objc-timer-retain-cycle**：只检查 `target:self`，不检查是否在 dealloc 里 invalidate；若已保证 invalidate 仍会提示，属预期（提醒确认）。

---

## 7. 扩展建议

- **Block 排除**：若项目内常用「一次性 block」API（如某封装 `runOnMain:block:` 仅执行即释放），可在 `guardRules-iOS.js` 的 block 排除逻辑中增加对应 selector 或前缀模式。
- **KVO 移除**：若统一使用 `xxx_removeObserver` 命名，当前 `/removeObserver/` 已覆盖；若有其他命名，可在同一处扩展正则或方法名列表。
- **copy 白名单**：新确认实现 NSCopying 的第三方/项目类型，可加入 `copyKnownTypes` 减少误报。

---

文档与规则实现以 `AutoSnippet/lib/guard/guardRules-iOS.js` 为准；本文档仅作说明与维护参考。
