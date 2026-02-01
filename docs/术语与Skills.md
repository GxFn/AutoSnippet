# AutoSnippet - 术语与网络标准 Skills 关系说明

## 1. 目的

- 为 AutoSnippet 内「模块标准使用代码」**单独定义一个概念名**，与网络上的 **Agent Skills**（如 agentskills.io、Cursor SKILL.md）区分，避免歧义。
- 明确：**先有 AutoSnippet 内这一概念，再根据模块能力与逻辑关系，在需要时制作/导出网络标准的 Skills**。

---

## 2. AutoSnippet 内概念：Recipe（配方）

### 2.1 定义

| 项目 | 说明 |
|------|------|
| **英文名** | **Recipe**（一个单词） |
| **中文名** | **配方** |
| **含义** | 描述**某一模块在项目中的标准使用方式**的一份「配方」：包含可插入的**代码片段（Snippet）**与**使用说明（何时用、依赖、约束）**，供 Xcode 插入、AI 检索与 Guard 审查。 |
| **载体** | 单份 Markdown 文件（YAML Frontmatter + 正文），存放在 `Knowledge/recipes/`。 |
| **与「网络标准 Skills」的区别** | Recipe = **代码片段 + 使用说明**，以「可插入代码」和「项目内检索」为主；网络标准 Skills = **name + description + 工作流指令**，以「Agent 发现与执行」为主。 |

### 2.2 为何选 Recipe（配方）

- **一个单词**：英文 Recipe、中文「配方」，无歧义、易记。
- **语义贴合**：「配方」= 按此操作可得标准结果；模块的「标准使用代码 + 说明」即该模块用法的配方。
- **与 Skill 区分**：Recipe 强调「用法配方」，Skill 强调「Agent 能力/工作流」，二者不同。

---

## 3. Recipe（配方）→ 网络标准 Skills 的逻辑关系

### 3.1 原则

- **主概念在 AutoSnippet 内是 Recipe（配方）**；网络标准 Skills 视为**在具备逻辑关系时的派生产物**。
- **仅在「模块能力能表达为逻辑关系」时**（例如：何时用、步骤、前置条件），再基于 Recipe**制作**符合 Agent Skills 规范的 SKILL.md。

### 3.2 逻辑关系示意

```
┌─────────────────────────────────────────────────────────────────┐
│  AutoSnippet 内：Recipe（配方）                                   │
│  - 载体：Knowledge/recipes/*.md                                 │
│  - 内容：title, trigger, summary, Snippet 代码块, Usage Guide   │
│  - 用途：Xcode 插入、as:search、AI 检索、as:guard               │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 当模块能力可表达为「何时用 + 步骤/工作流」
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  网络标准 Skills（Agent Skills）                                  │
│  - 载体：skill-name/SKILL.md                                     │
│  - 必填：name, description                                        │
│  - 正文：工作流指令、步骤、示例                                   │
│  - 用途：Agent 发现 → 激活 → 执行（如 Cursor @skill-name）       │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 从 Recipe 派生网络标准 Skill 的映射建议

| Recipe（配方） | → | 网络标准 Skill（SKILL.md） |
|----------------|---|---------------------------|
| `title` + `summary` | → | `description`（做什么、何时用） |
| 文件名或 `id` 的 slug | → | `name`（与 Skill 文件夹名一致） |
| 正文「AI Context / Usage Guide」 | → | 正文中的**步骤、何时用、示例** |
| Snippet 代码块 | → | 可放入 `references/` 或正文中的代码示例 |

**条件**：只有当 Recipe 中的「适用场景、约束、步骤」能整理成**明确的工作流或决策逻辑**时，才适合生成一份网络标准 Skill；否则仅保留 Recipe 即可。

---

## 4. 总结

- **AutoSnippet 内**：采用 **Recipe（配方）**，表示「模块的标准使用代码 + 使用说明」，与网络上的「Skills」一词脱钩。
- **网络标准 Skills**：在模块能力能表达为逻辑关系（何时用、步骤）时，**基于 Recipe 再制作**；Recipe 为源，Agent Skill 为派生。
- **文档与实现**：统一用语为「Recipe / 配方」，并在合适处补充「与 Agent Skills 规范的关系」说明。
