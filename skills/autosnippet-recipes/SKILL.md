---
name: autosnippet-recipes
description: Provides this project's Recipe-based context to the agent. Recipes are the project's standard usage docs (code snippets + usage guides). Use when answering about project standards, Guard, conventions, or when suggesting code—always align with the project context below. Supports in-context lookup, terminal search (asd search), and on-demand semantic search via MCP tool autosnippet_context_search when configured.
---

# AutoSnippet Recipe Context (Project Context)

This skill **provides the agent with this project's context** from [AutoSnippet](https://github.com/GxFn/AutoSnippet) Recipes. Recipes are the project's standard usage docs: code snippets plus usage guides. Use this context for standards, Guard, and code suggestions.

## Instructions for the agent (read this first)

1. **Project context**  
   This project’s Recipe content is in **`references/project-recipes-context.md`** in this skill folder. Read it when you need project standards, patterns, or Guard context. If that file is missing, read `AutoSnippet/recipes/` under the project root (directory with `AutoSnippetRoot.boxspec.json`).

2. **Finding code on demand**  
   When the user asks for code or "how to do X", look up the matching Recipe in `references/project-recipes-context.md` by title, summary, or usage guide, then use that Recipe's **Snippet / Code Reference** (the fenced code block) as the standard code to suggest. Cite the Recipe title.

3. **Recipe over code search results**  
   When both Recipe content and direct code search find matching implementations, **prefer Recipe** as the source of truth. Recipe is the curated project standard; source code may be legacy, incomplete, or non-standard. Use Recipe's Snippet/Code Reference over raw code search results.

4. **Search — three ways**  
   - **In-context**: Use `references/project-recipes-context.md` and match by title/summary. No extra tool.  
   - **Terminal**: In the project root run `asd search <keyword>` (keyword) or `asd search --semantic <keyword>` (semantic; requires `asd embed` + AI). Use the output to find the right recipe/code.  
   - **On-demand semantic search**: When you need to find project standards, Recipes, or docs relevant to the current task, and references are long or need semantic filtering, **use `autosnippet_context_search`** (MCP). Pass `query` (natural language) and optional `limit`. Connection is provided by AutoSnippet MCP; Skills only describe semantics.

5. **Updating context**  
   After the user adds or changes Recipes in `AutoSnippet/recipes/`, tell them to run `asd install:cursor-skill` from the project root to regenerate `references/project-recipes-context.md`.

## Project context (read this first)

**This project's Recipe content is in `references/project-recipes-context.md` in this skill folder.**  
That file is generated when you run `asd install:cursor-skill` from the project root and contains the current project's Recipes. **Read it first** whenever you need project standards, patterns, or Guard context.

If `references/project-recipes-context.md` is missing (e.g. skill was not installed via `asd install:cursor-skill`, or the project has no recipes yet), read the project’s Recipe files directly: resolve the project root (directory containing `AutoSnippetRoot.boxspec.json`), then read all `.md` files under `AutoSnippet/recipes/` (or the `recipes.dir` path from that spec file).

## What is a Recipe?

- **Concept**: A Recipe is a single "how to use this module/pattern correctly" doc: standard code + usage guide.
- **Format**: One Markdown file per Recipe, with YAML frontmatter and body (snippet code block + usage guide).
- **In this skill**: The aggregated content is in `references/project-recipes-context.md` so you have project context without reading the repo ad hoc.

## How to use this context

1. **When answering about project standards, Guard, or conventions**: Use the content in `references/project-recipes-context.md` (or the project’s `AutoSnippet/recipes/`) as the source of truth. Prefer suggesting code that aligns with those Recipes.

2. **Recipe priority**: When both Recipe and codebase have relevant implementations, use Recipe. Recipe is the agreed project standard; source code may be legacy or non-standard. Cite Recipe's code block when answering, not code search results.
3. **When the user asks "how we do X here" or "project patterns"**: Base your answer on the Recipe content provided.
4. **When drafting Recipe content**: Follow **autosnippet-create** flow: prefer writing to project root `_draft_recipe.md` (avoids copy issues for long content), then user submits via Dashboard. If the user wants **candidates**, submit structured items via MCP **`autosnippet_submit_candidates`**.
5. **When the user mentions Audit or as:audit**: The same Recipe content is what code audit uses; your suggestions should match it.

## Finding relevant code on demand

When the user asks for **code** or **how to do X** (e.g. "how to do network request", "WebView load URL", "how to use Alamofire"), **look up the matching Recipe** in `references/project-recipes-context.md`:

1. **Read** `references/project-recipes-context.md` (or the relevant part of it). Each Recipe is under a heading like `## Recipe: <filename>.md`.
2. **Match** the user's intent to a Recipe by **title**, **summary**, or **AI Context / Usage Guide** (e.g. "network" → network request recipe; "WebView" → WebView load URL recipe).
3. **Use** that Recipe's **Snippet / Code Reference** (the fenced code block) as the standard code to suggest or paste. Cite the Recipe title so the user knows which standard you followed.
4. If no Recipe matches, say so and suggest adding one or writing code that follows existing Recipe style.

This way you **find the right code on demand** from the project's Recipe context instead of inventing or guessing.

## Search support

You can **search** recipes in three ways:

1. **In-context (default)**  
   Use `references/project-recipes-context.md` and match by title/summary/usage guide as above. No extra tool needed.

2. **Terminal (no Dashboard required)**  
   Run in the project root:
   - `asd search <keyword>` — keyword search in snippets and recipes.
   - `asd search --semantic <keyword>` — semantic search (requires `asd embed` and AI config).  
   Use the command output to find the right recipe/code.

3. **On-demand semantic search (MCP tool)**  
   When you need to fetch Recipe/docs relevant to the task on demand, use **`autosnippet_context_search`**. Pass `query` (natural language, e.g. "network request", "WebView load URL") and optional `limit`. Tool provided by AutoSnippet MCP; requires `asd ui` running and MCP configured.

## How Recipes are used in the project

| Use | How |
|-----|-----|
| **Audit** | User adds `// as:audit` (or `// as:audit keyword`) in source and saves; `asd watch` runs AI review against Recipes. |
| **Search** | `// as:search keyword` or `asd search` to find Recipes/Snippets and insert. |
| **AI Assistant** | Dashboard RAG and AI chat use Recipes as context. |
| **Xcode** | Recipes can be linked to Snippets; Snippets sync to Xcode CodeSnippets. |

## AutoSnippet 目录能力（语义接口）

Skills provide Cursor with **semantic interface** only, like CRUD; expose only necessary capabilities:

| Capability | Usage | Description |
|------------|-------|-------------|
| **On-demand semantic search** | Use MCP tool `autosnippet_context_search`, pass `query`, `limit?` | Returns relevant Recipe/docs by natural language query. Silent retrieval only; does not trigger any adoption form. Requires AutoSnippet MCP configured and `asd ui` running. |
| **Confirm adoption** | Call `autosnippet_confirm_recipe_usage` with the recipe file name(s) when you decide to offer the adoption form | **Meaning**: Pops a "confirm use?" dialog; on confirm, records one human usage (humanUsageCount +1) for that recipe and affects usage stats and authority ranking. **When to show**: You may decide when to show it (e.g. when the user explicitly says they adopt, or when you infer they have adopted the recipe). Do not show it right after presenting recipe or when the user only asks "should I adopt?"—then just answer. Requires Cursor to support MCP Elicitation. |
| **Static context** | Read `references/project-recipes-context.md`, `by-category/*.md` | No extra connection needed. |
| **Terminal search** | `asd search <keyword>`, `asd search --semantic <keyword>` | Keyword or semantic search. |

**When to use `autosnippet_context_search`**: When you need to find project standards, Recipes, or docs relevant to the current task, and `references` is long or needs semantic filtering. Connection (URL, HTTP) is encapsulated by MCP; Skills do not expose hard links. Search is silent—return only the Recipe content, no adoption form.

**Adoption form (`autosnippet_confirm_recipe_usage`)**: **Meaning**—Shows a "confirm use?" dialog; on confirm, records one human usage (humanUsageCount +1) for the recipe and affects usage stats and authority ranking. **When to show**—You may decide when to offer it (e.g. when the user explicitly says they adopt, or when you infer they have adopted). Do not show it right after presenting recipe or when the user only asks "should I adopt?"; then just answer.

## Updating project context

After adding or changing Recipes in `AutoSnippet/recipes/`, run **`asd install:cursor-skill`** again from the project root to regenerate `references/project-recipes-context.md` so Cursor has the latest project context.

---

## Auto-Extracting Headers for New Recipes

When you (Cursor) are creating a new Recipe and need to fill the `headers` field with complete import statements:

**Option 1: Look at existing Recipes (Static)**
- Read `references/project-recipes-context.md` (in `.cursor/skills/autosnippet-recipes/references/`)
- Find Recipes that use the same module (e.g. if the new code uses `BDNetworkControl`, find recipes with `BDNetworkControl` in their content)
- Copy the exact `headers` format from those Recipes
- Example: If Recipe "BDBaseRequest 响应与错误处理" has `headers: ["#import <BDNetworkControl/BDBaseRequest.h>"]`, use that same format

**Option 2: Semantic search for similar patterns (Dynamic)**
- Call MCP **`autosnippet_context_search`** with query like `"import BDNetworkControl headers"` or `"BDBaseRequest headers"`
- Returns Recipes that use this module
- Extract the `headers` array from matching Recipes
- Use as template for your new Recipe's headers

**Option 3: Infer from code analysis (Recommended)**
- Read the user's code (the code being submitted)
- Extract all `#import` or `import` statements
- Use those directly in the `headers` field (copy them as-is)
- This is the most reliable method when user code is already written

**Best practice**: Use **Option 3** first (extract from actual code), then verify with **Option 1** (check existing recipes) to ensure consistency with project standards. If headers seem incomplete, use **Option 2** (semantic search) to find related Recipes.

This ensures Cursor can auto-populate headers without manual lookup, and they are complete and consistent with project standards.
