---
name: autosnippet-concepts
description: Teaches the agent AutoSnippet's core concepts: knowledge base (知识库), Recipe (配方), Snippet, Candidates, and where they live. Use when the user asks about "知识库", Recipe, Snippet, or the structure of AutoSnippet project data.
---

# AutoSnippet Concepts (知识库与 Recipe)

This skill explains [AutoSnippet](https://github.com/GxFn/AutoSnippet)'s **knowledge base** (知识库) and related concepts so the agent can answer "what is X" and "where does Y live."

## Instructions for the agent

1. **Project root** = directory containing `AutoSnippetRoot.boxspec.json`. All paths below are relative to the project root.
2. For **looking up** existing Recipe content or **searching** recipes, use the **autosnippet-recipes** skill.
3. For **creating** a new Recipe or Snippet, use the **autosnippet-create** skill.

---

## Knowledge base (知识库)

In AutoSnippet, the **knowledge base** is the set of project-owned artifacts under **`Knowledge/`** used for standards, reuse, and AI context:

| Part | Location | Meaning |
|------|----------|---------|
| **Snippets** | `Knowledge/snippets/*.json` + root spec `list` | Code snippets synced to Xcode CodeSnippets; developers use them by trigger (completion). |
| **Recipes** | `Knowledge/recipes/*.md` (or `recipes.dir` in root spec) | Markdown docs: standard code + usage guide; used for AI context, Guard, and search. |
| **Candidates** | `Knowledge/.autosnippet/candidates.json` | AI-scanned candidates; review in Dashboard **Candidates** then approve or delete. |
| **Vector index** | `Knowledge/.autosnippet/vector_index.json` | Built by `asd embed` for semantic search and Guard. |

---

## Recipe (配方)

- **Definition**: One Recipe = one `.md` file in `Knowledge/recipes/` (or the path in root spec `recipes.dir`).
- **Content**: YAML frontmatter (id, title, trigger, summary, language, category, …) + body with **Snippet / Code Reference** (fenced code block) and **AI Context / Usage Guide**.
- **Role**: The unit of "project standard" for a given pattern or module; used for Guard, search, AI Assistant, and (optionally) linked Snippet.
- **Lookup**: Use the **autosnippet-recipes** skill to read or search Recipe content.

---

## Snippet

- **Definition**: A single code snippet entry (title, trigger, body, headers, etc.) listed in the root spec or under `Knowledge/snippets/`.
- **Role**: Synced to Xcode CodeSnippets via **`asd install`**; developers insert by trigger or from the snippet library.
- **Relation**: A Recipe can describe the same pattern as a Snippet; creating from Dashboard can produce both.

---

## Relation to other skills

- **autosnippet-recipes**: Read project context, search recipes, find code on demand.
- **autosnippet-create**: Creation flow (Dashboard, CLI, `// as:create`).
- **autosnippet-dep-graph**: SPM dependency structure (`Knowledge/AutoSnippet.spmmap.json`).
