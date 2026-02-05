---
name: autosnippet-structure
description: Discover project structure (targets, files, dependency graph). Use when the user asks about module structure, SPM targets, or dependency relationships.
---

# AutoSnippet — Structure & Dependencies

> Self-check & Fallback: MCP 工具返回统一 JSON Envelope（{ success, errorCode?, message?, data?, meta }）。重操作前调用 autosnippet_health/autosnippet_capabilities；失败时不在同一轮重试，转用静态上下文或缩小范围后再试。

Use this skill when the user asks about **project structure**, **SPM targets**, or **dependency graph**.

## When to use

- “有哪些 Target？”
- “某个 Target 包含哪些文件？”
- “依赖关系/谁依赖谁？”
- “SPM 结构/模块拓扑”

## MCP tools

1. **List targets**: `autosnippet_get_targets`
2. **List target files**: `autosnippet_get_target_files`
3. **Target metadata**: `autosnippet_get_target_metadata`

## Dependency graph

For dependency graph visualization or details:
- Use Dashboard dep graph (requires asd ui)
- Or suggest `asd spm-map` to refresh map

## Notes

- Keep results concise: show target name, type, path, and key dependencies.
- If a user requests code generation, switch to **autosnippet-recipes** or **autosnippet-create** after you clarify the structure.

```
