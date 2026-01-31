---
name: autosnippet-guard
description: When the user wants to check if the current file meets project standards (e.g. "审查一下", "检查规范", "Guard"), use this skill to recommend writing // as:guard and saving; the same Recipe content used for suggestions is used for Guard.
---

# AutoSnippet Guard — When to Recommend

**Use this skill when**: The user wants to **check** whether the current file or code meets **project standards** (规范 / Guard). You decide whether to recommend; do not force.

## When to recommend

- User says: "审查一下这个文件" / "检查是否符合规范" / "Guard" / "用知识库检查".
- User has just edited a file and wants automated review against Recipe standards.

## How to recommend (you choose wording)

- "Add `// as:guard` (or `// as:guard keyword`) in the file; after save, watch runs AI review against Recipes, output to terminal."
- Ensure `asd watch` or `asd ui` is running in the project root so watch can detect the save.

## What Guard uses

- The same **Recipe** content in `Knowledge/recipes/` (and `references/project-recipes-context.md`) is what Guard uses as the standard. No separate config.

## On-Demand Context (when asd ui is running)

Use MCP tool `autosnippet_context_search` for on-demand semantic search; pass `query`, `limit?`. Requires AutoSnippet MCP configured and `asd ui` running.

## Relation

- **autosnippet-when**: General "when to recommend what"; may point here for Guard.
- **autosnippet-recipes**: Recipe content and context; Guard reads the same content.
