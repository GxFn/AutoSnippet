---
name: autosnippet-search
description: When the user wants to find or insert standard code from the knowledge base (e.g. "查一下项目里怎么写", "有没有现成的写法", "插入这段标准代码"), use this skill to recommend search (as:search, Dashboard, or API) and then use autosnippet-recipes for the actual lookup.
---

# AutoSnippet Search — When to Recommend

**Use this skill when**: The user wants to **find** or **insert** standard code from the project's knowledge base (Recipes). You decide whether to recommend; do not force.

## When to recommend

- User says: "查一下项目里怎么写 X" / "有没有现成的写法" / "插入标准代码" / "用知识库里的写法".
- User is editing a file and could benefit from inserting a Recipe's code block at the current line.

## How to recommend (you choose wording)

- **In editor**: "可以在当前行写 `// as:search 关键词`，保存后 watch 会打开 Dashboard，选一条 Recipe 插入替换该行。"
- **Terminal**: "在项目根运行 `asd search 关键词` 或 `asd search --semantic 关键词` 查看候选。"
- **Dashboard open**: "在 Dashboard 搜索框输入关键词，选一条点击插入到当前文件。"

## Actual lookup

- For **finding** the right Recipe content (title, summary, code block), use the **autosnippet-recipes** skill: read `references/project-recipes-context.md` or call search API.
- This skill only tells you **when** to recommend search and **how** to describe it to the user.

## Relation

- **autosnippet-when**: General "when to recommend what"; may point here for search.
- **autosnippet-recipes**: Project context, search API, and code lookup steps.
