---
name: autosnippet-recipe-candidates
description: DEPRECATED. Use autosnippet-candidates (v2.0) for unified candidate generation. Draft flow is an optional path in that skill.
---

# AutoSnippet Recipe Candidates — Draft Folder + MCP Submit (Deprecated)

**Deprecated**: use **autosnippet-candidates** for unified candidate generation (single file + batch target). The draft folder flow (`autosnippet_submit_draft_recipes`) is still valid and documented there. This file is kept for backward compatibility only.

⚠️ **CRITICAL**: This skill is for **single file/module scanning** (e.g., "扫描 BDSchemeDispatcher"). 

**DO NOT confuse with batch-scan workflow**:
- ❌ **WRONG**: Use `autosnippet_submit_candidates` for file/module scanning (that is for SPM Target batch scan)
- ✅ **RIGHT**: Create draft folder → one .md per Recipe (not one big file) → call **`autosnippet_submit_draft_recipes`** → **delete the draft folder after submit**

For **SPM Target batch scanning** (multiple targets/files), use **autosnippet-batch-scan** skill instead.

**Recommended**: Create a draft folder (e.g. `.autosnippet-drafts`), one .md per Recipe—do not use one big file. **After submitting candidates, delete the draft folder** (use `deleteAfterSubmit: true` or `rm -rf .autosnippet-drafts`). Recipe candidates can be intro-only (no code); those do not generate a Snippet after approval.

## When to use this skill

- User wants to **scan specific code files/modules** (e.g. "扫描 BDSchemeDispatcher", "分析这个类生成 Recipe 候选")
- User asks for Recipe candidate generation from existing code
- User wants to extract reusable code patterns for the knowledge base
- **Critical**: User should NOT be asking to create files directly in `AutoSnippet/recipes/`

## ❌ Common Mistakes to AVOID

1. **DO NOT create files directly in `AutoSnippet/recipes/`**
   - `AutoSnippet/recipes/` is for FINAL, reviewed Recipes only
   - **WRONG**: Creating `.md` in `AutoSnippet/recipes/` or subdirs
   - **RIGHT**: Create draft folder at project root (e.g. `.autosnippet-drafts/`)

2. **DO NOT use one big file for many Recipes**
   - Prefer draft folder, one .md per Recipe. After submit, **delete the draft folder**.
   - **RIGHT**: `.autosnippet-drafts/pattern-1.md`, `pattern-2.md`, … → call `autosnippet_submit_draft_recipes` → delete draft folder

3. **DO NOT use `autosnippet_submit_candidates` for file/module scanning**
   - `autosnippet_submit_candidates` is for batch-scan (SPM Target) with structured items
   - **RIGHT**: Draft folder + Markdown files + **`autosnippet_submit_draft_recipes`**

4. **DO NOT touch `AutoSnippet/` when generating candidates**
   - Only work with a draft folder outside AutoSnippet; never delete or modify existing Recipe files

## ✅ Correct Flow (4 Steps)

### Step 1: Create Draft Folder (Outside AutoSnippet)

```bash
# Project root, NOT inside AutoSnippet/
mkdir -p .autosnippet-drafts
```

Prefer draft folder with multiple files (not one big file). **After submit, delete the draft folder.**

Suggested names: `.autosnippet-drafts/`, `.recipe-drafts/`, `tmp-recipes/`

### Step 2: Generate Markdown Files (One per Recipe)

When scanning code (e.g. `BDSchemeDispatcher`):

1. **Analyze the code** to identify distinct usage patterns (or pure intro docs).
2. **Create ONE .md file per pattern** in the draft folder:
   ```
   .autosnippet-drafts/
   ├── BDSchemeDispatcher-初始化与分发.md
   ├── BDSchemeDispatcher-插件注册.md
   └── BDSchemeDispatcher-错误处理.md
   ```
3. **Format**: Full Recipe MD (frontmatter with `title`, `trigger`, then `## Snippet / Code Reference` + code block + `## AI Context / Usage Guide`). 
   - **⚠️ USAGE GUIDE FORMAT (CRITICAL)**:
   * **MUST use `###` section headings** — each major section on its own line (e.g. `### 何时用`, `### 关键点`)
   * **MUST use `-` bullet lists and newlines** — never put all content in one continuous line
   * **BAD** (❌): `何时用：场景A；场景B。关键点：要点1；要点2。依赖：…。`
   * **GOOD** (✅):
     ```
     ### 何时用
     - 需要…时
     - 场景…时
     
     ### 关键点
     - 要点1：说明
     - 要点2：说明
     ```
   * See [templates/recipes-setup/README.md](../../templates/recipes-setup/README.md) for detailed format guide & BAD vs GOOD examples
   - Intro-only docs may have no code block (frontmatter + Usage Guide only); those do not generate a Snippet after approval.
4. **One pattern per file**: Each file = ONE specific usage scenario or one intro doc.

### Step 3: Submit via MCP

Call MCP **`autosnippet_submit_draft_recipes`** with the list of file paths:

- `filePaths`: e.g. `[".autosnippet-drafts/pattern-1.md", ".autosnippet-drafts/pattern-2.md", ...]`
- `targetName`: e.g. `BDSchemeDispatcher`
- `source`, `expiresInHours` optional; **`deleteAfterSubmit: true`** to delete submitted files, or delete the draft folder manually after success.

### Step 4: Delete draft folder (required)

**After submit, delete the draft folder.** Use `deleteAfterSubmit: true` when calling `autosnippet_submit_draft_recipes` to remove submitted files, then `rm -rf .autosnippet-drafts` to remove the folder, or remove the folder manually after confirming submission succeeded.

## Workflow Diagram

```
User Request: "扫描 BDSchemeDispatcher 生成候选"
  ↓
Create .autosnippet-drafts/ (outside AutoSnippet/)
  ↓
Analyze code → Generate one .md per pattern (not one big file)
  ↓
.autosnippet-drafts/
├── Pattern1.md
├── Pattern2.md
└── Pattern3.md
  ↓
Call MCP: autosnippet_submit_draft_recipes(filePaths, targetName, ...)
  ↓
Candidates appear in Dashboard → User reviews
  ↓
Approved → AutoSnippet/recipes/ (via Dashboard). Intro-only candidates do not generate Snippet. **Then delete draft folder.**
```

## Key Principles

1. **Draft folder**: Create draft folder, one .md per Recipe (not one big file). **Delete draft folder after submit.**
2. **One .md per pattern**: Each file = one usage scenario or one intro doc; intro-only candidates do not generate Snippet.
3. **MCP**: Use **`autosnippet_submit_draft_recipes`** only (not create_candidates_from_staging; that tool was removed).
4. **Review**: Candidates go through Dashboard **Candidates** before becoming Recipes.

## Related MCP Tools

- **`autosnippet_submit_draft_recipes`**: Submit draft .md files as candidates (recommended: draft folder + multiple files)
- **`autosnippet_submit_candidates`**: Structured items only (for batch-scan workflow)
- **`autosnippet_get_targets`**: For SPM Target batch scanning (different skill)

## Relation to Other Skills

- **autosnippet-batch-scan**: For scanning entire SPM Targets; this skill is for specific files/modules
- **autosnippet-create**: For single Recipe creation via UI; this is for bulk candidate generation
- **autosnippet-when**: Routes to this skill when user wants code-to-candidate generation

## Instructions for the Agent

**CRITICAL WORKFLOW:**

1. **STEP 1: Create draft folder**
   ```bash
   mkdir -p .autosnippet-drafts
   ```
   - Project root, outside `AutoSnippet/`. Prefer one .md per Recipe; do not use one big file.

2. **STEP 2: Generate Markdown files**
   - Analyze the code (or doc need) and identify patterns
   - Create **ONE .md file per pattern** in the draft folder (e.g. `.autosnippet-drafts/ModuleName-Pattern.md`)
   - Full Recipe format: frontmatter + `## Snippet / Code Reference` + `## AI Context / Usage Guide`
   - **⚠️ USAGE GUIDE MUST use structured format (CRITICAL)**:
   * **Use `### Section Heading` for each major section** (not one continuous line)
   * **Use `-` bullet lists** for multi-item sections
   * **Use newlines (`\n`) to separate sections and items** — at least 2 blank lines between major sections
   * **Pattern to follow**:
     ```
     ### 何时用
     - Scenario 1
     - Scenario 2
     
     ### 关键点
     - Key point 1
     - Key point 2
     ```
   * **See templates/recipes-setup/README.md** for detailed examples and BAD vs GOOD comparison
   - Intro-only docs (no code block) do not generate Snippet after approval.

3. **STEP 3: Call MCP**
   - **`autosnippet_submit_draft_recipes`** with `filePaths`, `targetName`, optional `source`, `expiresInHours`, **`deleteAfterSubmit: true`** (or delete folder manually after).

4. **STEP 4: Delete draft folder**
   - **Always delete the draft folder after submit.** Use `deleteAfterSubmit: true` to remove submitted files, then `rm -rf .autosnippet-drafts` (or equivalent), or remove the folder manually once submission succeeded.

**NEVER:**
- ❌ Create files in `AutoSnippet/recipes/`
- ❌ Use `autosnippet_submit_candidates` for file/module scanning (use for batch-scan only)
- ❌ Use one big file for many Recipes (prefer one file per Recipe)
- ❌ Leave the draft folder in place after submit—**always delete it**

**If MCP unavailable**: Tell user to run `asd ui` first.

## Example User Interactions

**Good Request**:
> "扫描 BDSchemeDispatcher，生成 Recipe 候选"

**Agent Response**:
1. Creates `.autosnippet-drafts/` (draft folder first)
2. Analyzes code, generates **one .md per pattern** (not one big file)
3. Calls MCP **`autosnippet_submit_draft_recipes`** with the list of file paths (use `deleteAfterSubmit: true` or delete folder after)
4. **Deletes the draft folder** after submit
5. Tells user to review in Dashboard **Candidates**. Intro-only candidates do not generate Snippet.

**Bad Request** (redirect):
> "Create BDSchemeDispatcher doc in AutoSnippet/recipes/"

**Agent Response**:
"AutoSnippet/recipes/ is for final, reviewed content. Use the candidate flow: create a draft folder, generate one .md per scenario, call autosnippet_submit_draft_recipes, then delete the draft folder after submit."

```
