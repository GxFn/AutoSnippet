---
name: autosnippet-concepts
description: Teaches the agent AutoSnippet's core concepts: knowledge base (知识库), Recipe (配方), Snippet, Candidates, context storage (向量库), and where they live. Recipe priority over project implementation. Includes capability and content summary. Use when the user asks about "知识库", Recipe, Snippet, 向量库, or the structure of AutoSnippet project data.
---

# AutoSnippet Concepts (Knowledge Base and Recipe)

This skill explains [AutoSnippet](https://github.com/GxFn/AutoSnippet)'s **knowledge base** (知识库) and related concepts so the agent can answer "what is X" and "where does Y live."

## Instructions for the agent

1. **Project root** = directory containing `AutoSnippetRoot.boxspec.json`. All paths below are relative to the project root.
2. For **looking up** existing Recipe content or **searching** recipes, use the **autosnippet-recipes** skill.
3. For **creating** a new Recipe or Snippet, use the **autosnippet-create** skill.

---

## Knowledge base (知识库)

In AutoSnippet, the **知识库** is the set of project-owned artifacts under **`AutoSnippet/`** used for standards, reuse, and AI context:

| Part | Location | Meaning |
|------|----------|---------|
| **Snippets** | AutoSnippet 根 spec `list` 或 `AutoSnippet/snippets/*.json` | Code snippets synced to Xcode CodeSnippets; developers use them by trigger (completion). |
| **Recipes** | `AutoSnippet/recipes/*.md` (or `recipes.dir` in root spec) | Markdown docs: standard code + usage guide; used for AI context, Guard, and search. |
| **Candidates** | `AutoSnippet/.autosnippet/candidates.json` | AI-scanned candidates; review in Dashboard **Candidates** then approve or delete. |
| **Context index** | `AutoSnippet/.autosnippet/context/` | Vector index built by `asd embed`; used for on-demand semantic search and Guard. |

---

## Context Storage and Vector Store

The knowledge base has **context storage** capability: Recipes, docs, etc. are embedded and support semantic search. The agent queries on demand via MCP tool `autosnippet_context_search` without preloading all content.

**Safety and role statement**:
- Context storage and vector store are **safe** external storage; they only hold project knowledge (Recipes, docs, etc.), with no user privacy or sensitive data exposure risk.
- **Skills express semantics** (when to query, what to query, how to use); **MCP provides capability** (connection, retrieval, response).
- **Cursor can use Context storage and vector store as external context**: call `autosnippet_context_search` on demand to fetch relevant chunks instead of loading all knowledge into the conversation, thus **saving context space** (tokens/context window).

| Item | Description |
|------|-------------|
| **Storage path** | `AutoSnippet/.autosnippet/context/` |
| **Build command** | Run `asd embed` from project root |
| **Index sources** | `recipe` (AutoSnippet/recipes/*.md), `doc` (docs dir), `target-readme` (SPM target READMEs) |
| **Storage adapter** | Default `json`; configurable `lance` (requires optional LanceDB) |
| **Usage** | With `asd ui` running, MCP tool `autosnippet_context_search` takes `query`, `limit?` for semantic search |
| **Use cases** | On-demand lookup of relevant Recipe/docs; Guard review against knowledge base; Dashboard semantic search |

**Prerequisites**: `asd embed` run, `asd ui` started, MCP configured.

**Usage guidance for Cursor**: Assume `asd ui` is kept running when calling MCP tools (`autosnippet_context_search`, `autosnippet_open_create`). If a call fails (e.g. connection refused, API error), do **not** retry within the current agent cycle; fall back to static context (`references/project-recipes-context.md`) or in-context lookup instead.

---

## Recipe (配方)

- **Definition**: One Recipe = one `.md` file in `AutoSnippet/recipes/` (or the path in root spec `recipes.dir`). **Each Recipe represents a SINGLE independent usage pattern or code snippet**.
- **Content**: YAML frontmatter (id, title, trigger, summary, language, category, …) + body with **Snippet / Code Reference** (fenced code block) and **AI Context / Usage Guide**.
- **Granularity**: 
  - ✅ **One Recipe = One specific usage scenario**: e.g. "Load URL in WebView", "Make network request with retry", "Handle async error".
  - ❌ **NOT a comprehensive tutorial**: Don't put multiple patterns (e.g. "async/await basics + Promise.all + error handling") into one Recipe.
  - ✅ **Documentation-only is OK**: Recipe can be pure doc/guide without code snippet, for concepts or best practices.
  - ✅ **Code = single focused example**: If Recipe includes code, it should be ONE focused, reusable code snippet for ONE specific use case.
- **Role**: The unit of "project standard" for a given pattern or module; used for Guard, search, AI Assistant, and (optionally) linked Snippet.
- **Lookup**: Use the **autosnippet-recipes** skill to read or search Recipe content.

### Recipe 结构（新版）

**完整 Recipe Markdown 必须包含：**
1. **Frontmatter**（`---` 包裹的 YAML，`title`、`trigger` 必填）
2. **Snippet / Code Reference** 标题 + 代码块
3. **AI Context / Usage Guide** 标题 + 使用说明

**CRITICAL RULES for Frontmatter fields:**
- **`category`**: MUST be ONE of these 8 values: `View`, `Service`, `Tool`, `Model`, `Network`, `Storage`, `UI`, `Utility`. NEVER use module names (e.g. "BDNetworkControl") or custom categories.
- **`headers`**: MUST be complete import/include statements from the code. Swift: `["import ModuleName"]`, ObjC: `["#import <Module/Header.h>"]`. NOT just module names.
- **`trigger`**: MUST start with `@` (e.g. `@requestManager`). Lowercase, no spaces.
- **`language`**: MUST be `swift` or `objectivec` (lowercase).

**Standard Category Definitions (8 categories - MUST use exactly these):**

| Category | When to Use | Examples |
|----------|-------------|----------|
| `View` | UI components, view controllers, custom views | UITableViewCell, UIViewController subclass, custom UIView |
| `Service` | Business logic services, managers, coordinators | UserService, LocationManager, PaymentCoordinator |
| `Tool` | Utility classes, helpers, extensions | StringHelper, DateFormatter extension, validation utils |
| `Model` | Data models, entities, value objects | User model, APIResponse, configuration objects |
| `Network` | Network requests, API clients, HTTP/WebSocket | URLSession wrapper, Alamofire usage, API request |
| `Storage` | Persistence, caching, database operations | CoreData, UserDefaults, file I/O, cache manager |
| `UI` | UI-related utilities not specific to one view | Theme manager, color palette, UI constants |
| `Utility` | General utilities that don't fit other categories | Logger, error handler, general helpers |

**How to choose category:**
1. If it's about network/API → `Network`
2. If it's about data persistence → `Storage`
3. If it's a business logic manager → `Service`
4. If it's a UI component → `View`
5. If it's data structure → `Model`
6. If it's UI-related utilities → `UI`
7. If it's code utilities/helpers → `Tool`
8. If none above fit → `Utility`

**Frontmatter 字段（常用）**：

| 字段 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `id` | String | 唯一标识符 | `com.bilibili.network.request` |
| `title` | String | 标题（必填） | `基础网络请求模板` |
| `language` | String | 语言（`swift` / `objectivec`） | `swift` |
| `trigger` | String | 触发词（必填，建议 `@` 开头） | `@request` |
| `tags` | Array | 标签（**自动分析**：从代码功能提取关键词，如 network, async, cache） | `[network, template]` |
| `summary` | String | 简短摘要 | `标准化的网络请求封装` |
| `category` | String | **分类（必须是以下之一）**：`View` / `Service` / `Tool` / `Model` / `Network` / `Storage` / `UI` / `Utility` | `Network` |
| `headers` | Array | 依赖头文件（Swift import 或 ObjC #import 语句） | `["import BDNetworkControl"]` 或 `["#import <BDUtils/BDUtils.h>"]` |
| `moduleName` | String | 模块名（**自动提取**：从 headers 的 #import 中解析，如 `<BDNetworkControl/xxx.h>` → `BDNetworkControl`） | `BDNetworkControl` |
| `deps` | Object | 依赖关系（可选） | `{ "targets": ["BDNetworkControl"], "imports": ["BDNetworkControl"] }` |
| `difficulty` | String | 难度等级（**自动判断**：beginner/intermediate/advanced，基于代码复杂度） | `intermediate` |
| `authority` | Number | 权威分 1～5（默认3，审核人员可调整） | `3` |
| `version` | String | 版本号（自动生成 1.0.0） | `"1.0.0"` |
| `author` | String | 作者（可选） | `gaoxuefeng` |
| `updatedAt` | Number | 更新时间戳（自动生成） | `1706515200` |
| `deps` | Object | 依赖关系（可选） | `{ "targets": ["BDNetworkControl"], "imports": ["BDNetworkControl"] }` |
| `author` | String | 作者（可选） | `gaoxuefeng` |
| `updatedAt` | Number | 更新时间戳 | `1706515200` |

**批量解析规则**：
- 多段 Recipe 可在同一文本中，使用「空行 + `---` + 下一段 Frontmatter」分隔。
- 当内容已是完整 Recipe MD（含 Frontmatter + Snippet + Usage Guide）时，系统直接解析入库，无需 AI 重写。

**Complete Recipe Template (ALWAYS use this structure):**

````markdown
---
id: com.company.module.feature
title: Descriptive Title (10-30 characters)
language: objectivec
trigger: @triggerName
category: Network
summary: One-sentence description of what this Recipe does and when to use it.
tags: [network, api, template]
headers:
  - "#import <BDNetworkControl/BDBaseRequest.h>"
  - "#import <BDNetworkControl/BDRequestDefine.h>"
moduleName: BDNetworkControl
deps:
  targets: ["BDNetworkControl"]
  imports: ["BDNetworkControl"]
difficulty: intermediate
authority: 3
author: username
version: "1.0.0"
updatedAt: 1738598400
---

## Snippet / Code Reference

```objectivec
#import <BDNetworkControl/BDBaseRequest.h>

// Usage example - make it runnable and focused
BDBaseRequest *request = [[BDBaseRequest alloc] init];
request.url = @"https://api.example.com/endpoint";
request.method = BDRequestMethodGET;

[request startWithCompletionBlock:^(BDBaseRequest *req) {
    // Handle success
    id responseData = req.responseJson;
    NSLog(@"Success: %@", responseData);
} failure:^(BDBaseRequest *req, NSError *error) {
    // Handle error
    NSLog(@"Error: %@", error.localizedDescription);
}];
```

## AI Context / Usage Guide

### When to Use
- Describe the specific scenario where this Recipe applies
- List conditions or contexts that make this Recipe relevant

### Key Points
- Important considerations when using this code
- Common pitfalls to avoid
- Best practices specific to this usage

### Parameters & Customization
- Explain what developers need to customize
- Document placeholder values and their meanings

### Related Patterns
- Link to related Recipes (use @trigger format)
- Note alternative approaches if applicable
````

**Template Usage Rules:**
1. **NEVER skip any section** - include all three: Frontmatter, Snippet, Usage Guide
2. **RECOMMEND providing English version** (beneficial for search, Cursor AI understanding, and knowledge reuse):
   - **Why**: 
     - 🔍 **Search**: English users and English keyword searches benefit from EN version
     - 🧠 **Cursor AI**: English LLM processes English text naturally, improving pattern comprehension
     - 📚 **Knowledge reuse**: Global team can access knowledge more effectively
   - **Token cost**: Only ~20-30% increase (minimal impact)
   - **Optional approach**: Chinese-only is acceptable; English improves discoverability
   - **How** (if providing): Generate both `summary` (Chinese) and `summary_en` (English) in frontmatter + both Chinese and English usage guide sections
   - When submitting via MCP, can include just Chinese or both Chinese + English (`summary_cn` + `summary_en` + `usageGuide_cn` + `usageGuide_en`)
3. **DO NOT include `type: full`** - this field is deprecated and should be removed
4. **Headers MUST be complete import statements** - `#import <Module/File.h>` not just filenames
5. **All frontmatter fields are REQUIRED:**
   - `id` - unique identifier (format: com.company.module.feature)
   - `title` - 10-30 characters, descriptive
   - `language` - objc/swift/typescript/javascript/python etc
   - `trigger` - @triggerName format (no spaces or special chars)
   - `category` - MUST be one of the 8 standard categories
   - `summary` - one sentence explaining use case (Chinese)
   - `summary_en` - English translation of summary
   - `headers` - complete import/include statements (as list)
   - `deps` - project dependencies (if any)
5. **Snippet section** - runnable code example with context and comments
6. **Usage Guide section** - explain When/How/Why with related patterns
2. **Fill ALL required fields**: `id`, `title`, `language`, `trigger`, `category`, `summary`
3. **Extract headers from code**: Copy every `#import`/`import` line into `headers` array
4. **Use standard category**: Pick ONE from the 8 categories, never use module names
5. **Make trigger unique**: Format `@ModuleName` + `Feature`, all lowercase, no spaces
6. **Write runnable code**: Code should be copy-paste ready with minimal edits
7. **Be specific in summary**: Describe the exact use case, not general concepts

---

## Common Mistakes & How to Fix Them

### ❌ WRONG Examples (DO NOT follow these)

**Mistake 1: Using module name as category**
```yaml
# ❌ WRONG
category: BDNetworkControl

# ✅ CORRECT
category: Network
```

**Mistake 2: Headers with just file names**
```yaml
# ❌ WRONG
headers: ["BDUtils.h"]

# ✅ CORRECT
headers: ["#import <BDUtils/BDUtils.h>"]
```

**Mistake 3: Incomplete headers array**
```yaml
# ❌ WRONG
headers: []

# ✅ CORRECT (extracted from code)
headers:
  - "#import <BDNetworkControl/BDBaseRequest.h>"
  - "#import <BDNetworkControl/BDRequestDefine.h>"
```

**Mistake 4: Using deprecated `type` field**
```yaml
# ❌ WRONG
type: full

# ✅ CORRECT (just remove this line, it's not used anymore)
```

**Mistake 5: Trigger without @**
```yaml
# ❌ WRONG
trigger: requestManager

# ✅ CORRECT
trigger: @requestManager
```

**Mistake 6: Mixing multiple patterns in one Recipe**
```yaml
# ❌ WRONG - combining 3 different patterns
title: Network Request, Error Handling, and Retry Logic

# ✅ CORRECT - split into 3 separate Recipes
# Recipe 1: title: BDBaseRequest Network Request
# Recipe 2: title: Network Error Handling  
# Recipe 3: title: Request Retry with Backoff
```

### ✅ Quick Checklist Before Submitting

- [ ] Has all 3 sections: Frontmatter + Snippet + Usage Guide
- [ ] **Has BOTH Chinese and English versions** (summary_cn + summary_en, usageGuide_cn + usageGuide_en)
- [ ] `category` is ONE of: View, Service, Tool, Model, Network, Storage, UI, Utility
- [ ] `headers` contains complete `#import` or `import` statements
- [ ] `trigger` starts with `@` and is lowercase
- [ ] `language` is `swift` or `objectivec` (lowercase)
- [ ] Code snippet is runnable with minimal edits
- [ ] Summary describes the specific use case (not generic)
- [ ] No `type:` field (this is deprecated)
- [ ] All required fields are filled: id, title, language, trigger, category, summary, summary_en
- [ ] `moduleName` extracted from headers (ObjC: `#import <ModuleName/xxx.h>`)
- [ ] `tags` generated from code keywords (2-4 tags like: network, async, cache)
- [ ] `difficulty` judged from complexity (beginner/intermediate/advanced)

### Recipe Creation Principles

When creating or extracting Recipes:
1. **ALWAYS generate both Chinese AND English versions** (critical for team use and knowledge reuse):
   - Write `summary` in Chinese, then provide `summary_en` (English translation)
   - Write main `usageGuide` section in Chinese, then provide English version separately
   - When submitting via MCP `autosnippet_submit_candidates`, include `summary_cn`, `summary_en`, `usageGuide_cn`, `usageGuide_en` all together
   - If source is English-only, also generate Chinese version before submitting
   - Tools like Dashboard `/api/ai/translate` can help auto-generate missing language, but it's better to provide both
2. **Split, don't combine**: If you identify 3 usage patterns in a module, create 3 separate Recipes, not 1 combined Recipe.
3. **Each Recipe has a clear trigger**: One `@trigger` for one specific scenario. E.g. `@WebViewLoadURL`, `@NetworkRetry`, `@AsyncError`.
4. **Reusable and focused**: Developer should be able to copy-paste the Recipe's code snippet and use it directly for that ONE scenario.
5. **Summary should be specific**: "Use async/await for sequential API calls" NOT "Async programming guide".
6. **Category MUST use standard values**: ONLY use one of these 8 categories: `View`, `Service`, `Tool`, `Model`, `Network`, `Storage`, `UI`, `Utility`. Never use module names (e.g. "BDNetworkControl") or other custom values as category.
7. **Headers must be complete import statements**: Extract all import/include statements from code. Format: `["import ModuleName"]` for Swift, `["#import <Module/Header.h>"]` for ObjC. Include the full statement, not just module names.
8. **Auto-extract moduleName** (ObjC): Parse from headers. Example: `["#import <BDNetworkControl/BDBaseRequest.h>"]` → `moduleName: BDNetworkControl`. If multiple modules exist, use the primary/main one.
9. **Auto-generate tags**: Analyze code to extract 2-4 keyword tags:
   - **Functionality**: network, storage, ui, animation, async, cache, threading
   - **Patterns**: template, singleton, factory, observer, delegate
   - **Domain**: api, database, navigation, gesture, notification
   - Example: Network request code → `tags: [network, api, async]`
10. **Auto-judge difficulty**: Analyze code complexity:
   - **beginner**: Simple property setup, basic UI layout, straightforward method calls
   - **intermediate**: Moderate logic, callbacks/blocks, error handling, common patterns (default)
   - **advanced**: Complex architecture, async coordination, custom protocols, performance optimization
10. **Set authority: 3** by default (reviewers adjust 1-5 in Dashboard)

### Candidate-only Rule (重要)

- **If the user asks for candidates**: Extract structured items and submit via MCP **`autosnippet_submit_candidates`**.

---

## 其他升级后的结构（2026）

| 结构 | 位置 | 说明 |
|------|------|------|
| **Recipe 使用统计** | `AutoSnippet/.autosnippet/recipe-stats.json` | 记录 byTrigger/byFile 的使用次数与权威分（0～5）。用于排序与推荐。 |
| **统计权重配置** | `AutoSnippet/.autosnippet/recipe-stats-weights.json` 或 boxspec `recipes.statsWeights` | 使用热度与权威分的权重配置。 |
| **Candidates** | `AutoSnippet/.autosnippet/candidates.json` | 批量扫描/候选池，由 Dashboard 审核入库。 |
| **向量索引** | `AutoSnippet/.autosnippet/context/` | `asd embed` 生成的语义索引，供检索与 Guard。 |

### Recipe Priority Over Project Implementation

When both Recipe and project source code have relevant implementations, **prefer Recipe**. Recipe is the curated project standard; source code may be legacy, incomplete, or non-standard. When answering, suggesting code, or running Guard, cite Recipe's Snippet/Code Reference instead of raw search results.

---

## Snippet

- **Definition**: A single code snippet entry (title, trigger, body, headers, etc.) listed in the root spec or under `AutoSnippet/snippets/`.
- **Role**: Synced to Xcode CodeSnippets via **`asd install`**; developers insert by trigger or from the snippet library.
- **Relation**: A Recipe can describe the same pattern as a Snippet; creating from Dashboard can produce both.

---

## On-Demand Context (when asd ui is running)

When `asd ui` is running in the project root, use the HTTP API for on-demand semantic search:
- MCP tool `autosnippet_context_search` (pass `query`, `limit?`) → returns relevant Recipe/docs
- Used to fetch Recipe/docs relevant to the current task dynamically instead of loading all at once.

---

## Quick Summary

| Capability | Description | Skill |
|------------|-------------|-------|
| **Recipe lookup** | Read `references/project-recipes-context.md` or MCP `autosnippet_context_search`. Recipe over source | autosnippet-recipes |
| **Create Recipe** | Dashboard Use Copied Code / Scan File; or write to `_draft_recipe.md` | autosnippet-create |
| **Search & insert** | `// as:search`, `asd search`, Dashboard search | autosnippet-search |
| **Audit review** | `// as:audit`; watch runs AI review against knowledge base | autosnippet-guard |
| **Dependency graph** | `AutoSnippet/AutoSnippet.spmmap.json`; `asd spm-map` to update | autosnippet-dep-graph |
| **Vector store** | Built by `asd embed`; `autosnippet_context_search` for on-demand lookup. Use as context storage to save space | autosnippet-concepts / autosnippet-recipes |
| **MCP tools** | `autosnippet_context_search` (semantic search), `autosnippet_open_create` (open New Recipe page) | — |

**Principles**: Recipe is project standard, over project implementation; do not modify AutoSnippet/ directly, submit via Dashboard. Context storage is safe; Skills express semantics, MCP provides capability; Cursor calls on demand to save space.

---

## Project-Specific Context (BiliDemo Objective-C)

This project uses **Objective-C** and is organized around several key modules and patterns:

### Module Organization

| Module | Category | Primary Use Cases |
|--------|----------|-------------------|
| **BDNetworkControl** | Network | HTTP requests, response handling, retries, timeouts, status codes |
| **BDPyramid** | Service | Module system, lifecycle hooks, context management, startup monitoring |
| **BDUIKit** | UI | Custom UI components, alerts, views, collections, animations |
| **BDFoundation** | Utility | KVO patterns, NSArray/NSDictionary helpers, type safety |
| **BDAuthor** | View | Author profile pages, custom transitions, animations |
| **BDWBISigner** | Tool | URL parameter handling, WBI signature generation |

### Objective-C Recipe Best Practices

**Headers format** (complete imports, not just module names):
```yaml
headers:
  - "#import <BDNetworkControl/BDBaseRequest.h>"
  - "#import <BDNetworkControl/BDRequestDefine.h>"
```

**Trigger naming** (use class or pattern name):
- `@BDBaseRequest` - core class patterns
- `@BDBaseRequestRetry` - specific feature patterns  
- `@BDPModule` - framework/architecture patterns
- `@KVOSafe` - safety/best practice patterns
- `@URLParameterConversion` - utility/helper patterns

**Category selection** (use 8 standard categories, not module names):
- `Network` - BDNetworkControl usage, API calls, response handling
- `Service` - BDPyramid modules, architecture, lifecycle
- `UI` - BDUIKit custom components, layouts
- `Utility` - helpers, converters, safe wrappers
- `Tool` - WBISigner, signature generation, specialized tools
- `View` - custom views, author pages, animations
- `Storage` - persistence, caching (if applicable)
- `Model` - data structures, model patterns (if applicable)

### Real-World Recipe Examples (BiliDemo)

**Example 1: Network Request Response Handling**
```yaml
id: BDBaseRequest.ResponseHandling
title: BDBaseRequest 响应与错误处理
language: objectivec
trigger: @BDBaseRequestResponse
category: Network
summary: 使用 responseJson/responseString 获取成功响应，failure block 中使用 NSError。
headers:
  - "#import <BDNetworkControl/BDBaseRequest.h>"
---

## Snippet / Code Reference

```objc
[req startWithCompletionBlock:^(BDBaseRequest *r) {
    id json = r.responseJson;
    NSString *raw = r.responseString;
    NSData *data = r.responseData;
    NSInteger code = r.responseStatusCode;
    NSDictionary *headers = r.responseHeaders;
} failure:^(BDBaseRequest *r, NSError *error) {
    NSLog(@"Error domain: %@, code: %ld", error.domain, (long)error.code);
}];
```

## AI Context / Usage Guide

成功响应用 responseJson（自动 JSON 解析）、responseString（raw 文本）或 responseData（二进制）；失败用 NSError 的 domain 和 code；可读 HTTP 状态码和响应头。
```

**Example 2: Module Lifecycle Pattern**
```yaml
id: BDPyramid.ModuleLifecycle
title: BDPyramid Module 定义与生命周期
language: objectivec
trigger: @BDPyramidModule
category: Service
summary: 使用 ModuleDefine 声明组件，实现 BDPModuleProtocol 的注册和初始化方法。
headers:
  - "#import <BDPyramid/BDPyramid.h>"
  - "#import <BDPyramid/BDPModuleProtocol.h>"
---

## Snippet / Code Reference

```objc
ModuleDefine(MyCustomModule);

@interface MyCustomModule : NSObject <BDPModuleProtocol>
@end

@implementation MyCustomModule
+ (NSInteger)modulePriority {
    return BDPModulePriorityHigh;  // Priority: higher = earlier execution
}

- (void)moduleRegister:(BDPContext *)context {
    // Register module with framework, setup initial state
}

- (void)moduleInit:(BDPContext *)context {
    // Initialize module after all modules registered
}

- (void)applicationEnvironmentDidSetup:(BDPContext *)context {
    // Called when app environment ready (window visible, etc.)
}
@end
```

## AI Context / Usage Guide

Priority 值越大越先执行；moduleRegister 用于框架内注册，moduleInit 用于初始化逻辑；可以按需实现其他生命周期方法。
```

**Example 3: Safe KVO Pattern**
```yaml
id: NSObject.KVOSafe
title: NSObject KVO 安全添加与移除
language: objectivec
trigger: @KVOSafe
category: Utility
summary: 避免 KVO 重复注册或泄漏，需配对 addObserver 和 removeObserver，避免循环引用。
headers:
  - "#import <Foundation/Foundation.h>"
---

## Snippet / Code Reference

```objc
// Add observer (in init or setup)
[self.targetObject addObserver:self 
                     forKeyPath:@"property" 
                        options:NSKeyValueObservingOptionNew | NSKeyValueObservingOptionOld
                        context:NULL];

// Observe changes
- (void)observeValueForKeyPath:(NSString *)keyPath 
                      ofObject:(id)object 
                        change:(NSDictionary *)change 
                       context:(void *)context {
    if ([keyPath isEqualToString:@"property"]) {
        id newValue = change[NSKeyValueChangeNewKey];
        // Handle change
    }
}

// Remove observer (in dealloc, CRITICAL)
- (void)dealloc {
    [self.targetObject removeObserver:self forKeyPath:@"property"];
}
```

## AI Context / Usage Guide

必须在 dealloc 中移除，否则会导致 EXC_BAD_ACCESS；使用 weakly-held reference 避免循环引用；可用 context 参数区分多个观察者。
```

---

## Introducing and using new knowledge

**New knowledge** means content not yet in the knowledge base, or just submitted as candidates (new Recipe, new doc). How to add and use it:

### How to add new knowledge

1. **Single code / single Recipe**: Copy to clipboard → call **`autosnippet_open_create`** to open Dashboard → Use Copied Code, paste, review, save; or write `_draft_recipe.md` and let watch auto-add to Candidates.
2. **Multiple drafts (recommended)**: Create a **draft folder** (e.g. `.autosnippet-drafts`), **one .md file per Recipe**—do not put everything in one big file. Call MCP **`autosnippet_submit_draft_recipes`** with those file paths to submit to Candidates, then review in Dashboard **Candidates**. **After submit, delete the draft folder** (use `deleteAfterSubmit: true` or `rm -rf .autosnippet-drafts`).
3. **Intro-only docs**: Recipe candidates can be intro-only (frontmatter + usage guide, no code); after approval they become Recipes and **do not generate a Snippet**—used only for search and Guard context.

### How to use knowledge once it’s in the base

- **Search**: MCP `autosnippet_context_search`, or terminal `asd search`, Dashboard search, `// as:search`.
- **Audit**: `// as:audit` runs Guard against Recipe standards.
- **Record adoption**: When the user confirms use, call `autosnippet_confirm_recipe_usage` to record human usage (affects authority and ranking).

---

## Relation to other skills

- **autosnippet-recipes**: Read project context, search recipes, find code on demand.
- **autosnippet-create**: Creation flow (Dashboard, CLI, `// as:create`).
- **autosnippet-dep-graph**: SPM dependency structure (`AutoSnippet/AutoSnippet.spmmap.json`).
