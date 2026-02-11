# AutoSnippet

连接开发者、AI 与项目知识库：人工审核沉淀标准，知识库存储 Recipe + Snippet，AI 按规范生成代码。基于 SPM，打通 Xcode 补全与 Cursor 按需检索。

[![npm version](https://img.shields.io/npm/v/autosnippet.svg?style=flat-square)](https://www.npmjs.com/package/autosnippet)
[![License](https://img.shields.io/npm/l/autosnippet.svg?style=flat-square)](https://github.com/GxFn/AutoSnippet/blob/main/LICENSE)

---

### 开发者、AI 与知识库

| 角色 | 职责 | 能力 |
|------|------|------|
| **开发者** | 审核与决策；维护项目标准 | Dashboard 审核 Candidate，保存 Recipe；使用 Snippet 补全、`ass` 快捷联想或 `// as:search` 插入；运行 `asd embed`、`asd ui` |
| **Cursor Agent** | 按规范生成代码；检索与提交 | Skills 理解规范；MCP 按需检索、打开新建 Recipe 页；`autosnippet_submit_candidates` 批量提交候选供人工审核；不直接改 Knowledge |
| **项目内 AI** | 提取、摘要、扫描、审查 | `asd ais` 扫描；Use Copied Code 分析填充；Guard 审查；Dashboard RAG；深度扫描结果可算相似度。由 `.env` 配置 |
| **知识库** | 存储与提供项目标准 | Recipes、Snippets、语义向量索引；Guard、搜索、质量评估、相似度分析；两种 AI 的上下文均依赖此 |

---

## 安装与快速开始

### 1. 安装 AutoSnippet

> **要求**：Node.js ≥ 20

```bash
npm install -g autosnippet
```

### 2. 在你的项目中初始化

**重要**：在**你的项目目录**（不是 AutoSnippet 源码目录）执行：

```bash
cd /path/to/your-project   # 进入你的项目

asd setup                  # 一键初始化
               # ✅ 创建 AutoSnippet/ 目录和配置
               # ✅ 自动配置 VSCode (.vscode/settings.json)
               # ✅ 自动配置 Cursor (.cursor/mcp.json)
               # ✅ 放置 Recipe 模板
```

### 3. 启动 Dashboard

```bash
asd ui                     # 启动 Dashboard + watch
```

`asd ui` 会启动 Web 管理后台并后台 watch；首次运行若前端不存在会自动构建。浏览器会自动打开 Dashboard。

![Dashboard 概览](https://cdn.jsdelivr.net/gh/GxFn/blog-images@main/2026-02-09-autosnippet-manual/20260205232116_66_167.png)


## 核心流程

**智能 AI 优先 → 前端操作 → 命令行补充**

1. **Cursor AI 智能扫描**（推荐）：在 Cursor 中输入自然语言（如「扫描这个 Target」、「批量提取代码候选」），AI 智能触发 `autosnippet-candidates` Skill，通过 MCP 工具 `autosnippet_get_targets` → `autosnippet_get_target_files` → 按文件提取 → `autosnippet_submit_candidates` 一键批量扫描，自动提交候选到 Dashboard Candidates
2. **前端审核与入库**：Dashboard Candidates 页面人工审核 → 保存 Recipe 入库（优先前端操作，无需命令行）
3. **依赖关系**（可选）：Dashboard 刷新自动分析，或使用 `asd spm-map` 命令行更新
4. **语义索引**（自动）：`asd ui` 启动时自动 embed；也可手动 `asd embed`
5. **Cursor 集成**（首次）：`asd install:cursor-skill --mcp`（安装 Skills + Cursor 规则 `.cursor/rules/` + MCP；MCP 工具使用时需 `asd ui` 运行）

### 闭环

**AI 扫描 → Dashboard 审核 → 知识库沉淀 → Cursor/AI 按规范生成 → 再沉淀**：Cursor AI 通过自然语言指令智能扫描并批量提交候选，完整代码通过 Skill 智能提交，开发者也可通过 Dashboard Use Copied Code 或剪切板提交候选，所有候选经 Dashboard 人工审核进入知识库；知识库内 Recipe 为第一公民，拥有最高优先级。

Cursor 在编辑器内通过自然语言交互触发 Skill，使用 MCP 工具检索知识库，用 Recipe 作为生成代码的上下文标准；AI 生成的代码遵循 Recipe 规范，过审后成为新 Recipe，持续提升 AI 的开发标准化程度。

知识库随人工审核持续更新，AI 始终基于最新上下文，Recipe 会在使用中获得评级调整。

## 编辑器内指令

需先运行 `asd watch` 或 `asd ui`。在源码中写入并保存：

| 指令 | 作用 |
|------|------|
| `ass` / `// as:search` [关键词] | 从知识库检索并插入 Recipe/Snippet；`ass` 是最快捷的联想方式，优先推荐 |
| `asc` / `// as:create` | 无选项时只打开 Dashboard（路径已填），由用户点 Scan File 或 Use Copied Code。`-c` 强制用剪切板（静默创建或打开）；`-f` 强制用路径（打开 Dashboard 并自动执行 Scan File） |
| `asa` / `// as:audit` [关键词或规模] | 按知识库 AI 审查；无后缀时仅检查当前文件；后缀 **file** / **target** / **project** 可扩大范围（target=当前 Target 内所有源文件，project=项目内所有源文件）；其他为检索关键词 |
| `// as:include` / `// as:import` | Snippet 内头文件/模块标记，保存时自动注入 |

**Snippet 生效**：`ass`、`asc`、`asa` 是 Xcode Snippet，需要执行 `asd setup` 将其注册到 Xcode 后，**彻底关闭 Xcode 并重启**才能生效。重启后在源码中输入首字母即可触发自动完成菜单。  
**静默候选**：在 Cursor 内用户提出保存案例，Cursor 生成草案；后台用草案静默创建候选，无需打开浏览器，到 Dashboard **Candidates** 页审核即可。在 Xcode 等编辑器内也可写 `asc -c`、复制代码后保存，剪贴板内容同样静默入库。  
**快捷联想**：输入 `ass`（AutoSnippet Search）触发 Snippet 快捷联想，或使用 `// as:search` / `// as:s` 在编辑器内弹窗选择，即选即插，无需跳转 Dashboard，不打断当前编辑。

## 常用命令

| 命令 | 说明 |
|------|------|
| `asd setup` | 初始化项目根（创建 AutoSnippet/AutoSnippet.boxspec.json） |
| `asd ui` | 启动 Dashboard + watch |
| `asd status` | 环境自检（含项目根、AI、索引、Dashboard/Watch、Native UI） |
| `asd create --clipboard` | 从剪贴板创建 Recipe/Snippet |
| `asd candidate` | 从剪贴板创建候选（Dashboard 审核） |
| `asd extract` / `asd e` | 同步 Snippets 到 Xcode |
| `asd ais [Target]` | AI 扫描 Target → Candidates |
| `asd search [keyword] --copy` | 搜索并复制第一条到剪贴板 |
| `asd search [keyword] --pick` | 交互选择后复制/插入 |
| `asd sync` | 增量同步 `recipes/*.md` → DB（.md = Source of Truth） |
| `asd compliance` | 生成宪法合规评估报告（P1-P4 加权评分） |
| `asd upgrade` | 升级 IDE 集成文件（MCP/Skills/Cursor Rules/Copilot） |
| `asd install:cursor-skill --mcp` | 安装 Skills、Cursor 规则（`.cursor/rules/*.mdc`）并配置 MCP。配置时可运行；MCP 工具使用时需 `asd ui` 已启动 |
| `asd install:full` | 全量安装（Skills、MCP、Native UI） |
| `asd embed` | 手动构建语义向量索引（`asd ui` 启动时也会自动执行） |
| `asd spm-map` | 刷新 SPM 依赖映射（依赖关系图数据来源） |

## 配置

- **AI**：项目根 `.env`，参考 `.env.example` 配置 `ASD_GOOGLE_API_KEY` 等。可选 `ASD_AI_PROVIDER`、代理等。
- **Native UI**（可选）：macOS 上 `npm install` 会尝试构建 `resources/native-ui/native-ui`（需本机 Swift）；未构建时回退到 AppleScript/inquirer，功能正常。
- **权限设置**（可选）：写权限探针（在子仓库执行 `git push --dry-run`，通过才允许保存 Recipe/Snippet，否则 403）+ 完整性校验（`asd` 启动前关键文件 SHA-256）。详见 [权限设置说明](docs/权限设置说明.md)。

## 术语

| 术语 | 说明 |
|------|------|
| **Recipe** | `AutoSnippet/recipes/` 下的 Markdown 知识（配方）：含代码块 + 使用说明，供 AI 检索、Guard、搜索，**默认位置，用户可通过 boxspec `knowledgeBase.dir` 配置改成 `Knowledge/` 等**
| **Snippet** | Xcode 代码片段，通过 trigger（默认 `@`）补全，可与 Recipe 关联 |
| **Candidate（候选）** | 待审核入库的项；来自 `as:create`、MCP 提交、`asd ais` 扫描等，经 Dashboard 审核后保存为 Recipe/Snippet |
| **Knowledge（AutoSnippet）** | 项目知识库目录，包含 `recipes/`、`.autosnippet/`（索引、candidates、guard 配置等）；Snippet 配置在 root spec 的 list 中。|
| **Dashboard** | Web 管理后台（`asd ui` 启动），含 Recipes、Candidates、Guard、Snippets 等页面 |
| **watch** | 文件监听进程（`asd ui` 或 `asd watch` 启动），保存时触发 `as:create`、`as:audit`、`as:search` |
| **Guard** | 按 Recipe 知识库对代码做 AI 审查；`// as:audit` 触发 |
| **embed** | 语义向量索引构建；`asd embed` 或 `asd ui` 启动时自动执行，供语义检索与 MCP 使用 |
| **MCP** | Model Context Protocol；Cursor 通过 MCP 调用 31 个工具（7 个写操作经 Gateway 权限保护） |
| **Skills** | Cursor Agent Skills（`.cursor/skills/`），描述何时用、如何用 AutoSnippet 能力 |
| **trigger** | Snippet 触发前缀，默认 `@`，输入后 Xcode 联想补全 |
| **Gateway** | V2 控制平面，统一调度 27 个 Action：validate → permission → constitution → plugin → dispatch → audit |
| **Constitution** | 宪法体系：6 角色、P1-P4 四优先级、能力探测，见 `config/constitution.yaml` |
| **项目根** | 含 `AutoSnippetRoot.boxspec.json` 的目录 |
| **Target** | SPM 模块/编译单元；`asd ais <Target>` 扫描该 Target 下的源码提取候选 |

**详细介绍**：启动 `asd ui` 后访问 Dashboard → **使用说明** 页；

## AutoSnippet 目录与 Git

AutoSnippet 下各路径与版本控制的关系建议如下（可按项目需要调整）：

| 路径 | 说明 | 建议 |
|------|------|------|
| **AutoSnippet/recipes/** | Recipe 的 Markdown 文件 | **Git 子仓库**：单独建远程仓库并 `git submodule add <url> AutoSnippet/recipes`，用于权限拦截（仅能 push 子仓库的人可保存/上传 Recipe）。详见 [权限设置说明](docs/权限设置说明.md) 中「只把 AutoSnippet/recipes 作为子仓库」。 |
| **AutoSnippet/.autosnippet/** | Guard 规则、违反记录、candidates、recipe-stats、context 配置等 | **跟随主仓库 Git**：规则与配置建议提交到主仓库，便于团队共享。 |
| **AutoSnippet/.autosnippet/context/index/** | 语义向量索引（embed 生成） | **不跟随 Git**：体积大、机器相关，建议加入 `.gitignore`（如 `AutoSnippet/.autosnippet/context/index/`）。 |
| **AutoSnippet/.autosnippet/candidates/**（若存在） | 候选数据等 | 视需要：若仅本地缓存可不提交；若团队共享可跟随主仓库或单独子仓库。 |
| **AutoSnippet/AutoSnippet.spmmap.json**（若存在） | SPM 依赖映射 | **跟随主仓库 Git**：便于依赖关系图一致。 |

- **跟随主仓库 Git**：由主项目 `git add/commit/push` 管理，所有人按主仓库权限读写。
- **Git 子仓库**：`AutoSnippet/recipes` 为单独仓库（submodule），Recipe 上传（git push）由 Git 服务端权限拦截。配合 `.env` 中 `ASD_RECIPES_WRITE_DIR=AutoSnippet/recipes` 是为了保识管理员（有 push 权限者）能够正确提交 Recipe：探针目录与 Recipe 写入目录一致，保存后可正常推送。
- **不跟随 Git**：在 `.gitignore` 中忽略，不提交、不推送。

---

## 为什么推荐 Cursor

**Cursor 优先**的原因：

- **MCP & Skills 完整支持**：Cursor 对 MCP（Model Context Protocol）的集成完善，Skills 能够正常触发和运行，支持自然语言指令流畅地调用 `autosnippet_get_targets`、`autosnippet_get_target_files`、`autosnippet_submit_candidates` 等工具
- **候选提交体验流畅**：整个从扫描 → 提取 → 提交的工作流无缝衔接，用户无需手动介入，一键完成批量操作
- **VSCode Copilot 限制**：目前 VSCode Copilot 的 MCP 集成存在问题，无法直接调用 MCP 工具。降级方案是存储候选为 Draft（本地），然后通过 API 提交，增加了用户额外操作步骤

建议优先在 Cursor 中使用 AutoSnippet；如需 VSCode Copilot 支持，欢迎 [Issue](https://github.com/GxFn/AutoSnippet/issues) 讨论降级方案的适配。

---

欢迎 [Issue](https://github.com/GxFn/AutoSnippet/issues) 与 [PR](https://github.com/GxFn/AutoSnippet/pulls)。MIT 许可证。
