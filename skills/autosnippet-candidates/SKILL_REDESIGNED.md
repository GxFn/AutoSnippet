---
name: autosnippet-candidates
description: 生成 Recipe 候选：单文件扫描或批量 Target 扫描。理解候选质量评分、相似度标记、元数据意义。Merge of old autosnippet-recipe-candidates + autosnippet-batch-scan.
---

# AutoSnippet — Generate Candidates with Rich Information
> Self-check & Fallback: 所有 MCP 工具返回统一 JSON Envelope（{ success, errorCode?, message?, data?, meta }）。重操作前调用 autosnippet_health/autosnippet_capabilities；失败时不在同一轮重试，转用静态上下文或缩小范围后再试。

## Quick Start

**Scenario 1: User says "扫描 BDNetworkControl 生成候选"**
1. 读取该模块的源文件 + README
2. 分析公开 API、使用示例、文档注释
3. 提取多个候选（每个独立模式一个）
4. **并行查询现有 Recipe** → 标记相似度、冲突
5. 评分并排序 → 提交到 Candidates 池
6. 用户在 Dashboard Candidates 审核

**Scenario 2: User says "产生候选"（无目标）**
1. 列表让用户选择 Target 或文件
2. 同上 Scenario 1 流程

---

## What is a Candidate?

**Candidate ≠ 单纯的代码块**

候选是「多维信息包」：

```json
{
  // 🎯 核心内容（必有）
  "title": "Request with Retry",
  "summary_cn": "带重试的网络请求",
  "summary_en": "HTTP request with automatic retry",
  "code": "func requestWithRetry(...) { ... }",
  "usageGuide_cn": "何时使用、依赖、约束、扩展示例",

  // 📊 元数据与评分（NEW - 高价值）
  "quality": {
  "codeQuality": 0.85,
  "documentationQuality": 0.90,
  "projectAdaptability": 0.80,
  "overallScore": 0.85
  },

  "metadata": {
  "sourceFile": "Sources/Network/RequestManager.swift",
  "confidence": 0.92,
  "coverageScore": 0.80
  },

  // 🔗 关系标记（NEW - 减少重复）
  "relatedRecipes": [
  {
    "id": "recipe_network_001",
    "title": "Basic Network Request",
    "similarity": 0.75,
    "relationship": "extends"
  }
  ],

  "reviewNotes": {
  "priority": "high",
  "suggestions": [
    "Consider merging with recipe_network_001 (75% similarity)"
  ]
  }
}
```

**为什么这样设计？**
- ✅ 评分 → 用户可快速按优先级审核
- ✅ 相似度检测 → 自动避免重复、提示可合并
- ✅ metadata → 增强可信度与透明度
- ✅ 关系图 → 帮助理解 Recipe 生态

---

## Information Extraction: Three Layers

### Layer 1: Primary Information（必须）

**提取内容**：
- Public API 签名和文档注释
- 使用示例（来自 README、test、demo）
- 基本功能说明

**输出字段**：
```
title, summary_cn, summary_en, trigger, code, usageGuide_cn, usageGuide_en
```

**AI 指导**：
```
从这个文件提取公开 API 和使用示例。
为每个主要类/函数生成一个候选。
代码必须是"使用者角度"的示例，不是内部实现。
推荐使用 Xcode 占位符（如 <#URL#> / <#Token#> / <#Config#>），并在 Usage Guide 解释含义。
```

### Usage Guide Template（建议结构）
确保不只包含“何时用/关键点”，建议覆盖：
- 何时用（适用场景）
- 何时不用/替代方案
- 依赖与前置条件（模块、权限、最低版本）
- 核心步骤与关键配置（参数、默认值、边界条件）
- 错误处理与异常分支（重试、超时、降级）
- 性能与资源考量（缓存、线程、内存）
- 安全与合规提示（敏感数据、鉴权、日志）
- 常见误用与踩坑
- 相关 Recipe/扩展读物

---

### Layer 2: Contextual Information（强烈推荐）

**提取内容**：
- Import 语句和依赖
- 代码复杂度（时间、空间）
- 错误处理模式
- 安全注意事项
- 兼容性信息

**输出字段**：
```
headers, keywords, semanticTags, 
technicalProfile (performance, security, compatibility)
```

**AI 指导**：
```
分析代码的性能特征：
- 是否有循环？→ O(n) 或 O(n²)？
- 是否涉及网络/IO？ → 异步特性
- 安全考虑：是否处理敏感数据？
- 兼容性：最低支持什么 iOS 版本？
- 依赖什么外部库？
```

---

### Layer 3: Relationship Information（高价值）

**提取内容**：
- 与其他模块的交互
- 常见变体或衍生模式
- 已知替代方案

**输出字段**：
```
relatedRecipes, reviewNotes (priority, suggestions, warnings)
```

**流程**（与 AI 无关，系统自动）：
```
1. 为候选生成 embedding 特征
2. 调用 autosnippet_context_search(title + keywords) → 获取相似 Recipe
3. 计算相似度（title, keywords, 代码结构相似性）
4. 标记关系：extends / conflicts / alternative / complement
5. 若相似度 > 0.75 → 标记"建议合并"
6. 生成 priority (high/medium/low)
```

---

## Scanning: Single File vs Batch

### Mode A: Single File / Module Scan

**When**: 用户想从特定文件或模块生成候选

**Flow**:
```
用户: "扫描 Sources/Network/RequestManager.swift"
  ↓
1. 读取文件（或通过文件路径推断模块）
2. 解析结构 → 找出所有 public 类、函数、常量
3. 提取每个 public 元素的三层信息（Layer 1/2/3）
4. **并行步骤**：
   - a) 为每个候选评分（质量、覆盖度、适配度）
   - b) 调用 autosnippet_context_search() → 查询相似 Recipe
5. 聚合结果 → 生成候选列表（带评分、相似度、建议）
6. **候选预校验**（可选但推荐）：调用 `autosnippet_validate_candidate`
7. **去重检测**（可选但推荐）：调用 `autosnippet_check_duplicate`
8. 提交到 Dashboard Candidates（`autosnippet_submit_candidates`，读取 Envelope：成功用 `data.count/targetName`，失败检查 `errorCode` 如 `RATE_LIMIT`/`SUBMIT_FAILED` 并提示稍后再试或修正字段）
9. 用户审核并批准
```

**实现细节**:
```javascript
async scanSingleFile(filePath) {
  // Step 1: 读取文件
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Step 2: 解析代码结构
  const structure = await this.parseCodeStructure(content);
  // → { classes: [...], functions: [...], constants: [...] }
  
  // Step 3: 提取三层信息
  const layers = await Promise.all(
  structure.classes.concat(structure.functions).map(item =>
    this.extractThreeLayers(item, content)
  )
  );
  
  // Step 4: 并行评分 + 上下文查询
  const enriched = await Promise.all(
  layers.map(candidate => Promise.all([
    this.scoreCandidate(candidate),       // 评分
    this.enrichWithContext(candidate)     // 查询相似 Recipe
  ]).then(([scored, contexted]) => ({ ...scored, ...contexted }))
  );
  
  // Step 5: 聚合 & 排序
  const aggregated = await this.aggregateCandidates(enriched);
  
  // Step 6: 提交
  await this.submitCandidates(aggregated, { targetName: 'SingleFile' });
}

async extractThreeLayers(item, content) {
  const layer1 = {
  title: item.name || item.signature,
  summary_cn: this.extractDocstring(item, 'cn'),
  summary_en: this.extractDocstring(item, 'en'),
  code: this.extractUsageExample(item, content),
  usageGuide_cn: this.buildUsageGuide(item, content, 'cn'),
  };
  
  const layer2 = {
  headers: this.extractImports(content),
  keywords: this.extractKeywords(item.name, content),
  technicalProfile: {
    performance: this.analyzePerformance(item),
    security: this.analyzeSecurityConcerns(item),
    compatibility: this.inferCompatibility(content),
  }
  };
  
  // Layer 3 由系统自动生成
  
  return { ...layer1, ...layer2 };
}

async scoreCandidate(candidate) {
  const codeQuality = this.computeCodeQuality(candidate.code);
  const docQuality = this.computeDocumentationQuality(candidate.usageGuide_cn);
  const projectFit = this.computeProjectAdaptability(candidate);
  
  return {
  ...candidate,
  quality: {
    codeQuality,
    documentationQuality: docQuality,
    projectAdaptability: projectFit,
    overallScore: (codeQuality + docQuality + projectFit) / 3
  }
  };
}

async enrichWithContext(candidate) {
  // 调用 context_search
  const query = `${candidate.title} ${candidate.keywords.join(' ')}`;
  const similarRecipes = await this.contextSearch(query, { limit: 5 });
  
  // 计算相似度并标记关系
  const relatedRecipes = similarRecipes
  .map(recipe => ({
    id: recipe.id,
    title: recipe.title,
    similarity: this.computeSimilarity(candidate, recipe),
    relationship: this.inferRelationship(candidate, recipe)
  }))
  .filter(r => r.similarity > 0.5);
  
  // 生成审核建议
  const reviewNotes = {
  priority: this.inferPriority(candidate, relatedRecipes),
  suggestions: [],
  warnings: []
  };
  
  if (relatedRecipes.length > 0) {
  const highest = relatedRecipes[0];
  if (highest.similarity > 0.75) {
    reviewNotes.suggestions.push(
    `Consider merging with "${highest.title}" (${Math.round(highest.similarity * 100)}% match)`
    );
    reviewNotes.priority = 'low';  // 相似度高的候选优先级降低
  }
  }
  
  return { ...candidate, relatedRecipes, reviewNotes };
}
```

---

### Mode B: Batch Target Scan

**When**: 用户想从整个 SPM Target 批量生成候选

**Flow**:
```
用户: "批量扫描 Target X"
  ↓
1. 调用 autosnippet_get_targets() → 获取 Target 列表
2. 用户选择 Target 或指定
3. 调用 autosnippet_get_target_files(targetName) → 获取文件列表
   （优先级排序：README > .h > 实现）
4. **并行**扫描所有文件
   - 对每个文件执行 "Single File Scan"
   - 提取候选
5. **去重与聚合**：
   - 相似度 > 0.9 → 合并为一个候选
   - 相似度 0.6-0.9 → 标记为"相关"，保留但优先级分层
6. **全局去重**（与现有 Recipe 对比）：
  - 调用 autosnippet_context_search() → 查询整个知识库
  - 标记与现有 Recipe 的冲突 / 变体关系
7. **候选预校验**（可选但推荐）：`autosnippet_validate_candidate`
8. **去重检测**（可选但推荐）：`autosnippet_check_duplicate`
9. 聚合 + 排序 → 生成候选列表
10. 提交到 Dashboard Candidates（Envelope 成功/失败分支处理）
11. 用户批量审核

流程图：
┌─────────────────────┐
│ 获取 Target 文件列表 │
│ (README > .h > src)  │
└──────────┬──────────┘
       ↓
    ┌────────────┐
    │ 并行扫描   │
    │ 所有文件   │
    └────────────┘
       ↓
   ┌───────────────────┐
   │ 文件级去重 (0.9)   │ ← 超高相似度合并
   └─────────┬─────────┘
       ↓
   ┌───────────────────┐
   │ 全局去重 (现有库)  │ ← 与 Recipe 库对比
   └─────────┬─────────┘
       ↓
   ┌───────────────────┐
   │ 聚类 (0.6-0.9)    │ ← 中等相似度标记关联
   └─────────┬─────────┘
       ↓
   ┌───────────────────┐
   │ 评分 & 排序       │ ← 按综合评分 + 优先级
   └─────────┬─────────┘
       ↓
   ┌───────────────────┐
   │ 提交到 Candidates │
   └───────────────────┘
```

**实现细节**:
```javascript
async batchScanTarget(targetName) {
  // Step 1: 获取文件
  const files = await this.getTargetFiles(targetName);
  // → sorted by importance: README, headers, implementations
  
  // Step 2: 并行扫描
  const allCandidates = (await Promise.all(
  files.map(f => this.scanSingleFile(f))
  )).flat();
  
  // Step 3: 文件级去重（相似度 > 0.9）
  const deduplicated = await this.deduplicateByEmbedding(allCandidates, 0.9);
  
  // Step 4: 全局去重（与现有 Recipe 对比）
  const contextuallyEnhanced = await Promise.all(
  deduplicated.map(c => this.enrichWithGlobalContext(c))
  );
  
  // Step 5: 聚类（相似度 0.6-0.9）
  const clustered = await this.clusterByEmbedding(contextuallyEnhanced, 0.6);
  
  // Step 6: 排序
  const sorted = clustered.sort((a, b) => 
  (b.quality?.overallScore || 0) - (a.quality?.overallScore || 0)
  );
  
  // Step 7: 提交
  await this.submitCandidates(sorted, { targetName });
}

async enrichWithGlobalContext(candidate) {
  // 与 enrichWithContext() 类似，但查询整个知识库
  const query = `${candidate.title} ${candidate.keywords?.join(' ') || ''}`;
  const similarRecipes = await this.contextSearch(query, { limit: 10 });
  
  // 标记冲突与关系
  const relatedRecipes = similarRecipes.map(recipe => ({
  id: recipe.id,
  title: recipe.title,
  similarity: this.computeSimilarity(candidate, recipe),
  relationship: this.inferRelationship(candidate, recipe),
  action: this.suggestAction(candidate, recipe)
    // 'merge' / 'skip' / 'variant' / 'complement'
  }));
  
  return { ...candidate, relatedRecipes };
}

async deduplicateByEmbedding(candidates, threshold = 0.9) {
  const embeddings = await Promise.all(
  candidates.map(c => this.embed(`${c.title} ${c.code}`))
  );
  
  const kept = [];
  const groups = [];
  
  for (let i = 0; i < candidates.length; i++) {
  let found = false;
  for (const group of groups) {
    const similarity = this.cosineSimilarity(embeddings[i], embeddings[group[0]]);
    if (similarity > threshold) {
    group.push(i);
    found = true;
    break;
    }
  }
  if (!found) {
    groups.push([i]);
  }
  }
  
  // 每组保留最高质量的
  for (const group of groups) {
  const best = group
    .map(i => ({ idx: i, score: candidates[i].quality?.overallScore || 0 }))
    .sort((a, b) => b.score - a.score)[0];
  kept.push(candidates[best.idx]);
  }
  
  return kept;
}
```

---

## AI Extraction Optimization

### Target-Type-Aware Prompts

不同类型的 Target 应该用不同的 prompt：

```javascript
/**
 * 根据 Target 类型选择专用 prompt
 */
async extractRecipesWithOptimizedPrompt(targetName, filesContent) {
  const targetType = this.detectTargetType(targetName, filesContent);
  
  const prompts = {
  'ui': this.getUIFrameworkPrompt,
  'network': this.getNetworkLibraryPrompt,
  'storage': this.getStorageLibraryPrompt,
  'service': this.getServiceLibraryPrompt,
  'utility': this.getUtilityLibraryPrompt,
  'default': this.getGenericPrompt
  };
  
  const promptFn = prompts[targetType] || prompts.default;
  const prompt = promptFn(targetName, filesContent);
  
  return await this.chat(prompt);
}

getNetworkLibraryPrompt(targetName, filesContent) {
  return `
# Network Library Extraction: ${targetName}

You are a network architecture expert. Extract reusable network patterns.

## Focus Areas
1. **Request Construction**: How to build HTTP/WebSocket requests
2. **Response Handling**: How to parse and handle responses
3. **Error Handling**: Retry logic, timeout, error categorization
4. **Authentication**: Token injection, certificate pinning, etc.
5. **Performance**: Caching strategy, connection pooling, timeout values

## For each request type/endpoint:

### Layer 1: Primary (MUST)
- Request method + endpoint pattern
- Headers (if special)
- Body structure (if any)
- Expected response format
- Common use case

### Layer 2: Technical (RECOMMENDED)
- Typical execution time
- Timeout recommendation
- Caching policy
- Auth requirements
- SSL/TLS requirements

### Layer 3: Variations (HIGH VALUE)
- Retry strategy (exponential backoff? circuit breaker?)
- Alternative endpoints / failover
- Rate limiting handling
- Known timeout / error scenarios

Output: JSON array of recipes, each with complete Layer 1 + Layer 2 + Layer 3.
  `;
}

getUIFrameworkPrompt(targetName, filesContent) {
  return `
# UI Framework Extraction: ${targetName}

You are a UI architecture expert. Extract reusable view patterns.

## Focus Areas
1. **View Initialization**: Setup, configuration, styling
2. **Lifecycle**: viewDidLoad, viewWillAppear, cleanup
3. **Interaction**: Gesture handling, delegation, custom actions
4. **Composition**: How to combine multiple views
5. **Theming**: Color/font/layout customization

## For each view component:

### Layer 1: Primary (MUST)
- How to create and initialize the view
- Key properties and their default values
- Basic usage example (in a view controller)

### Layer 2: Technical (RECOMMENDED)
- Performance hints (frame vs bounds, drawing)
- Accessibility requirements
- Rotation / size class handling
- Memory management (strong/weak references)

### Layer 3: Variations (HIGH VALUE)
- Common subclassing patterns
- Theme/styling variants
- Integration with other views
- Delegation patterns

Output: JSON array of recipes.
  `;
}

// Similar for storage, service, utility...
```

---

## Quality Scoring Algorithm

**Four dimensions**:

```javascript
function scoreCandidate(candidate) {
  // 1. Code Quality (0-1)
  let codeQuality = 0.5;
  const codeLines = candidate.code?.split('\n').length || 0;
  
  if (codeLines > 20 && codeLines < 200) codeQuality += 0.2;
  if (candidate.code?.includes('try') || candidate.code?.includes('catch')) codeQuality += 0.15;
  if (candidate.code?.includes('error') || candidate.code?.includes('Error')) codeQuality += 0.1;
  if (!candidate.code?.includes('TODO') && !candidate.code?.includes('FIXME')) codeQuality += 0.05;
  
  // 2. Documentation Quality (0-1)
  let docQuality = 0;
  if (candidate.usageGuide_cn?.length > 100) docQuality += 0.3;
  if (candidate.usageGuide_cn?.includes('何时使用')) docQuality += 0.2;
  if (candidate.usageGuide_cn?.includes('依赖')) docQuality += 0.2;
  if (candidate.usageGuide_cn?.includes('示例')) docQuality += 0.2;
  if (candidate.usageGuide_cn?.includes('注意') || candidate.usageGuide_cn?.includes('警告')) docQuality += 0.1;
  
  // 3. Project Adaptability (0-1)
  let projectFit = 0.2;
  if (candidate.headers?.length > 0) projectFit += 0.2;  // 有明确依赖
  if (candidate.keywords?.some(kw => PROJECT_KEYWORDS.includes(kw))) projectFit += 0.3;  // 匹配项目关键词
  if (!candidate.isExternalLibraryOnly) projectFit += 0.3;  // 不只是外部库
  
  // 4. Extraction Confidence (0-1)，由候选本身携带
  const confidence = candidate.metadata?.confidence || 0.8;
  
  // Overall Score
  const overall = (codeQuality + docQuality + projectFit) / 3;
  
  return {
  ...candidate,
  quality: {
    codeQuality: Math.min(codeQuality, 1.0),
    documentationQuality: Math.min(docQuality, 1.0),
    projectAdaptability: Math.min(projectFit, 1.0),
    overallScore: Math.min(overall, 1.0),
    confidence
  }
  };
}
```

---

## Priority Inference

```javascript
function inferPriority(candidate, relatedRecipes) {
  // 高优先级: 新颖 + 高质量
  if (relatedRecipes.length === 0 && candidate.quality?.overallScore > 0.8) {
  return 'high';
  }
  
  // 中优先级: 有相关但不完全重复
  if (relatedRecipes.some(r => r.similarity > 0.6 && r.similarity < 0.8)) {
  return 'medium';
  }
  
  // 低优先级: 相似度很高（可能重复）
  if (relatedRecipes.some(r => r.similarity > 0.8)) {
  return 'low';
  }
  
  // 中等质量 + 少量关联
  return 'medium';
}
```

---

## Dashboard Experience

在 Candidates 页面，候选按优先级和评分展示：

```
┌─ HIGH PRIORITY ──────────────────────────────┐
│ ✓ Request with Retry                          │
│   Code Quality: ████░ 85%                     │
│   Doc Quality:  █████ 90%                     │
│   Project Fit:  ███░░ 80%                     │
│   Overall:      ████░ 85%                     │
│   Status: Ready for review                    │
│   Action: [Approve] [Edit] [Reject]           │
└───────────────────────────────────────────────┘

┌─ MEDIUM PRIORITY ────────────────────────────┐
│ ⚠ Async Task Manager                          │
│   Overall: ███░░ 78%                          │
│   Similar to: recipe_service_001 (75% match)  │
│   Suggestion: Consider merging or variant     │
│   Action: [Approve] [Merge] [Reject]          │
└───────────────────────────────────────────────┘

┌─ LOW PRIORITY ───────────────────────────────┐
│ ⊘ Network Logger                              │
│   Overall: ██░░░ 65%                          │
│   Duplicate of: recipe_network_002 (92%)      │
│   Suggestion: Skip or use as variant          │
│   Action: [Skip] [Approve as Variant] [Reject]│
└───────────────────────────────────────────────┘
```

---

## Workflow Summary

### Single File → Candidates (5 min)
```bash
# Agent 执行
1. 读取文件 → 解析代码结构
2. 为每个 public 元素提取三层信息
3. 评分 + 查询相似 Recipe
4. 提交到 Candidates

用户执行
5. Dashboard Candidates 页审核
6. 批准 → 进入知识库
```

### Batch Target → Candidates (15-30 min)
```bash
# Agent 执行
1. 获取 Target 文件列表
2. 并行扫描 → 提取候选
3. 去重 + 聚合 + 评分
4. 提交到 Candidates

用户执行
5. Dashboard Candidates 页批量审核
6. 按优先级审批
```

---

## Key Principles

1. **Information-Rich**: 候选不只有代码，还有元数据、评分、关系
2. **Context-Aware**: 生成时自动查询现有 Recipe，检测重复、冲突、关联
3. **Quality-Scored**: 多维评分，帮助优先级排序和过滤
4. **User-Friendly**: Dashboard 展示清晰的建议和优先级，减少审核负担
5. **Automation-First**: 自动去重、相似度检测、优先级推断，尽量减少人工

---

## MCP Tools Used

```
✓ autosnippet_get_targets()
  → 获取项目中所有 SPM Target

✓ autosnippet_get_target_files(targetName)
  → 获取 Target 的源文件（按优先级排序）

✓ autosnippet_context_search(query, limit?)
  → 查询现有 Recipe，检测相似度

✓ autosnippet_submit_candidates(candidates, metadata)
  → 提交候选到审核池

✓ autosnippet_submit_draft_recipes(filePaths, targetName, options)
  → 提交 draft .md 文件作为候选

### Draft Flow (Optional)

当用户偏好「草稿 → 候选」路径时：
1. 在项目根创建草稿目录（例如 `.autosnippet-drafts/`）
2. 每个候选一个 `.md` 文件（完整 Recipe 或 intro-only）
3. 使用 `autosnippet_submit_draft_recipes` 提交并可选择 `deleteAfterSubmit: true`
4. 审核仍在 Dashboard Candidates 页面完成

### Deprecated Skills Mapping (v2.0)

- `autosnippet-batch-scan` → **autosnippet-candidates**
- `autosnippet-recipe-candidates` → **autosnippet-candidates**（草稿路径作为可选方式）
- `autosnippet-dep-graph` → **autosnippet-structure**

### Submission & Envelope Reading

工具：`autosnippet_submit_candidates`

输入：
- `targetName`: 候选归属（如模块名或 `_cursor`）
- `items`: 候选数组（每条至少包含 `title, summary, trigger, language, code, usageGuide`；推荐同时包含 `summary_en, usageGuide_en`）
- `clientId?`: 限流用客户端标识（如用户ID或进程名）

输出（Envelope）：
- 成功：`{ success: true, data: { count, targetName }, message }`
- 失败：`{ success: false, errorCode, message }`

常见错误码：
- `BAD_INPUT`: 缺少 `targetName` 或 `items` 格式不符
- `RATE_LIMIT`: 提交太频繁，遵循 `retryAfter` 提示的秒数后再试
- `SUBMIT_FAILED`: UI 未运行或数据结构不满足要求（补齐必填字段）

示例（成功）：
```json
{
  "success": true,
  "data": { "count": 5, "targetName": "MyModule" },
  "message": "请在 Dashboard Candidates 页审核。",
  "meta": { "tool": "autosnippet_submit_candidates" }
}
```

示例（失败/限流）：
```json
{
  "success": false,
  "errorCode": "RATE_LIMIT",
  "message": "提交过于频繁，请 15s 后再试。",
  "meta": { "tool": "autosnippet_submit_candidates" }
}
```

回退策略：
- 降低批量大小（分批提交），并设置不同 `clientId` 避免同源限流碰撞
- 先做 `autosnippet_validate_candidate`/`autosnippet_check_duplicate` 以减少提交失败
- UI 未运行场景：提示用户 `asd ui` 启动后再试，不在同一轮重试
```

---

## Related Skills

- **autosnippet-create**: 提交单个 Recipe（vs 候选）
- **autosnippet-recipes**: 查询现有 Recipe（检测重复时用）
- **autosnippet-concepts**: 理解 Candidate vs Recipe 的区别
- **autosnippet-intent**: 用户意图识别（何时推荐生成候选）

---

## FAQ

**Q: 为什么不直接生成 Recipe 而要生成 Candidate？**

A: 候选是"待审核的候选 Recipe"。允许用户在提交前：
- 检查质量和准确性
- 标记重复或冲突
- 合并相关候选
- 编辑或补充信息

这大幅减少了低质量 Recipe 进入知识库的风险。

**Q: 并行查询 Recipe 会不会很慢？**

A: 不会。context_search 是异步的，与代码提取并行进行。
总耗时主要由代码解析和 AI 调用决定，额外的 context_search 开销可以忽略。

**Q: 如何自定义评分权重？**

A: 在项目配置中设置 `candidateScoringWeights`：
```json
{
  "codeQualityWeight": 0.3,
  "documentationWeight": 0.4,
  "projectAdaptabilityWeight": 0.3
}
```

---

**最后更新**: 2026-02-05

