---
name: autosnippet-candidates
description: 生成 Recipe 候选：单文件扫描或批量 Target 扫描。理解候选质量评分、相似度标记、元数据意义。Merge of old autosnippet-recipe-candidates + autosnippet-batch-scan.
---

# AutoSnippet — Generate Candidates with Rich Information (v2.0)
> Self-check & Fallback: MCP 工具返回统一 JSON Envelope（{ success, errorCode?, message?, data?, meta }）。重操作前调用 autosnippet_health/autosnippet_capabilities；失败时不在同一轮重试，转用静态上下文或缩小范围后再试。

## Quick Start

**Scenario 1: 用户说“扫描某个模块/文件生成候选”**
1. 读取目标文件/模块（含 README 或示例）
2. 提取公开 API、使用示例、文档注释
3. 生成多个候选（一个模式一个候选）
4. 并行查询现有 Recipe → 标记相似度/冲突
5. 评分并排序 → 提交 Candidates 池

**Scenario 2: 用户说“批量扫描 Target”**
1. 调用 `autosnippet_get_targets` → 选择 targetName
2. 调用 `autosnippet_get_target_files(targetName)`
3. 批量提取候选（并行）
4. 去重、评分、相似度标记 → 提交 Candidates

## Candidate = 多维信息包
候选不只是代码块，应包含：
- 基础字段：title/summary/trigger/code/usageGuide/language/category/headers
  - **title**: **中文**，简短精准（✅ "颜色工具方法"、"网络请求重试"；❌ 避免 "Use BDUIKit for colors" 等机械格式）
  - **trigger**: `@` 开头，小写+下划线
  - **category**: 8 个标准值之一（View/Service/Tool/Model/Network/Storage/UI/Utility）
- 质量评分：codeQuality/documentationQuality/projectAdaptability/overallScore
- 元数据：sourceFile/confidence/coverageScore
- 关系标记：relatedRecipes（similarity/relationship）
- 审核建议：reviewNotes（priority/suggestions/warnings）

## Information Extraction (三层模型)

**Layer 1: Primary（必须）**
- Public API、docstring、usage 示例
- 输出：title/summary/trigger/code/usageGuide

**Layer 2: Contextual（强烈推荐）**
- headers/import、性能、错误处理、安全、兼容性
- 输出：headers/keywords/technicalProfile

**Layer 3: Relationship（高价值）**
- 通过 `autosnippet_context_search` 生成相似度与关系
- 输出：relatedRecipes/reviewNotes

## Single File / Module Scan（简版流程）
1. 读取文件 → 找出 public 类/函数/常用模式
2. 三层信息提取 → 评分
3. 调用 `autosnippet_context_search` 标记相似度
4. （可选）`autosnippet_validate_candidate` 预校验
5. （可选）`autosnippet_check_duplicate` 去重提示
6. `autosnippet_submit_candidates` 提交

## Batch Target Scan（简版流程）
1. `autosnippet_get_targets` → 选择 targetName
2. `autosnippet_get_target_files(targetName)`
3. 并行扫描 → 聚合/去重/评分
4. `autosnippet_submit_candidates` 提交

## MCP Tools
- `autosnippet_get_targets`
- `autosnippet_get_target_files`
- `autosnippet_get_target_metadata`
- `autosnippet_context_search`
- `autosnippet_validate_candidate`
- `autosnippet_check_duplicate`
- `autosnippet_submit_candidates`
- `autosnippet_submit_draft_recipes`（当使用 draft .md 提交流程时）

## Key Principles
1. 一候选一模式（不要“大全”）
2. 优先信息丰富（上下文、关系、评分）
3. 生成时并行查询现有 Recipe，降低重复
4. 失败不重试同轮，缩小范围或转静态上下文
5. 代码示例推荐使用 Xcode 占位符（如 `<#URL#>`、`<#Token#>`），并在 Usage Guide 解释含义

## AI Context / Usage Guide 格式要求（CRITICAL）

**⚠️ MUST use Markdown format:**
- **MUST use `###` section headings** — 每个主要内容块单独一行（如 `### 何时用`、`### 关键点`）
- **MUST use `-` bullet lists** — 列表项用 `-` 开头，每项单独一行
- **NEVER** put all content in one continuous line（禁止连续文本无换行）

**BAD (❌):**
```
何时用：场景A；场景B。关键点：要点1；要点2。依赖：模块X。
```

**GOOD (✅):**
```
### 何时用
- 需要场景A时
- 需要场景B时

### 关键点
- 要点1：详细说明
- 要点2：详细说明

### 依赖
- 模块X（最低版本Y）
```

**建议包含的内容**（提升可用性与可检索性）：
- 何时用 / 何时不用
- 关键点 / 注意事项
- 依赖与前置条件（模块、权限、最低版本）
- 核心步骤/关键配置（参数、默认值、边界条件）
- 错误处理/异常分支（重试、超时、降级）
- 性能与资源考量（缓存、线程、内存）
- 安全与合规提示（敏感数据、鉴权、日志）
- 常见误用与踩坑
- 相关 Recipe/扩展读物

> 详细版说明见本目录 [skills/autosnippet-candidates/SKILL_REDESIGNED.md](./../../skills/autosnippet-candidates/SKILL_REDESIGNED.md)。

```
