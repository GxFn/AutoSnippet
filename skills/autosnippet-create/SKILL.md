---
name: autosnippet-create
description: Guides the agent to submit module usage code (designed/written with Cursor) to the AutoSnippet web (Dashboard) so it is added to the knowledge base (Recipes). Use when the user or Cursor has finished writing usage code and wants to "提交到 web" or "加入知识库".
---

# AutoSnippet Create — Submit to Web, Add to AutoSnippet

This skill tells the agent how to **submit module usage code** (that Cursor has designed or the user has written) to the **AutoSnippet web (Dashboard)** so it is **added to the knowledge base (Recipes)**. For concepts (knowledge base, Recipe), use **autosnippet-concepts**. For looking up existing Recipes, use **autosnippet-recipes**.

## Instructions for the agent (read this first)

1. **Goal**: When you (Cursor) have **finished writing or refining** module usage code, or the user says "把这段提交到 web / 加入知识库", guide them to **submit that code to the Dashboard** so it becomes a **Recipe** in `AutoSnippet/recipes/`.
2. **Draft workflow**: Prefer **creating a draft folder** (e.g. `.autosnippet-drafts`), **one .md file per Recipe**, multiple draft files—**do not use one big file**. Call MCP **`autosnippet_submit_draft_recipes`** with filePaths (the .md files in the draft folder) to submit to Candidates. **After submit, delete the draft folder** (use `deleteAfterSubmit: true` or run `rm -rf .autosnippet-drafts`). Single-item flow can use `_draft_recipe.md` and watch will auto-add to Candidates.
3. **When user asks for "candidates"**: Use MCP **`autosnippet_submit_candidates`** for structured items (title/summary/trigger/code/usageGuide); use **`autosnippet_submit_draft_recipes`** for Markdown draft files (prefer draft folder + multiple files; delete draft folder after submit).
4. **One Recipe = one scenario**: If you are drafting content, **split** into multiple Recipes by scenario. Never combine multiple usage patterns into one Recipe file or one candidate.
5. **Recipe candidates can be intro-only**: Intro-only docs (no code block) can be submitted as candidates; after approval they become Recipes and **do not generate a Snippet**—used only for search and Guard context.
6. **MUST follow standard Recipe format**: Use the complete template from **autosnippet-concepts** skill. Include all required fields: frontmatter with `title`, `trigger`, `category` (one of 8 standard values), `language`, `summary`, `headers` (complete import statements), plus `## Snippet / Code Reference` and `## AI Context / Usage Guide` section. **RECOMMENDED (optional): Provide English version too**—summary_en + English `## AI Context / Usage Guide (EN)` section improves search and team knowledge sharing (token cost minimal, ROI high). Chinese-only is acceptable. Never use module names as category; extract all imports to headers array.
7. **Auto-fill headers from project context**: Before submitting, **automatically check `references/project-recipes-context.md`** (in `.cursor/skills/autosnippet-recipes/references/`) to see what modules and headers are already used in similar Recipes. Copy the exact import format for `headers` field. If needed, call MCP **`autosnippet_context_search`** with the module name to find similar Recipes and extract their header patterns. This ensures consistency and correctness.
8. **Primary flow**: Code is ready (in editor or clipboard) → user opens browser to **`http://localhost:3000`**（Dashboard 需已运行）→ in the Dashboard click **New Recipe** → **Use Copied Code** (paste the code) → AI fills title/summary/trigger/headers → **user reviews and approves** → user **saves** → Recipe is added to the knowledge base.
8. **Alternative (in editor)**: User adds **`// as:create`** in the source file, copies the code (or keeps the code you just wrote), saves the file → **watch** (from `asd watch` or `asd ui`) opens the Dashboard with current file path and clipboard → user completes "Use Copied Code" in the web, **reviews**, and saves → added to knowledge base.
9. **Draft & clipboard auto-add**: When you write to **`_draft_recipe.md`** (project root) or user uses **`// as:create`** with clipboard content, **watch** automatically reads the draft/clipboard, adds it to **Candidates** (target `_draft` or `_watch`), and shows a **friendly prompt** (e.g. "已创建候选「xxx」，请在 Candidates 页审核" in notification and console). User only needs to open Dashboard **Candidates** to review and save — no manual copy-paste required.
10. **Multiple recipes**: Prefer **one .md file per Recipe** in a draft folder (e.g. `.autosnippet-drafts/`), call **`autosnippet_submit_draft_recipes`** with the list of file paths, then **delete the draft folder** after submit. Do not use one big file for many Recipes.
11. **Project root** = directory with `AutoSnippetRoot.boxspec.json`. All commands run from the project root.

---

## Submit to web (提交到 web) — main flow

**Scenario**: Cursor has just written or refined **module usage code** (e.g. how to use a network API, how to load WebView). The user wants to add it to the **knowledge base** via the **web (Dashboard)**.

### Step 1: Content is ready

- **Code scenario**: Usage code is in current file or clipboard. If not copied, prompt user to copy the code block you provide.
...rated a full Recipe (frontmatter, Snippet, Usage Guide), **prefer writing to draft file** `_draft_recipe.md` at project root. On save, **watch automatically reads the draft**, adds it to **Candidates** (target `_draft`), and shows a **friendly prompt** ("已创建候选「xxx」，请在 Candidates 页审核"). User opens Dashboard **Candidates** to review and save — no manual copy needed. Or output in copyable format in chat and guide user to copy → Dashboard → Use Copied Code → paste → review → save. **Do not write to `AutoSnippet/recipes/` or `AutoSnippet/snippets/`.**
- **Candidate output rule**: When the user asks for candidates, **do not create files under `AutoSnippet/`**. Use **`autosnippet_submit_candidates`** for structured items; use **`autosnippet_submit_draft_recipes`** for draft .md files (prefer draft folder + multiple files; delete draft folder after submit).

### Step 2: Open the web (Dashboard) in browser

- **Preferred**: Call MCP **`autosnippet_open_create`** to open the page.
- **If MCP fails or browser doesn't open**: Run in terminal: `open "http://localhost:3000/?action=create&source=clipboard"` (macOS). This opens the browser directly.
- **Manual fallback**: User opens **`http://localhost:3000`** in browser (Dashboard 需已运行；若未运行，先执行 `asd ui`).

### Step 3: Submit via Dashboard

1. **If MCP is configured**: Call **`autosnippet_open_create`** to open Dashboard New Recipe page. Page reads clipboard and fills. Optional: pass current file `path` for header resolution.
2. **If MCP doesn't open browser**: Run terminal command `open "http://localhost:3000/?action=create&source=clipboard"` (macOS) to open the browser.
3. **Manual fallback**: User opens **`http://localhost:3000`** in browser → **New Recipe** → **Use Copied Code** → paste.
3. Pasted code: **Full Recipe MD** (with `---` frontmatter, `## Snippet / Code Reference`, `## AI Context / Usage Guide`) is parsed directly, **no AI rewrite**. Plain code still goes through AI analysis and fill.
4. **User reviews and approves** — 人工审核 title/summary/category/trigger 及内容，确认无误后再保存。
5. User **saves** → Recipe is written to **`AutoSnippet/recipes/`** — i.e. **added to the knowledge base**.

### Step 4: Optional — refresh Cursor's project context

- After saving, the user can run **`asd install:cursor-skill`** in the project root to regenerate `references/project-recipes-context.md` so Cursor's recipes skill has the latest context. This is optional and can be done later.

---

## Alternative: Copy then jump to Web (Xcode and Cursor)

**Option A — MCP (Cursor)**: After user copies code, Agent calls **`autosnippet_open_create`** to open Dashboard New Recipe page; page reads clipboard and fills. Optional: pass current file path for header resolution. Equivalent to Xcode copy→jump UX.

**Option B — // as:create (Xcode / in-editor)**: User adds **`// as:create`**, copies code, saves file. Requires **`asd watch`** or **`asd ui`** running. If clipboard has content, watch **automatically adds to Candidates** and shows a **friendly prompt** ("已创建候选「xxx」，请在 Candidates 页审核"); user opens Dashboard **Candidates** to review and save. If no clipboard, watch opens Dashboard with path for manual paste.

---

## Other ways to add to knowledge base (via web)

| Way | When to use |
|-----|-------------|
| **New Recipe → Scan File** | Code is already in a project file; user enters relative path (e.g. `Sources/MyMod/Foo.m`) → Scan File → AI extracts → save in Dashboard. |
| **SPM Explorer** | Mine usage from an SPM Target: select Target → scan → review in Dashboard → save as Recipe (or Snippet + Recipe). |
| **Candidates** | Batch: run **`asd ais <Target>`** or **`asd ais --all`** → open Dashboard **Candidates** → approve items → saved to knowledge base. |

All of these **submit through the web (Dashboard)** and result in content in **`AutoSnippet/recipes/`** (and optionally Snippet). The main flow above (Use Copied Code) is for **code that Cursor has just written**.

**Friendly prompt (友好提示)**: When draft file or `// as:create` with clipboard is used, the system adds content to **Candidates** and shows: ① Console message "已创建候选「xxx」，请在 Candidates 页审核"; ② On macOS, a notification "已创建候选「xxx」，请在 Candidates 页审核". Tell the user: "内容已加入候选池，请打开 Dashboard 的 **Candidates** 页审核并保存即可。"

**When generating content**: If Agent has drafted Recipe or Snippet content, prefer writing to `_draft_recipe.md` so watch can auto-add to Candidates with friendly prompt. Or pass the full content to user for Dashboard submission.

**When full copy is difficult**: Long content in chat is hard to copy fully. Agent should **write to draft file** at project root: `_draft_recipe.md` (or `_draft_snippet.md`), outside AutoSnippet/. **Watch automatically reads the draft on save** and adds it to **Candidates** (target `_draft`), then shows a **friendly prompt** ("已创建候选「xxx」，请在 Candidates 页审核"). User opens Dashboard **Candidates** → review and save — no manual copy or Scan File needed. Optional: add `_draft_*.md` to `.gitignore`. Delete draft after save if desired.

**Multiple recipes in one draft**: To submit **several Recipes at once**, write them in one `_draft_recipe.md`. Each Recipe is a **complete block** starting with `---` (frontmatter). **Separate blocks with a blank line, then the next block starts with `---`**. Example structure:
```
---
title: Recipe A
trigger: @foo
...
---

## Snippet / Code Reference
```objc
code A
```

## AI Context / Usage Guide
usage A

---
title: Recipe B
...
---

## Snippet / Code Reference
...
```
Watch parses all such blocks and adds each as a separate candidate; prompt may say "已创建 N 条候选".

---

## Quick reference

| User / Cursor situation | Action |
|-------------------------|--------|
| "把这段提交到 web / 加入知识库" (code just written) | 1) 提示用户复制代码；2) 调用 **`autosnippet_open_create`**；3) 若浏览器未打开，运行 `open "http://localhost:3000/?action=create&source=clipboard"`；4) 用户粘贴并保存。 |
| Agent 起草了 Recipe/Snippet 内容 | **Prefer**: Write to `_draft_recipe.md` (project root) → save → **watch 自动读取并加入候选池**，并给出友好提示 → 用户打开 Dashboard **Candidates** 审核并保存。无需手动复制。 |
| Code in current file, want to open web from editor | **MCP**：`autosnippet_open_create`（传 path）。或 Add **`// as:create`**, copy, save；确保 **`asd watch`** / **`asd ui`** 运行；有剪贴板时自动加入候选并友好提示。 |
| Code already in a file (path known) | 打开 **`http://localhost:3000`** → New Recipe → enter path → **Scan File** → review → save. |
| Agent 起草内容无法完整复制 | Write to `_draft_recipe.md` → save → **watch 自动读取草稿、加入候选并友好提示** → 用户打开 **Candidates** 审核保存。 |
| Batch from Target | **`asd ais <Target>`** → 打开 **`http://localhost:3000`** → **Candidates** → approve. |

---

## MCP Tools (when Dashboard is running on localhost:3000)

| Tool | Use |
|------|-----|
| `autosnippet_context_search` | On-demand semantic search of knowledge base; pass `query`, `limit?` |
| `autosnippet_open_create` | Open Dashboard New Recipe page (copy→jump); equivalent to Xcode `// as:create`. Optional `path` for header resolution |
| `autosnippet_submit_draft_recipes` | Submit draft .md as candidates: prefer draft folder + multiple files (not one big file); supports intro-only docs (no code—no Snippet). Pass `filePaths`, optional `targetName`, `deleteAfterSubmit`. **Delete the draft folder after submit** (e.g. `deleteAfterSubmit: true` or `rm -rf .autosnippet-drafts`). |
| `autosnippet_submit_candidates` | Submit structured items (title, summary, trigger, language, code, usageGuide) for batch scan, etc. |

**Fallback when MCP doesn't open browser**: Run in terminal: `open "http://localhost:3000/?action=create&source=clipboard"` (macOS). Agent should try this if `autosnippet_open_create` returns but the browser did not open.

---

## Relation to other skills

- **autosnippet-concepts**: What the knowledge base and Recipe are; where they live.
- **autosnippet-recipes**: Read or search existing Recipe content; get project context.
- **autosnippet-dep-graph**: Dependency structure (unrelated to submit flow).
