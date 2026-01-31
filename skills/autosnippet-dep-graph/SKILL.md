---
name: autosnippet-dep-graph
description: Teaches the agent where and how the project's SPM dependency structure is stored. Use when the user asks about dependencies, module relationships, what depends on what, package/target layout, or when suggesting code that crosses modules.
---

# AutoSnippet Dependency Structure (Dep Graph)

This skill gives the agent context about the project's **SPM (Swift Package Manager) dependency structure** in projects that use [AutoSnippet](https://github.com/GxFn/AutoSnippet). The structure is stored in a single JSON file and can be read to answer "what does X depend on," "which packages use Y," or "where is module Z."

## Where the Dependency Structure Lives

- **Path**: `Knowledge/AutoSnippet.spmmap.json` under the **project root**.
- **Project root**: The directory containing `AutoSnippetRoot.boxspec.json` (same as Recipe context).
- **Update command**: Run `asd spm-map` (or `asd spmmap`) from the project root to (re)generate or update this file by scanning `Package.swift` files.

## File Structure (AutoSnippet.spmmap.json)

The file has a top-level shape and an optional **graph** section used for the dependency graph:

| Section | Purpose |
|--------|---------|
| `schemaVersion` | Format version (e.g. 2). |
| `packages` | Package declarations: `{ packageName: { kind: "path"|"url", path?: "...", url?: "...", from?: "1.0.0" } }`. |
| `products` | Product declarations: `{ productName: { kind: "product", name, package } }` linking products to packages. |
| `policy` | Optional (e.g. `no_package_cycle`). |
| `graph` | Parsed dependency graph (see below). |

### graph (dependency graph)

When present, `graph` contains:

- **graph.packages**: `{ packageName: { packageName, packageDir, packageSwift, targets: [targetName, ...] } }`  
  - `packageDir`: directory name of the package under project.  
  - `packageSwift`: path to `Package.swift`.  
  - `targets`: list of SPM target names in that package.

- **graph.edges**: `{ fromPackageName: [toPackageName, ...] }`  
  - "from depends on to." Used to answer "what does X depend on" and "who depends on Y."

- **graph.pathDecls** (optional): path declarations between packages.

- **graph.projectRoot**, **graph.generatedAt**: metadata.

## When to Use This Skill

- User asks about **dependencies**, **module relationships**, **what depends on what**, **package structure**, or **target layout**.
- User wants to add a dependency or change module boundaries—check existing edges and packages first.
- User asks "where is package X" or "which targets are in package Y"—use `graph.packages`.
- User asks "what does Service X depend on" or "who uses Foundation"—use `graph.edges` (and optionally products/packages for names).

## What to Do

1. **Locate the file**: Resolve project root (directory with `AutoSnippetRoot.boxspec.json`), then read `Knowledge/AutoSnippet.spmmap.json`.
2. **Answer dependency questions**: Use `graph.packages` for package/target layout; use `graph.edges` for "A depends on B" and reverse lookups for "who depends on B."
3. **Suggest edits**: When suggesting new dependencies or module changes, align with existing `packages` and `products` and the direction of `graph.edges` (no cycles if policy says so).
4. **If file missing or stale**: Tell the user to run `asd spm-map` from the project root to generate or update the file.

## On-Demand Context (when asd ui is running)

Use MCP tool `autosnippet_context_search` for on-demand semantic search; pass `query`, `limit?`. Requires AutoSnippet MCP configured and `asd ui` running.

## Relation to Other AutoSnippet Skills

- **autosnippet-recipes**: Recipes live under `Knowledge/recipes/`; dep graph lives under `Knowledge/AutoSnippet.spmmap.json`. Both are under the same project root.
- Use **autosnippet-dep-graph** for dependency/structure questions; use **autosnippet-recipes** for code standards and Guard/Recipe content.
