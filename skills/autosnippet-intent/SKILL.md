---
name: autosnippet-intent
description: A light-weight router skill. Decide which AutoSnippet capability should be used (recipes/search/create/candidates/guard/structure/concepts). Use this to pick the right skill, then delegate to that skill for detailed steps.
---

# AutoSnippet — Intent Router

Use this skill when the user's intent is unclear or overlaps multiple capabilities. Your job is to select **one** primary capability, then hand off to the specific skill.

## Decision map (pick one primary path)

| User intent / situation | Primary skill | Notes |
|---|---|---|
| “有没有现成写法 / 查一下规范 / 给我标准代码” | **autosnippet-recipes** | Use Recipe context first. |
| “把这段加入知识库 / 提交到知识库” | **autosnippet-create** | Submit via Dashboard or draft. |
| “生成候选 / 批量扫描 / 扫 Target” | **autosnippet-candidates** | Generate rich candidates. |
| “帮我审计 / Lint / 规范检查” | **autosnippet-guard** | Use Recipe as audit standard. |
| “依赖关系 / 目标结构 / targets / spmmap” | **autosnippet-structure** | Targets + dep graph. |
| “知识库/Recipe/Trigger 是什么” | **autosnippet-concepts** | Explain concepts. |

## Rules

1. **Pick one primary path**. Avoid sending multiple flows unless the user explicitly asks.
2. **Do not force a flow**. Recommend softly (“可以…”), and only when relevant.
3. After choosing, **use the chosen skill** for the detailed steps.

## Deprecated skills (do not use)

- `autosnippet-when` → use this skill (autosnippet-intent)
- `autosnippet-search` → use autosnippet-recipes
- `autosnippet-batch-scan` / `autosnippet-recipe-candidates` → use autosnippet-candidates
- `autosnippet-dep-graph` → use autosnippet-structure

## MCP tools (reference only)

- Search: `autosnippet_context_search`
- Candidates: `autosnippet_validate_candidate`, `autosnippet_check_duplicate`, `autosnippet_submit_candidates`
- Structure: `autosnippet_get_targets`, `autosnippet_get_target_files`, `autosnippet_get_target_metadata`

This skill is a router only; it does not perform actions itself.

```
