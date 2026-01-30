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

- "在文件里写一行 `// as:guard`（或 `// as:guard 关键词`），保存后 watch 会按知识库（Recipes）用 AI 审查当前文件，结果输出到终端。"
- Ensure `asd watch` or `asd ui` is running in the project root so watch can detect the save.

## What Guard uses

- The same **Recipe** content in `Knowledge/recipes/` (and `references/project-recipes-context.md`) is what Guard uses as the standard. No separate config.

## Relation

- **autosnippet-when**: General "when to recommend what"; may point here for Guard.
- **autosnippet-recipes**: Recipe content and context; Guard reads the same content.
