---
name: autosnippet-search
description: DEPRECATED. Use autosnippet-intent for routing, and autosnippet-recipes for actual lookup.
---

# AutoSnippet Search — When to Recommend (Deprecated)

**Deprecated**: use **autosnippet-intent** for routing, then use **autosnippet-recipes** for actual lookup.

**Use this skill when**: The user wants to **find** or **insert** standard code from the project's knowledge base (Recipes). You decide whether to recommend; do not force.

## When to recommend

- User says: "查一下项目里怎么写 X" / "有没有现成的写法" / "插入标准代码" / "用知识库里的写法".
- User is editing a file and could benefit from inserting a Recipe's code block at the current line.

## How to recommend (you choose wording)

- **In editor**: "Add `// as:search keyword` on the current line; after save, watch opens Dashboard; pick a Recipe to insert and replace that line."
- **Terminal**: "Run `asd search keyword` or `asd search --semantic keyword` in project root to see candidates."
- **Dashboard open**: "Enter keyword in Dashboard search box; pick one and click to insert into current file."

## Actual lookup

- For **finding** the right Recipe content (title, summary, code block), use the **autosnippet-recipes** skill: read `references/project-recipes-context.md` or call search API.
- This skill only tells you **when** to recommend search and **how** to describe it to the user.

## On-Demand Context (when asd ui is running)

Use MCP tool `autosnippet_context_search` for on-demand semantic search; pass `query`, `limit?`. Requires AutoSnippet MCP configured and `asd ui` running.

---

## Relation

- **autosnippet-intent**: Router for "when to recommend what"; may point here for search.
- **autosnippet-recipes**: Project context, search API, and code lookup steps.

```
