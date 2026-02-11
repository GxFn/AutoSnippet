```skill
---
name: autosnippet-coldstart
description: Cold-start knowledge base initialization. Full 9-dimension analysis workflow — works with both external Agent and internal AI. Call bootstrap_knowledge, then systematically analyze code and submit candidates.
---

# AutoSnippet — Cold Start (知识库冷启动)

> 首次接入项目 / 知识库重建 / 大版本升级后使用。目标：从零建立完整知识库，覆盖 9 大知识维度。
> Self-check & Fallback: MCP 工具返回 JSON Envelope（{ success, errorCode?, data?, meta }）。失败时不在同一轮重试，缩小范围再试。

## Quick Decision

| 情况 | 使用 |
|------|------|
| 首次接入 / "初始化知识库" / "冷启动" | **本 Skill**（完整冷启动） |
| 已有知识库，查/用 Recipe | → autosnippet-recipes |
| 只扫描单个文件/模块 | → autosnippet-candidates |
| 只做 Guard 审计 | → autosnippet-guard |
| 快速看看项目结构 | → autosnippet-structure（用 scan_project） |

---

## Phase 0: 启动扫描

调用 `autosnippet_bootstrap_knowledge` 收集项目结构化数据：

```json
{ "aiMode": "external", "maxFiles": 500, "contentMaxLines": 150 }
```

返回数据（你需要的上下文）：

| 字段 | 内容 |
|------|------|
| `targets` | 所有 SPM Target（含 `inferredRole`: core/service/ui/networking/…） |
| `filesByTarget` | 按 Target 分组的文件内容（含 `priority`: high/medium/low） |
| `dependencyGraph` | `{ nodes, edges }` 模块间依赖关系 |
| `guardViolationFiles` | Guard 规则违规列表 |
| `languageStats` | 文件扩展名统计 |
| `primaryLanguage` | 推断的主语言（swift/objectivec/typescript/…） |
| `languageExtension` | 语言特有扩展（**重要**，见下方） |
| `analysisFramework` | 9 维度分析框架（维度清单 + 候选模板） |

### languageExtension — 语言特有分析指引

`languageExtension` 包含当前项目主语言的特有信息：

| 字段 | 类型 | 说明 |
|------|------|------|
| `language` | string | 主语言名称 |
| `extraDimensions` | array | 语言特有的额外分析维度（如 Swift Concurrency、ObjC Block 模式） |
| `typicalPatterns` | array | 该语言中典型的代码模式提示 |
| `commonAntiPatterns` | array | 该语言常见反模式（bad/why/fix） |
| `suggestedGuardRules` | array | 建议的 Guard 规则（pattern/severity/message） |
| `agentCautions` | array | 该语言下 Agent 开发必须遵守的注意事项 |
| `customFields` | object | 预留扩展字段（供用户/插件自定义） |

**你的分析应同时覆盖 `analysisFramework.dimensions`（9 通用维度）和 `languageExtension.extraDimensions`（语言特有维度）。**

> **aiMode 选择**:
> - `external`（默认）= 你自己分析代码，功能最完整，质量最高
> - `internal` = 内置 AI 分析，你不需要逐文件阅读，适合 context window 不够的情况
> - `auto` = 先试 internal，失败自动降级 external

---

## Phase 1: 架构分析（全局视角）

**目标**: 提取 3-8 条架构级知识条目。

**分析步骤**:

1. **查看 `targets`** — 每个 Target 的 `inferredRole` 告诉你它可能是什么
2. **查看 `dependencyGraph.edges`** — 理解模块间依赖关系
3. **查看各 Target 核心文件** — 确认架构模式（MVVM / MVC / Clean / 模块化 SPM 等）
4. **识别分层边界** — 哪些层可以调用哪些层？有无跨层调用？

**输出类型**: `architecture` / `module-dependency` / `boundary-constraint`

**架构候选模板**:
```json
{
  "title": "分层架构: Presentation → Domain → Data",
  "code": "// 架构示意\nPresentation (FeatureA, FeatureB)\n  → Domain (UseCases, Entities)\n    → Data (Repositories, API, Storage)",
  "language": "swift",
  "category": "Architecture",
  "knowledgeType": "architecture",
  "scope": "project-specific",
  "rationale": "项目采用三层架构，Presentation 不直接访问 Data 层。所有数据访问通过 Domain 层的 UseCase 中转。",
  "steps": [
    { "title": "理解层级", "description": "Presentation 依赖 Domain, Domain 依赖 Data", "code": "" },
    { "title": "新模块规则", "description": "新功能模块放在 Presentation 层，公共逻辑放 Domain", "code": "" }
  ],
  "constraints": {
    "boundaries": ["View 层不直接 import Data 层模块"],
    "preconditions": []
  },
  "relations": {
    "dependsOn": [{ "target": "DomainModule", "description": "核心业务逻辑" }]
  },
  "reasoning": {
    "whyStandard": "项目全部模块遵循此分层，违反会导致循环依赖和测试困难",
    "sources": ["Package.swift", "dependencyGraph"],
    "confidence": 0.9
  }
}
```

---

## Phase 2: 逐 Target 代码分析（8 维度）

### 分析优先级

按 `priority` 字段排序文件。推荐顺序：

1. **high priority** — 核心模块、Service 层、配置、协议定义
2. **medium priority** — 功能模块、Model、View
3. **low priority** — 工具类、扩展、测试

### 8 维度分析清单

对每个文件，系统性提取：

| # | 维度 | 寻找什么 | knowledgeType | 示例 |
|---|------|---------|---------------|------|
| 1 | **代码规范** | 命名约定、注释风格、文件组织 | `code-standard` / `code-style` | "Manager 类统一以 Manager 结尾" |
| 2 | **使用习惯** | 常用封装、工厂方法、API 调用方式 | `code-pattern` | "网络请求统一用 Result<T, Error>" |
| 3 | **最佳实践** | 错误处理、并发、内存管理 | `best-practice` | "async 操作都用 Task { @MainActor in }" |
| 4 | **调用链** | 关键业务路径、初始化链 | `call-chain` | "登录: View → AuthService → API → Token" |
| 5 | **数据流** | 状态管理、响应式流 | `data-flow` | "Publisher 链: Network → VM → View" |
| 6 | **代码关系** | 继承、协议实现 | `code-relation` / `inheritance` | "所有 VC 继承 BaseViewController" |
| 7 | **Bug 修复** | 常见问题、defensive coding | `solution` + antiPattern | "避免在 deinit 中访问 weak self" |
| 8 | **边界约束** | 访问限制、线程要求 | `boundary-constraint` | "UI 操作必须在主线程" |

### antiPattern 格式（Bug 修复维度专用）

```json
{
  "antiPattern": {
    "bad": "DispatchQueue.main.async { self.update() }",
    "why": "在 Swift Concurrency 环境中可能造成数据竞争",
    "fix": "@MainActor func update() { ... }"
  }
}
```

### relations 格式（知识关联）

```json
{
  "relations": {
    "dependsOn": [{ "target": "NetworkModule", "description": "依赖网络层" }],
    "extends": [{ "target": "BaseService", "description": "扩展基础服务" }],
    "conflicts": [{ "target": "旧版 URLSession 直接调用", "description": "与新封装冲突" }]
  }
}
```

---

## Phase 3: 项目库特征（Project Profile）

分析项目整体技术特征，提交 1 条汇总型候选：

```json
{
  "title": "项目技术特征 — [ProjectName]",
  "code": "techStack:\n  primaryLanguage: Swift\n  frameworks: [SwiftUI, Combine]\n  minDeployment: iOS 15.0\n\nprojectStructure:\n  pattern: modular-spm\n  keyModules:\n    - BiliKit: 核心业务SDK\n    - BiliUI: UI组件库\n\ndependencies:\n  thirdParty:\n    - Alamofire: HTTP\n    - Kingfisher: Image",
  "language": "swift",
  "category": "Architecture",
  "knowledgeType": "architecture",
  "scope": "project-specific",
  "rationale": "项目技术栈全貌，新人 onboarding 和 Agent 理解项目的基础",
  "reasoning": {
    "whyStandard": "项目技术选型摘要，所有开发决策的基础上下文",
    "sources": ["Package.swift", "languageStats", "dependencyGraph"],
    "confidence": 0.95
  }
}
```

**分析要点**:
- 从 `languageStats` 推断主要语言
- 从 `targets` 推断项目结构（单体/模块化）
- 从 `dependencyGraph` 推断三方/自有模块依赖
- 从代码中的 import 语句推断框架使用

---

## Phase 4: Agent 开发注意事项

提取 Agent（Cursor/Copilot）在本项目开发时**必须遵守的规则**。每条规则一个候选。

### 规则类别与严重级别

| 类别 | severity | 示例 |
|------|----------|------|
| 命名 (naming) | `must` | "所有 ViewModel 以 VM 结尾" |
| 线程 (threading) | `must` | "UI 更新必须用 @MainActor" |
| 内存 (memory) | `should` | "闭包中使用 [weak self]" |
| 架构 (architecture) | `must` | "View 层不直接访问 Repository" |
| 安全 (security) | `must` | "不在代码中硬编码 API key" |
| 性能 (performance) | `should` | "大列表使用 LazyVStack" |

### Agent 注意事项候选模板

```json
{
  "title": "[must] UI 更新必须用 @MainActor",
  "code": "// ✅ 正确\n@MainActor\nfunc updateUI() {\n  label.text = newValue\n}\n\n// ❌ 错误\nfunc updateUI() {\n  DispatchQueue.main.async {\n    self.label.text = newValue\n  }\n}",
  "language": "swift",
  "category": "Tool",
  "knowledgeType": "boundary-constraint",
  "trigger": "@agent-threading",
  "rationale": "项目使用 Swift Concurrency，不在 @MainActor 标注下进行 UI 更新会导致 data race 警告",
  "reasoning": {
    "whyStandard": "所有 ViewModel 都标注了 @MainActor，Agent 新写的代码也必须遵守",
    "sources": ["Sources/FeatureA/ViewModel.swift"],
    "confidence": 0.9
  }
}
```

---

## Phase 5: 批量提交

将所有分析结果通过 `autosnippet_submit_candidates` 批量提交：

```json
{
  "items": [ /* Phase 1-4 的所有候选 */ ],
  "source": "bootstrap-external",
  "deduplicate": true
}
```

**建议**: 按维度分批提交，每批 10-20 条，避免单次请求过大。

### 预期产出（完整冷启动）

| 维度 | 预期条数 |
|------|---------|
| 代码规范 (code-standard / code-style) | 15-30 |
| 使用习惯 (code-pattern) | 20-40 |
| 架构模式 (architecture) | 3-8 |
| 最佳实践 (best-practice) | 10-20 |
| 调用链 (call-chain) | 5-10 |
| 数据流 (data-flow) | 3-8 |
| Bug 修复 (solution + antiPattern) | 5-15 |
| 项目特征 | 1 |
| Agent 注意事项 | 5-15 |
| 知识图谱边 | SPM 自动写入 |

总计: **70-150 条候选** → Dashboard 审核后成为正式 Recipe.

---

## 候选必填字段 Quick Reference

提交每条候选至少需要：

| 字段 | 必填? | 说明 |
|------|-------|------|
| `title` | ★★★ 必填 | 简明标题 |
| `code` | ★★★ 必填 | 代码模式或示例 |
| `language` | ★★★ 必填 | swift / objc / javascript 等 |
| `category` | ★★★ 必填 | View / Service / Tool / Network 等 |
| `knowledgeType` | ★★★ 必填 | 见 8 维度清单 |
| `reasoning.whyStandard` | ★★★ 必填 | 为什么值得沉淀 |
| `reasoning.sources` | ★★★ 必填 | 来源文件路径 |
| `reasoning.confidence` | ★★★ 必填 | 0-1 置信度 |
| `rationale` | ★★☆ 推荐 | 设计原理 |
| `scope` | ★★☆ 推荐 | universal / project-specific / target-specific |
| `complexity` | ★★☆ 推荐 | beginner / intermediate / advanced |
| `steps` | ★★☆ 推荐 | 实施步骤 |
| `constraints` | ★★☆ 推荐 | 前置条件/边界/副作用 |
| `relations` | ★★☆ 推荐 | 依赖/扩展/冲突关系 |
| `antiPattern` | 条件必填 | 仅 Bug 修复维度 |

---

## scan_project vs bootstrap_knowledge

| | scan_project | bootstrap_knowledge |
|---|---|---|
| **用途** | 快速结构探查（不写库） | 完整知识库初始化（写 knowledge_edges） |
| **SPM 图谱写入** | ❌ | ✅ |
| **文件内容** | 可选 (includeContent) | external 模式自动包含 |
| **Guard 审计** | ✅ | ✅ |
| **后续动作** | 看看就好 | Agent 分析 → submit_candidates |
| **适合场景** | 了解项目、检查 Guard | 首次接入、知识库重建 |

---

## Troubleshooting

| 问题 | 解决 |
|------|------|
| 文件太多超出 context window | 减小 `maxFiles`，或先分析 high priority 文件 |
| 分析维度太多一次做不完 | 分 Target 分批进行，每次分析 1-2 个 Target |
| 分析质量不高 | 切换 `aiMode="internal"` 使用内置 AI |
| Guard 违规太多 | 先处理 Guard 违规，再做知识分析 |
| 提交后候选在哪里 | Dashboard → Candidates 页面审核 |

---

## MCP Tools Referenced

| Tool | 用途 |
|------|------|
| `autosnippet_bootstrap_knowledge` | 启动冷启动扫描（本 Skill 核心工具） |
| `autosnippet_submit_candidates` | 批量提交候选 |
| `autosnippet_submit_candidate` | 提交单条候选 |
| `autosnippet_validate_candidate` | 校验候选字段 |
| `autosnippet_check_duplicate` | 去重检查 |
| `autosnippet_context_search` | 查找已有知识（避免重复） |
| `autosnippet_scan_project` | 轻量探查（不写库） |

## Related Skills

- **autosnippet-analysis**: 语义字段补全 + 深度分析（用于增量分析）
- **autosnippet-candidates**: 完整候选字段模型 + V2 Schema
- **autosnippet-structure**: 项目结构发现 (targets / files / dependencies)
- **autosnippet-guard**: Guard 规则详情
```
