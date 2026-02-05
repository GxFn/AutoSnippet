---
name: autosnippet-candidates
description: >
  生成 Recipe 候选：单文件扫描或批量 Target 扫描。
  理解候选质量评分、相似度标记、元数据意义。
  Merge of old autosnippet-recipe-candidates + autosnippet-batch-scan.
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

> 详细版说明见本目录 [skills/autosnippet-candidates/SKILL_REDESIGNED.md](skills/autosnippet-candidates/SKILL_REDESIGNED.md)。
