---
name: autosnippet-create
description: Guides the agent to submit module usage code (designed/written with Cursor) to the AutoSnippet web (Dashboard) so it is added to the knowledge base (Recipes). Use when the user or Cursor has finished writing usage code and wants to "提交到 web" or "加入知识库".
---

# AutoSnippet Create — Submit to Web, Add to Knowledge Base

This skill tells the agent how to **submit module usage code** (that Cursor has designed or the user has written) to the **AutoSnippet web (Dashboard)** so it is **added to the knowledge base (Recipes)**. For concepts (knowledge base, Recipe), use **autosnippet-concepts**. For looking up existing Recipes, use **autosnippet-recipes**.

## Instructions for the agent (read this first)

1. **Goal**: When you (Cursor) have **finished writing or refining** module usage code, or the user says "把这段提交到 web / 加入知识库", guide them to **submit that code to the Dashboard** so it becomes a **Recipe** in `Knowledge/recipes/`.
2. **Primary flow**: Code is ready (in editor or clipboard) → user opens or already has **`asd ui`** running → in the Dashboard click **New Recipe** → **Use Copied Code** (paste the code) → AI fills title/summary/trigger/headers → user reviews and **saves** → Recipe is added to the knowledge base.
3. **Alternative (in editor)**: User adds **`// as:create`** in the source file, copies the code (or keeps the code you just wrote), saves the file → **watch** (from `asd watch` or `asd ui`) opens the Dashboard with current file path and clipboard → user completes "Use Copied Code" in the web and saves → added to knowledge base.
4. **Project root** = directory with `AutoSnippetRoot.boxspec.json`. All commands run from the project root.

---

## Submit to web (提交到 web) — main flow

**Scenario**: Cursor has just written or refined **module usage code** (e.g. how to use a network API, how to load WebView). The user wants to add it to the **knowledge base** via the **web (Dashboard)**.

### Step 1: Code is ready

- The usage code is either in the current file (that Cursor edited) or the user has copied it to the clipboard.
- If the user has not copied it yet, tell them to **copy the code block** you provided (or the relevant part of the file).

### Step 2: Ensure the web (Dashboard) is running

- In the project root, run **`asd ui`** if the Dashboard is not already open.
- The Dashboard is the "web" side; submissions go through it to the knowledge base.

### Step 3: Submit via Dashboard

1. In the Dashboard, click **New Recipe**.
2. Click **Use Copied Code** (or equivalent: "Import from Clipboard").
3. Paste the code (or it may be pre-filled if opened via `// as:create`). The Dashboard uses AI to fill title, summary, trigger, headers.
4. User reviews and edits title/summary/category/trigger if needed, then **saves**.
5. The Recipe is written to **`Knowledge/recipes/`** — i.e. **added to the knowledge base**.

### Step 4: Optional — refresh Cursor's project context

- After saving, the user can run **`asd install:cursor-skill`** in the project root to regenerate `references/project-recipes-context.md` so Cursor's recipes skill has the latest context. This is optional and can be done later.

---

## Alternative: // as:create (open web from editor)

When the user is **in the editor** and the usage code is in the current file:

1. User adds a line **`// as:create`** (e.g. above or below the code block).
2. User **copies** the usage code to the clipboard.
3. User **saves** the file.
4. **Watch** must be running: **`asd watch`** in a terminal, or **`asd ui`** (Dashboard starts watch in the background).
5. Watch detects the save and **opens the Dashboard** with the current file path; clipboard content can trigger "Use Copied Code" with header resolution from the path.
6. User completes the form in the web and **saves** → Recipe is added to the knowledge base.

Use this when the user prefers to stay in the editor and have the web open automatically.

---

## Other ways to add to knowledge base (via web)

| Way | When to use |
|-----|-------------|
| **New Recipe → Scan File** | Code is already in a project file; user enters relative path (e.g. `Sources/MyMod/Foo.m`) → Scan File → AI extracts → save in Dashboard. |
| **SPM Explorer** | Mine usage from an SPM Target: select Target → scan → review in Dashboard → save as Recipe (or Snippet + Recipe). |
| **Candidates** | Batch: run **`asd ais <Target>`** or **`asd ais --all`** → open Dashboard **Candidates** → approve items → saved to knowledge base. |

All of these **submit through the web (Dashboard)** and result in content in **`Knowledge/recipes/`** (and optionally Snippet). The main flow above (Use Copied Code) is for **code that Cursor has just written**.

---

## Quick reference

| User / Cursor situation | Action |
|-------------------------|--------|
| "把这段提交到 web / 加入知识库" (code just written) | Copy code → **`asd ui`** → New Recipe → **Use Copied Code** → paste → review → save. |
| Code in current file, want to open web from editor | Add **`// as:create`**, copy code, save; ensure **`asd watch`** or **`asd ui`** is running. |
| Code already in a file (path known) | **`asd ui`** → New Recipe → enter path → **Scan File** → review → save. |
| Batch from Target | **`asd ais <Target>`** → **`asd ui`** → **Candidates** → approve. |

---

## Relation to other skills

- **autosnippet-concepts**: What the knowledge base and Recipe are; where they live.
- **autosnippet-recipes**: Read or search existing Recipe content; get project context.
- **autosnippet-dep-graph**: Dependency structure (unrelated to submit flow).
