---
name: autosnippet-recipes
description: Provides this project's Recipe-based context to the agent. Recipes are the project's standard usage docs (code snippets + usage guides). Use when answering about project standards, Guard, conventions, or when suggesting code—always align with the project context below. Supports in-context lookup, terminal search (asd search), and HTTP search when asd ui is running.
---

# AutoSnippet Recipe Context (Project Context)

This skill **provides the agent with this project's context** from [AutoSnippet](https://github.com/GxFn/AutoSnippet) Recipes. Recipes are the project's standard usage docs: code snippets plus usage guides. Use this context for standards, Guard, and code suggestions.

## Instructions for the agent (read this first)

1. **Project context**  
   This project's Recipe content is in **`references/project-recipes-context.md`** in this skill folder. Read it when you need project standards, patterns, or Guard context. If that file is missing, read `Knowledge/recipes/` under the project root (directory with `AutoSnippetRoot.boxspec.json`).

2. **Finding code on demand**  
   When the user asks for code or "how to do X", look up the matching Recipe in `references/project-recipes-context.md` by title, summary, or usage guide, then use that Recipe's **Snippet / Code Reference** (the fenced code block) as the standard code to suggest. Cite the Recipe title.

3. **Search (查找) — three ways**  
   - **In-context**: Use `references/project-recipes-context.md` and match by title/summary. No extra tool.  
   - **Terminal**: In the project root run `asd search <keyword>` (keyword) or `asd search --semantic <keyword>` (semantic; requires `asd embed` + AI). Use the output to find the right recipe/code.  
   - **When `asd ui` is running**: Call HTTP APIs (same host as Dashboard, e.g. `http://localhost:3000`):  
     - Keyword: `GET /api/recipes/search?q=<keyword>` → `{ results: [{ name, path, content }], total }`.  
     - Semantic: `POST /api/search/semantic` body `{ keyword, limit }` → vector search results.  
   Use terminal or API when you need to search by keyword/semantic instead of scanning the full context file.

4. **Updating context**  
   After the user adds or changes Recipes in `Knowledge/recipes/`, tell them to run `asd install:cursor-skill` from the project root to regenerate `references/project-recipes-context.md`.

## Project context (read this first)

**This project's Recipe content is in `references/project-recipes-context.md` in this skill folder.**  
That file is generated when you run `asd install:cursor-skill` from the project root and contains the current project's Recipes. **Read it first** whenever you need project standards, patterns, or Guard context.

If `references/project-recipes-context.md` is missing (e.g. skill was not installed via `asd install:cursor-skill`, or the project has no recipes yet), read the project's Recipe files directly: resolve the project root (directory containing `AutoSnippetRoot.boxspec.json`), then read all `.md` files under `Knowledge/recipes/` (or the `recipes.dir` path from that spec file).

## What is a Recipe?

- **Concept**: A Recipe is a single "how to use this module/pattern correctly" doc: standard code + usage guide.
- **Format**: One Markdown file per Recipe, with YAML frontmatter and body (snippet code block + usage guide).
- **In this skill**: The aggregated content is in `references/project-recipes-context.md` so you have project context without reading the repo ad hoc.

## How to use this context

1. **When answering about project standards, Guard, or conventions**: Use the content in `references/project-recipes-context.md` (or the project's `Knowledge/recipes/`) as the source of truth. Prefer suggesting code that aligns with those Recipes.
2. **When the user asks "how we do X here" or "project patterns"**: Base your answer on the Recipe content provided.
3. **When editing or drafting Recipe files**: Keep YAML frontmatter and the Snippet + Usage Guide structure; use existing Recipes as examples.
4. **When the user mentions Guard or as:guard**: The same Recipe content is what Guard uses; your suggestions should match it.

## Finding relevant code on demand

When the user asks for **code** or **how to do X** (e.g. "网络请求怎么写", "WebView 加载 URL", "怎么用 Alamofire"), **look up the matching Recipe** in `references/project-recipes-context.md`:

1. **Read** `references/project-recipes-context.md` (or the relevant part of it). Each Recipe is under a heading like `## Recipe: <filename>.md`.
2. **Match** the user's intent to a Recipe by **title**, **summary**, or **AI Context / Usage Guide** (e.g. "网络" → recipe about network request; "WebView" → recipe about WebView load URL).
3. **Use** that Recipe's **Snippet / Code Reference** (the fenced code block) as the standard code to suggest or paste. Cite the Recipe title so the user knows which standard you followed.
4. If no Recipe matches, say so and suggest adding one or writing code that follows existing Recipe style.

This way you **find the right code on demand** from the project's Recipe context instead of inventing or guessing.

## Search (查找) support

You can **search** recipes in three ways:

1. **In-context (default)**  
   Use `references/project-recipes-context.md` and match by title/summary/usage guide as above. No extra tool needed.

2. **Terminal (no Dashboard required)**  
   Run in the project root:
   - `asd search <keyword>` — keyword search in snippets and recipes.
   - `asd search --semantic <keyword>` — semantic search (requires `asd embed` and AI config).  
   Use the command output to find the right recipe/code.

3. **When `asd ui` is running**  
   The Dashboard exposes HTTP APIs that any client (browser, script, MCP) can call:
   - **Keyword search**: `GET /api/recipes/search?q=<keyword>` — returns `{ results: [{ name, path, content }], total }`.
   - **Semantic search**: `POST /api/search/semantic` with body `{ keyword, limit }` — returns vector search results.  
   Base URL is the same as the Dashboard (e.g. `http://localhost:3000`). Use these when you have access to the running server (e.g. via MCP or a script).

## How Recipes are used in the project

| Use | How |
|-----|-----|
| **Guard** | User adds `// as:guard` (or `// as:guard keyword`) in source and saves; `asd watch` runs AI review against Recipes. |
| **Search** | `// as:search keyword` or `asd search` to find Recipes/Snippets and insert. |
| **AI Assistant** | Dashboard RAG and AI chat use Recipes as context. |
| **Xcode** | Recipes can be linked to Snippets; Snippets sync to Xcode CodeSnippets. |

## Updating project context

After adding or changing Recipes in `Knowledge/recipes/`, run **`asd install:cursor-skill`** again from the project root to regenerate `references/project-recipes-context.md` so Cursor has the latest project context.
