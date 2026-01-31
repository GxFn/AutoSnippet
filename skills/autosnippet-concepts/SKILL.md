---
name: autosnippet-concepts
description: Teaches the agent AutoSnippet's core concepts: knowledge base (知识库), Recipe (配方), Snippet, Candidates, context storage (向量库), and where they live. Recipe priority over project implementation. Includes capability and content summary. Use when the user asks about "知识库", Recipe, Snippet, 向量库, or the structure of AutoSnippet project data.
---

# AutoSnippet Concepts (Knowledge Base and Recipe)

This skill explains [AutoSnippet](https://github.com/GxFn/AutoSnippet)'s **knowledge base** (知识库) and related concepts so the agent can answer "what is X" and "where does Y live."

## Instructions for the agent

1. **Project root** = directory containing `AutoSnippetRoot.boxspec.json`. All paths below are relative to the project root.
2. For **looking up** existing Recipe content or **searching** recipes, use the **autosnippet-recipes** skill.
3. For **creating** a new Recipe or Snippet, use the **autosnippet-create** skill. **Do not** directly modify `Knowledge/recipes/` or `Knowledge/snippets/`; must submit via Dashboard Web.

---

## Knowledge base (知识库)

In AutoSnippet, the **knowledge base** is the set of project-owned artifacts under **`Knowledge/`** used for standards, reuse, and AI context:

| Part | Location | Meaning |
|------|----------|---------|
| **Snippets** | `Knowledge/snippets/*.json` + root spec `list` | Code snippets synced to Xcode CodeSnippets; developers use them by trigger (completion). |
| **Recipes** | `Knowledge/recipes/*.md` (or `recipes.dir` in root spec) | Markdown docs: standard code + usage guide; used for AI context, Guard, and search. |
| **Candidates** | `Knowledge/.autosnippet/candidates.json` | AI-scanned candidates; review in Dashboard **Candidates** then approve or delete. |
| **Context index** | `Knowledge/.autosnippet/context/` | Vector index built by `asd embed`; used for on-demand semantic search and Guard. |

---

## Context Storage and Vector Store

The knowledge base has **context storage** capability: Recipes, docs, etc. are embedded and support semantic search. The agent queries on demand via MCP tool `autosnippet_context_search` without preloading all content.

**Safety and role statement**:
- Context storage and vector store are **safe** external storage; they only hold project knowledge (Recipes, docs, etc.), with no user privacy or sensitive data exposure risk.
- **Skills express semantics** (when to query, what to query, how to use); **MCP provides capability** (connection, retrieval, response).
- **Cursor can use Context storage and vector store as external context**: call `autosnippet_context_search` on demand to fetch relevant chunks instead of loading all knowledge into the conversation, thus **saving context space** (tokens/context window).

| Item | Description |
|------|-------------|
| **Storage path** | `Knowledge/.autosnippet/context/` |
| **Build command** | Run `asd embed` from project root |
| **Index sources** | `recipe` (Knowledge/recipes/*.md), `doc` (docs dir), `target-readme` (SPM target READMEs) |
| **Storage adapter** | Default `json`; configurable `lance` (requires optional LanceDB) |
| **Usage** | With `asd ui` running, MCP tool `autosnippet_context_search` takes `query`, `limit?` for semantic search |
| **Use cases** | On-demand lookup of relevant Recipe/docs; Guard review against knowledge base; Dashboard semantic search |

**Prerequisites**: `asd embed` run, `asd ui` started, MCP configured.

**Usage guidance for Cursor**: Assume `asd ui` is kept running when calling MCP tools (`autosnippet_context_search`, `autosnippet_open_create`). If a call fails (e.g. connection refused, API error), do **not** retry within the current agent cycle; fall back to static context (`references/project-recipes-context.md`) or in-context lookup instead.

---

## Recipe (配方)

- **Definition**: One Recipe = one `.md` file in `Knowledge/recipes/` (or the path in root spec `recipes.dir`).
- **Content**: YAML frontmatter (id, title, trigger, summary, language, category, …) + body with **Snippet / Code Reference** (fenced code block) and **AI Context / Usage Guide**.
- **Role**: The unit of "project standard" for a given pattern or module; used for Guard, search, AI Assistant, and (optionally) linked Snippet.
- **Lookup**: Use the **autosnippet-recipes** skill to read or search Recipe content.

### Recipe Priority Over Project Implementation

When both Recipe and project source code have relevant implementations, **prefer Recipe**. Recipe is the curated project standard; source code may be legacy, incomplete, or non-standard. When answering, suggesting code, or running Guard, cite Recipe's Snippet/Code Reference instead of raw search results.

---

## Snippet

- **Definition**: A single code snippet entry (title, trigger, body, headers, etc.) listed in the root spec or under `Knowledge/snippets/`.
- **Role**: Synced to Xcode CodeSnippets via **`asd install`**; developers insert by trigger or from the snippet library.
- **Relation**: A Recipe can describe the same pattern as a Snippet; creating from Dashboard can produce both.
- **Creation**: Recipe and Snippet creation/modification must go through Dashboard Web; do not edit files under Knowledge directly.

---

## On-Demand Context (when asd ui is running)

When `asd ui` is running in the project root, use the HTTP API for on-demand semantic search:
- MCP tool `autosnippet_context_search` (pass `query`, `limit?`) → returns relevant Recipe/docs
- Used to fetch Recipe/docs relevant to the current task dynamically instead of loading all at once.

---

## Quick Summary

| Capability | Description | Skill |
|------------|-------------|-------|
| **Recipe lookup** | Read `references/project-recipes-context.md` or MCP `autosnippet_context_search`. Recipe over source | autosnippet-recipes |
| **Create Recipe** | Dashboard Use Copied Code / Scan File; do not write Knowledge directly | autosnippet-create |
| **Search & insert** | `// as:search`, `asd search`, Dashboard search | autosnippet-search |
| **Guard review** | `// as:guard`; watch runs AI review against knowledge base | autosnippet-guard |
| **Dependency graph** | `Knowledge/AutoSnippet.spmmap.json`; `asd spm-map` to update | autosnippet-dep-graph |
| **Vector store** | Built by `asd embed`; `autosnippet_context_search` for on-demand lookup. Use as context storage to save space | autosnippet-concepts / autosnippet-recipes |
| **MCP tools** | `autosnippet_context_search` (semantic search), `autosnippet_open_create` (open New Recipe page) | — |

**Principles**: Recipe is project standard, over project implementation; do not modify Knowledge directly, submit via Dashboard. Context storage is safe; Skills express semantics, MCP provides capability; Cursor calls on demand to save space.

---

## Relation to other skills

- **autosnippet-recipes**: Read project context, search recipes, find code on demand.
- **autosnippet-create**: Creation flow (Dashboard, CLI, `// as:create`).
- **autosnippet-dep-graph**: SPM dependency structure (`Knowledge/AutoSnippet.spmmap.json`).
