---
name: autosnippet-batch-scan
description: DEPRECATED. Use autosnippet-candidates (v2.0) for both single-file and batch Target candidate generation.
---

# AutoSnippet Batch Scan — Cursor as Batch Scanner (Deprecated)

**Deprecated**: use **autosnippet-candidates** for unified candidate generation (single file + batch target). This file is kept for backward compatibility only.

This skill describes **when and how** to use **Cursor as a batch scanning tool** for an SPM Target: get target list → get file list → extract candidates per file with Cursor → submit to Dashboard Candidates → human review. **Skills express semantics** (when to use, flow, order of steps); **MCP provides capability** (the tools `autosnippet_get_targets`, `autosnippet_get_target_files`, `autosnippet_submit_candidates`). Do not expose URLs or HTTP here; call MCP tools by name.

## When to use this skill

- User wants to **scan a whole Target** (or multiple files) with **Cursor’s model** to extract Recipe-like candidates and send them to Dashboard for review.
- User asks for "用 Cursor 扫一下这个 Target" / "批量提取候选" / "像 asd ais 那样但用 Cursor 模型" — i.e. **alternative or complement** to `asd ais [Target]` (which uses project-configured AI).
- **Prerequisites**: `asd ui` running (Dashboard on localhost:3000), MCP configured. Same Candidates pool as `asd ais`; review and approve in Dashboard **Candidates** page.

## Flow (semantics only; capability = MCP tools)

1. **Get Target list**  
   Call MCP **`autosnippet_get_targets`** (no args). User or agent picks a `targetName` (e.g. `MyModule`) from the result.

2. **Get file list for that Target**  
   Call MCP **`autosnippet_get_target_files`** with `targetName`. Result is the list of source files (path, name) for that Target.

3. **Extract candidates per file**  
   For each file: read file content (in editor or via Cursor), use **Cursor's model** to extract Recipe-shaped items. **Each item should be a SINGLE independent usage pattern** (one specific scenario, one focused code snippet). Extract fields: title, summary, trigger, language, code, usageGuide; optional summary_cn, usageGuide_cn, category, headers.
   
   **Important extraction rules**:
   - ✅ **One Recipe per specific usage**: If a file has 3 different usage patterns (e.g. init, load, refresh), extract 3 separate Recipe items.
   - ❌ **Don't create mega-Recipes**: Avoid combining multiple patterns ("This module does A, B, C...") into one Recipe.
   - ✅ **Focus on reusable snippets**: Each Recipe's code block should be a self-contained, copy-pasteable example for ONE scenario.
   - ✅ **Clear trigger per scenario**: `@ModuleInit`, `@ModuleLoad`, `@ModuleRefresh` — not just `@Module`.
   
   Collect into an `items` array.

4. **Submit candidates**  
   Call MCP **`autosnippet_submit_candidates`** with `targetName`, `items`, and optional `source` (e.g. `cursor-scan`), `expiresInHours` (e.g. 24). Candidates are appended to Dashboard for the given target.

5. **Review**  
   User opens Dashboard **Candidates** page to approve or ignore each candidate — same workflow as for `asd ais` results.

## Relation to asd ais

| | asd ais [Target] | Cursor batch scan (this skill) |
|--|------------------|----------------------------------|
| **Model** | Project AI (.env) | Cursor’s current model |
| **Trigger** | CLI | MCP tools + Cursor Agent |
| **Output** | Same Candidates pool | Same Candidates pool |

Both feed the same **Candidates** pool; review and save flow in Dashboard is identical.

## Instructions for the agent

1. **Recommend only when it fits**: e.g. user wants to scan a Target with Cursor, or wants to compare Cursor vs project AI for extraction.
2. **Do not hard-code URLs or HTTP**: use MCP tools only. If MCP is unavailable, suggest running `asd ui` and configuring MCP, or using `asd ais [Target]` instead.
3. **One flow at a time**: get_targets → get_target_files → extract (per file) → submit_candidates. Do not skip steps; each tool is provided by MCP.
4. **Output via Candidates**: Batch scan outputs candidates via **`autosnippet_submit_candidates`**.
5. **Hard rule — Single scenario per Recipe**: Each extracted item **must** represent one specific usage scenario. If multiple patterns are found, split into multiple items.

## Relation to other skills

- **autosnippet-when**: Use this skill when the user’s intent is "batch scan a Target with Cursor"; when routes here.
- **autosnippet-concepts**: Candidates and knowledge base concepts; Skills = semantics, MCP = capability.
- **autosnippet-create**: Single Recipe submit (open create page, paste); batch scan is multi-file → multi-candidate → submit in one go.

```
