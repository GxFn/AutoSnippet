---
name: autosnippet-when
description: DEPRECATED. Use autosnippet-intent for routing. This file remains for compatibility only.
---

# AutoSnippet — When to Recommend What (Deprecated)

**Deprecated**: use **autosnippet-intent** as the router skill. This file is retained for backward compatibility.

This skill helps you **decide when to recommend** which AutoSnippet capability. **You are in charge**: recommend only when it fits the user's intent; do not force a flow. Each capability is optional and can be suggested in natural language.

## Decision guide (you decide)

| User intent / situation | Consider recommending | Skill / action to use |
|-------------------------|------------------------|------------------------|
| "把这段代码加入知识库" / "提交到 web" / 刚写好一段标准用法 / Agent 起草了 Recipe | **Create Recipe**: submit via Dashboard (Use Copied Code → paste → review → save) or write to `_draft_recipe.md` | **autosnippet-create** |
| "产出候选" / "生成候选" / "先放候选池" | **Candidates only**: extract structured items and submit via MCP **`autosnippet_submit_candidates`** | **autosnippet-candidates** |
| "项目里这段怎么写" / "有没有现成的写法" / "查一下规范" | **Search Recipe**: lookup knowledge base, suggest or insert standard code | **autosnippet-recipes** (read context + optional as:search / API) |
| "帮我检查一下这个文件是否符合规范" / "Audit" | **Audit**: add `// as:audit` in file, save; watch reviews against Recipes | **autosnippet-recipes** (same Recipe content) |
| "想用补全/触发词" / "这段做成 Snippet" / "Xcode 里怎么联想" | **Snippet / trigger**: edit in Dashboard, `asd install` then Xcode trigger completion | **autosnippet-concepts** + tell user Dashboard + asd install |
| "头文件/import 不想手写" / "插入这段时自动带 #import" | **as:include / as:import**: add `// as:include <Module/Header.h>` in Snippet body; watch injects on save | **autosnippet-concepts** or brief note |
| "依赖关系 / 谁依赖谁 / 模块结构" | **Dep graph**: read AutoSnippet.spmmap.json or suggest `asd spm-map` | **autosnippet-structure** |
| "用 Cursor 扫一下这个 Target" / "批量提取候选" / 像 asd ais 但用 Cursor 模型 | **Batch scan**: get_targets → get_target_files → 按文件提取 → submit_candidates；到 Candidates 审核 | **autosnippet-candidates** |
| 用户问 "知识库是什么 / Recipe 是什么" | **Concepts**: explain knowledge base, Recipe, Snippet, Candidates | **autosnippet-concepts** |

## Instructions for the agent

1. **You decide** whether to recommend an AutoSnippet capability. If the user did not ask for it, you may still **suggest** it once when it clearly helps (e.g. "这段可以提交到知识库，需要的话我可以教你用 Dashboard 提交").
2. **Do not force** a fixed flow. Prefer natural language ("你可以…" / "如果希望…可以…") over mandatory steps.
3. **Point to the right skill**: once you decide "this is a create/search/guard/snippet/dep/batch-scan question", use the corresponding skill (autosnippet-create, autosnippet-recipes, autosnippet-concepts, autosnippet-structure, autosnippet-candidates) for the detailed steps.
4. **One capability at a time**: if the user only asked to search, don't also push create or guard unless they ask.
5. **Recommended workflow**: For "候选" use **`autosnippet_submit_candidates`**; for "入库" can use Dashboard flow or write to `_draft_recipe.md`.

## On-Demand Context (when asd ui is running)

Use MCP tool `autosnippet_context_search` for on-demand semantic search; pass `query`, `limit?`. Requires AutoSnippet MCP configured and `asd ui` running.

---

## Relation to other skills

- **autosnippet-concepts**: What is knowledge base, Recipe, Snippet; where things live.
- **autosnippet-create**: How to submit code to web and add to knowledge base (steps).
- **autosnippet-recipes**: Project context, how to search, Guard, and suggest code from Recipes.
- **autosnippet-structure**: SPM dependency structure and when to use it.
- **autosnippet-candidates**: Unified candidate generation (single file + batch target). MCP provides the tools.

Use **autosnippet-intent** to choose; use the others for the "how".

```
