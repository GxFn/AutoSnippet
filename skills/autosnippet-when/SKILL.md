---
name: autosnippet-when
description: Helps the agent decide WHEN to recommend which AutoSnippet capability. Use when the user's intent could be satisfied by knowledge base, search, guard, snippet, or creating new content. Read this first to choose the right skill or action; then use the specific skill (autosnippet-create, autosnippet-recipes, etc.) for steps.
---

# AutoSnippet — When to Recommend What

This skill helps you **decide when to recommend** which AutoSnippet capability. **You are in charge**: recommend only when it fits the user's intent; do not force a flow. Each capability is optional and can be suggested in natural language.

## Decision guide (you decide)

| User intent / situation | Consider recommending | Skill / action to use |
|-------------------------|------------------------|------------------------|
| "把这段代码加入知识库" / "提交到 web" / 刚写好一段标准用法 | **Create Recipe**：提交到 Dashboard，进 Knowledge/recipes | **autosnippet-create** |
| "项目里这段怎么写" / "有没有现成的写法" / "查一下规范" | **Search Recipe**：查知识库，用标准代码回答或插入 | **autosnippet-recipes**（读 context + 可选 as:search / API） |
| "帮我检查一下这个文件是否符合规范" / "Guard" | **Guard**：在文件里写 `// as:guard`，保存后 watch 按知识库审查 | **autosnippet-recipes**（Guard 用同一套 Recipe 内容） |
| "想用补全/触发词" / "这段做成 Snippet" / "Xcode 里怎么联想" | **Snippet / trigger**：在 Dashboard 编辑 Snippet，`asd install` 后 Xcode 用 trigger 补全 | **autosnippet-concepts**（Snippet 概念）+ 告诉用户 Dashboard + asd install |
| "头文件/import 不想手写" / "插入这段时自动带 #import" | **as:include / as:import**：在 Snippet body 里写 `// as:include <Module/Header.h>`，保存时 watch 自动注入 | **autosnippet-concepts** 或简短说明 |
| "依赖关系 / 谁依赖谁 / 模块结构" | **Dep graph**：读 AutoSnippet.spmmap.json 或建议 `asd spm-map` | **autosnippet-dep-graph** |
| 用户问 "知识库是什么 / Recipe 是什么" | **Concepts**：解释知识库、Recipe、Snippet、Candidates | **autosnippet-concepts** |

## Instructions for the agent

1. **You decide** whether to recommend an AutoSnippet capability. If the user did not ask for it, you may still **suggest** it once when it clearly helps (e.g. "这段可以提交到知识库，需要的话我可以教你用 Dashboard 提交").
2. **Do not force** a fixed flow. Prefer natural language ("你可以…" / "如果希望…可以…") over mandatory steps.
3. **Point to the right skill**: once you decide "this is a create/search/guard/snippet/dep question", use the corresponding skill (autosnippet-create, autosnippet-recipes, autosnippet-concepts, autosnippet-dep-graph) for the detailed steps.
4. **One capability at a time**: if the user only asked to search, don't also push create or guard unless they ask.

## Relation to other skills

- **autosnippet-concepts**: What is knowledge base, Recipe, Snippet; where things live.
- **autosnippet-create**: How to submit code to web and add to knowledge base (steps).
- **autosnippet-recipes**: Project context, how to search, Guard, and suggest code from Recipes.
- **autosnippet-dep-graph**: SPM dependency structure and when to use it.

Use **autosnippet-when** to choose; use the others for the "how".
