---
name: autosnippet-guard
description: When the user wants to check if the current file meets project standards (e.g. "审查一下", "检查规范", "Audit"), use this skill to recommend writing // as:audit and saving; the same Recipe content used for suggestions is used for code audit.
---

# AutoSnippet Guard — When to Recommend

> Self-check & Fallback: MCP 工具返回统一 JSON Envelope（{ success, errorCode?, message?, data?, meta }）。重操作前调用 autosnippet_health/autosnippet_capabilities；失败时不在同一轮重试，转用静态上下文或缩小范围后再试。

**Use this skill when**: The user wants to **check** whether the current file or code meets **project standards** (规范 / Audit). You decide whether to recommend; do not force.

## When to recommend

- User says: "审查一下这个文件" / "检查是否符合规范" / "Audit" / "用知识库检查".
- User has just edited a file and wants automated review against Recipe standards.

## How to recommend (you choose wording)

- "Add `// as:audit` (or `// as:audit keyword`) in the file; after save, watch runs AI review against Recipes, output to terminal."
- Ensure `asd watch` or `asd ui` is running in the project root so watch can detect the save.

## What Guard uses

- The same **Recipe** content in `AutoSnippet/recipes/` (and `references/project-recipes-context.md`) is what Guard uses as the standard. No separate config.

## Audit trigger

Use `// as:audit` (or `// as:audit keyword`) only. `// as:lint` has been deprecated.

## On-Demand Context (when asd ui is running)

Use MCP tool `autosnippet_context_search` for on-demand semantic search; pass `query`, `limit?`. Requires AutoSnippet MCP configured and `asd ui` running.

## Relation

- **autosnippet-intent**: General "when to recommend what"; may point here for Guard.
- **autosnippet-recipes**: Recipe content and context; Guard reads the same content.

```
