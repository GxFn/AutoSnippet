---
name: autosnippet-create
description: Guides the agent to submit module usage code (designed/written with Cursor) to the AutoSnippet web (Dashboard) so it is added to the knowledge base (Recipes). Use when the user or Cursor has finished writing usage code and wants to "提交到 web" or "加入知识库".
---

# AutoSnippet Create — Submit to Web, Add to Knowledge Base

This skill tells the agent how to **submit module usage code** (that Cursor has designed or the user has written) to the **AutoSnippet web (Dashboard)** so it is **added to the knowledge base (Recipes)**. For concepts (knowledge base, Recipe), use **autosnippet-concepts**. For looking up existing Recipes, use **autosnippet-recipes**.

## Instructions for the agent (read this first)

1. **Goal**: When you (Cursor) have **finished writing or refining** module usage code, or the user says "把这段提交到 web / 加入知识库", guide them to **submit that code to the Dashboard** so it becomes a **Recipe** in `Knowledge/recipes/`.
2. **Do not modify Knowledge directly**: Agent **must not** create or modify any files under `Knowledge/recipes/` or `Knowledge/snippets/`. All Recipe and Snippet changes must be submitted via Dashboard Web and saved after human review.
3. **Primary flow**: Code is ready (in editor or clipboard) → user opens or already has **`asd ui`** running → in the Dashboard click **New Recipe** → **Use Copied Code** (paste the code) → AI fills title/summary/trigger/headers → **user reviews and approves** → user **saves** → Recipe is added to the knowledge base.
4. **Alternative (in editor)**: User adds **`// as:create`** in the source file, copies the code (or keeps the code you just wrote), saves the file → **watch** (from `asd watch` or `asd ui`) opens the Dashboard with current file path and clipboard → user completes "Use Copied Code" in the web, **reviews**, and saves → added to knowledge base.
5. **Project root** = directory with `AutoSnippetRoot.boxspec.json`. All commands run from the project root.

---

## Submit to web (提交到 web) — main flow

**Scenario**: Cursor has just written or refined **module usage code** (e.g. how to use a network API, how to load WebView). The user wants to add it to the **knowledge base** via the **web (Dashboard)**.

### Step 1: Content is ready

- **Code scenario**: Usage code is in current file or clipboard. If not copied, prompt user to copy the code block you provide.
- **Agent-drafted Recipe scenario**: If you have generated a full Recipe (frontmatter, Snippet, Usage Guide), **prefer writing to draft file** for user to copy (see "When full copy is difficult" below). Or output in copyable format in chat, guide user to copy → Dashboard → Use Copied Code → paste → review → save. Do not write to `Knowledge/recipes/` or `Knowledge/snippets/`.

### Step 2: Ensure the web (Dashboard) is running

- In the project root, run **`asd ui`** if the Dashboard is not already open.
- The Dashboard is the "web" side; submissions go through it to the knowledge base.

### Step 3: Submit via Dashboard

1. **If MCP is configured**: After user copies code, Agent can call **`autosnippet_open_create`** to open Dashboard New Recipe page (equivalent to Xcode `// as:create` save-then-jump). Page reads clipboard and fills. Optional: pass current file `path` for header resolution.
2. **Or**: User manually opens `asd ui` → click **New Recipe** → **Use Copied Code** → paste.
3. Pasted code: **Full Recipe MD** (with `---` frontmatter, `## Snippet / Code Reference`, `## AI Context / Usage Guide`) is parsed directly, **no AI rewrite**. Plain code still goes through AI analysis and fill.
4. **User reviews and approves** — 人工审核 title/summary/category/trigger 及内容，确认无误后再保存。
5. User **saves** → Recipe is written to **`Knowledge/recipes/`** — i.e. **added to the knowledge base**.

### Step 4: Optional — refresh Cursor's project context

- After saving, the user can run **`asd install:cursor-skill`** in the project root to regenerate `references/project-recipes-context.md` so Cursor's recipes skill has the latest context. This is optional and can be done later.

---

## Alternative: Copy then jump to Web (Xcode and Cursor)

**Option A — MCP (Cursor)**: After user copies code, Agent calls **`autosnippet_open_create`** to open Dashboard New Recipe page; page reads clipboard and fills. Optional: pass current file path for header resolution. Equivalent to Xcode copy→jump UX.

**Option B — // as:create (Xcode / in-editor)**: User adds **`// as:create`**, copies code, saves file. Requires **`asd watch`** or **`asd ui`** running; Watch detects save and opens Dashboard with path and clipboard.

---

## Other ways to add to knowledge base (via web)

| Way | When to use |
|-----|-------------|
| **New Recipe → Scan File** | Code is already in a project file; user enters relative path (e.g. `Sources/MyMod/Foo.m`) → Scan File → AI extracts → save in Dashboard. |
| **SPM Explorer** | Mine usage from an SPM Target: select Target → scan → review in Dashboard → save as Recipe (or Snippet + Recipe). |
| **Candidates** | Batch: run **`asd ais <Target>`** or **`asd ais --all`** → open Dashboard **Candidates** → approve items → saved to knowledge base. |

All of these **submit through the web (Dashboard)** and result in content in **`Knowledge/recipes/`** (and optionally Snippet). The main flow above (Use Copied Code) is for **code that Cursor has just written**.

**When generating content**: If Agent has drafted Recipe or Snippet content, pass the full content to user for Dashboard submission. Do not write to `Knowledge/recipes/` or `Knowledge/snippets/`.

**When full copy is difficult**: Long content in chat is hard to copy fully. Agent should **write to draft file** at project root: `_draft_recipe.md` (or `_draft_snippet.md`), outside Knowledge. User can: ① Open draft → select all → copy → Dashboard → Use Copied Code → paste; or ② Dashboard → New Recipe → **Scan File**, enter path `_draft_recipe.md`. Delete draft after save. Optional: add `_draft_*.md` to `.gitignore`.

---

## Quick reference

| User / Cursor situation | Action |
|-------------------------|--------|
| "把这段提交到 web / 加入知识库" (code just written) | **MCP**：提示用户复制代码 → 调用 **`autosnippet_open_create`**（可选传 path）→ 页面读取剪贴板。或 Copy → **`asd ui`** → New Recipe → Use Copied Code → paste → review → save. |
| Agent 起草了 Recipe/Snippet 内容 | **Prefer**: Write to `_draft_recipe.md` (project root) → user opens, copies all → call **`autosnippet_open_create`** or manual Dashboard → Use Copied Code → paste → review → save. |
| Code in current file, want to open web from editor | **MCP**：`autosnippet_open_create`（传 path）。或 Add **`// as:create`**, copy, save; ensure **`asd watch`** / **`asd ui`** running. |
| Code already in a file (path known) | **`asd ui`** → New Recipe → enter path → **Scan File** → review → save. |
| Agent 起草内容无法完整复制 | Write to `_draft_recipe.md` → user Scan File or open & copy → Dashboard → review → save. |
| Batch from Target | **`asd ais <Target>`** → **`asd ui`** → **Candidates** → approve. |

---

## MCP Tools (when asd ui is running)

| Tool | Use |
|------|-----|
| `autosnippet_context_search` | On-demand semantic search of knowledge base; pass `query`, `limit?` |
| `autosnippet_open_create` | Open Dashboard New Recipe page (copy→jump); equivalent to Xcode `// as:create`. Optional `path` for header resolution |

---

## Relation to other skills

- **autosnippet-concepts**: What the knowledge base and Recipe are; where they live.
- **autosnippet-recipes**: Read or search existing Recipe content; get project context.
- **autosnippet-dep-graph**: Dependency structure (unrelated to submit flow).
