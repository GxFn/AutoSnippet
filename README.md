<div align="center">

# AutoSnippet

**Project Knowledge Engine for iOS / Swift Teams**

将团队的代码模式、最佳实践沉淀为 AI 可检索的知识库，<br>
让 Cursor、Copilot 和 Xcode 都按你的项目规范生成代码。

[![npm version](https://img.shields.io/npm/v/autosnippet.svg?style=flat-square)](https://www.npmjs.com/package/autosnippet)
[![License](https://img.shields.io/npm/l/autosnippet.svg?style=flat-square)](https://github.com/GxFn/AutoSnippet/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen?style=flat-square)](https://nodejs.org)

</div>

---

## 为什么需要 AutoSnippet？

AI 编码助手生成的代码往往脱离项目上下文——不知道团队约定、不了解架构模式、也不遵守代码规范。AutoSnippet 在你的项目中建立一个**活的知识库**，让所有 AI 工具都能检索并遵循团队沉淀的最佳实践。

```
你的项目代码  ──→  AI 扫描提取  ──→  人工审核  ──→  知识库 (Recipe)
                                                        │
                ┌───────────────────────────────────────┘
                ↓
        Cursor / Copilot / Xcode  ──→  按规范生成代码
```

## 核心概念

| 概念 | 说明 |
|------|------|
| **Recipe** | 知识库的基本单元——一段代码模式 + 使用说明 + 元数据，存储在数据库中，可导出为 Markdown 到 `AutoSnippet/recipes/` |
| **Candidate** | 待审核的候选知识——来自 AI 扫描、手动提交或剪贴板，经 Dashboard 人工审核后晋升为 Recipe |
| **Dashboard** | Web 管理后台（`asd ui`），管理 Recipe / Candidate / Guard / 知识图谱等 |
| **Guard** | 代码审查引擎——基于知识库中的规则对代码做合规检查 |
| **Skills** | Cursor Agent 技能文件——告诉 AI 何时、如何使用 AutoSnippet 的能力 |

## 快速开始

```bash
# 1. 全局安装
npm install -g autosnippet

# 2. 在你的项目目录初始化
cd /path/to/your-project
asd setup          # 创建 AutoSnippet/ 目录，配置 VSCode / Cursor

# 3. 安装 IDE 集成（Skills + MCP + Cursor Rules）
asd install:full

# 4. 启动 Dashboard
asd ui             # 启动 Web 后台 + 文件监听 + 语义索引
```

> **注意**：始终在**你的项目目录**中执行 `asd` 命令，而非 AutoSnippet 源码仓库。

## 工作流

### 知识沉淀闭环

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ① 扫描提取                        ② 人工审核             │
│   Cursor AI 扫描 Target ──→ Candidates ──→ Recipe 入库     │
│   asd ais <Target>                Dashboard                 │
│   剪贴板 / 手动提交                                         │
│                                                             │
│   ③ AI 按规范生成                    ④ 持续沉淀             │
│   Cursor/Copilot 检索 Recipe ──→ 生成代码 ──→ 好代码再入库  │
│   MCP 工具 / Xcode Snippet                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 三种使用方式

**① Cursor AI（推荐）**：自然语言驱动，Cursor 通过 13 个 Skills + 34 个 MCP 工具与知识库交互。

```
用户：「扫描 NetworkModule 这个 Target，提取最佳实践」
Cursor → autosnippet_get_targets → autosnippet_get_target_files → 逐文件提取 → autosnippet_submit_candidates
→ Dashboard Candidates 页面审核 → 保存为 Recipe
```

**② Dashboard Web UI**：可视化管理一切——Recipe 编辑器、Candidate 审核、知识图谱、Guard 审查、冷启动向导。

**③ 命令行 CLI**：`asd` 命令覆盖全部操作，适合自动化和脚本集成。

## Dashboard

`asd ui` 启动后访问 Web 管理后台：

![Dashboard](./resources/ASImage01.png)

**主要功能**：

- **Recipes**：浏览、编辑、发布、弃用知识条目；支持代码高亮编辑器
- **Candidates**：审核 AI/手动提交的候选，一键入库或批量操作
- **知识图谱**：可视化 Recipe 之间的关系（依赖 / 扩展 / 冲突等），AI 自动发现关系，按 category 分组布局
- **Guard**：代码合规审查，查看违规记录与修复建议
- **Xcode 模拟器**：在浏览器中模拟 `as:search` / `as:create` / `as:audit` 指令
- **冷启动**：Bootstrap 向导——选择 SPM Target 逐个扫描，AI 提取代码模式生成 Candidate

## IDE 集成

### Cursor（推荐）

AutoSnippet 为 Cursor 提供完整的 MCP + Skills 集成：

- **34 个 MCP 工具**：搜索、Guard 检查、候选提交、知识图谱查询、Bootstrap 等
- **13 个 Agent Skills**：`autosnippet-candidates`、`autosnippet-guard`、`autosnippet-coldstart` 等，引导 AI 正确使用工具
- **写操作 Gateway 保护**：7 个写操作经过权限 / 宪法 / 审计三重检查

```bash
asd install:cursor-skill --mcp  # 安装 Skills + MCP 配置
```

### VSCode Copilot

```bash
asd install:vscode-copilot      # 配置 MCP 和 Copilot 指令
```

### Xcode（深度原生集成）

AutoSnippet 不依赖 Xcode 插件，而是通过 **AppleScript + FileWatcher + Native macOS UI** 实现对 Xcode 的深度原生控制。

#### 保存即触发

FileWatcher（chokidar）监听项目源码目录，在 Xcode 中按 `⌘S` 即可触发指令：

```swift
// as:search networking        ← 保存后自动搜索知识库，弹出原生选择列表
// as:create                   ← 保存后打开 Dashboard 或从剪贴板静默提交候选
// as:audit                    ← 保存后按知识库审查当前文件
```

三层 Save Event Filter 避免误触发：
1. **Self-write 冷却**：AutoSnippet 自身写入的文件在冷却期内忽略
2. **内容哈希去重**：文件内容未变时跳过
3. **Xcode 焦点检测**：Xcode 不在前台时跳过（区分手动保存 vs 切窗口自动保存）

#### AppleScript IDE 自动化

通过 `osascript` 直接驱动 Xcode 编辑器：

| 能力 | 实现 |
|------|------|
| 行号跳转 | `⌘L` → 输入行号 → 回车 |
| 行选中 | `⌘←` 行首 → `⌘⇧→` 选到行尾 |
| 剪切/粘贴 | `⌘X` / `⌘V`，支持选中替换 |
| 前台检测 | 检查 Xcode 是否 running / frontmost |
| 文档保存 | `⌘S` 自动保存活动文档 |

搜索结果插入的完整链路：搜索 → 写入剪贴板 → 跳转到触发行 → 选中原指令 → 粘贴替换。

#### 原生 macOS UI

不依赖终端交互，通过 **Swift 原生二进制**（降级为 AppleScript `choose from list`）弹出系统级 UI：

- **搜索结果列表**：原生弹窗展示匹配 Recipe，键盘选择后自动插入
- **确认对话框**：头文件注入前弹出预览确认
- **系统通知**：操作完成后通过 `display notification` 反馈

#### 智能头文件注入

插入代码片段时自动分析所需 `import`：

1. 检查 SPM 模块可达性（当前 Target 是否已声明依赖）
2. 弹出 NativeUI 确认弹窗，展示待注入的 import 列表
3. 通过 AppleScript 跳转到文件 import 区域，自动插入头文件
4. 若 Xcode 自动化失败，降级到文件级直接写入

#### Code Snippet 触发词

| 触发关键词 | 作用 |
|-----------|------|
| `ass` | 搜索知识库并插入代码（最快捷的联想方式） |
| `asc` | 创建候选——打开 Dashboard 或从剪贴板静默提交 |
| `asa` | 按知识库审查当前代码 |

> 执行 `asd setup` 注册 Snippet 后，需**重启 Xcode** 才生效。

## CLI 命令参考

| 命令 | 说明 |
|------|------|
| `asd setup` | 初始化项目（创建 AutoSnippet/ 目录和配置） |
| `asd ui` | 启动 Dashboard + 文件监听 + 语义索引 |
| `asd status` | 环境自检（项目根、AI、索引、Dashboard 状态） |
| `asd ais [Target]` | AI 扫描 Target → 生成 Candidates |
| `asd search <keyword>` | 搜索知识库（`--copy` 复制 / `--pick` 交互选择） |
| `asd embed` | 手动构建语义向量索引 |
| `asd spm-map` | 刷新 SPM 依赖映射 |
| `asd extract` | 同步 Snippet 到 Xcode |
| `asd sync` | 增量同步 `recipes/*.md` → DB |
| `asd compliance` | 生成宪法合规评估报告 |
| `asd upgrade` | 升级 IDE 集成文件 |
| `asd install:full` | 全量安装（Skills + MCP + Native UI） |

## 配置

### AI Provider

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

```env
ASD_AI_PROVIDER=gemini          # gemini / openai / anthropic
ASD_GOOGLE_API_KEY=your-key     # Gemini API Key
```

### 项目目录结构

```
your-project/
├── AutoSnippet/              # 知识库目录（建议整体作为 Git 子仓库）
│   ├── recipes/              # Recipe Markdown 导出
│   └── .autosnippet/         # 数据库、索引、Guard 配置等
├── .cursor/
│   ├── mcp.json          # MCP 配置（asd setup 自动生成）
│   ├── rules/            # Cursor Rules（asd install 生成）
│   └── skills/           # Agent Skills（asd install 生成）
├── .vscode/
│   └── settings.json     # VSCode MCP 配置
└── .env                  # AI Provider 配置
```

### Git 策略建议

| 路径 | 建议 |
|------|------|
| `AutoSnippet/` | **整体作为 Git 子仓库**——独立权限控制，写权限探针（`git push --dry-run`）在此目录执行，仅知识管理员可 push |
| `AutoSnippet/.autosnippet/context/index/` | 加入 `.gitignore`——体积大、机器相关 |

## 架构概览

```
┌────────────────────────────────────────────────────────┐
│  IDE Layer                                             │
│  Cursor (Skills + MCP) │ VSCode (Copilot) │ Xcode     │
└────────────┬───────────────────┬───────────────────────┘
             │ MCP (stdio)       │ HTTP API
┌────────────┴───────────────────┴───────────────────────┐
│  AutoSnippet Core                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ │
│  │ Gateway  │ │ ChatAgent│ │ Bootstrap│ │ Dashboard │ │
│  │ (权限/   │ │ (ReAct + │ │ (SPM +   │ │ (React +  │ │
│  │  宪法/   │ │  DAG     │ │  AST +   │ │  Vite)    │ │
│  │  审计)   │ │  Pipeline│ │  AI)     │ │           │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘ │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Services: Recipe │ Candidate │ Guard │ Search   │  │
│  │  Knowledge Graph │ SPM │ Indexing │ Compliance   │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Storage: SQLite (better-sqlite3) + 向量索引     │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

## 技术栈

- **Runtime**：Node.js ≥ 20，ESM
- **后端**：Express + better-sqlite3 + MCP SDK
- **前端**：React + TypeScript + Vite + Tailwind CSS
- **AI**：Gemini / OpenAI / Anthropic（通过 AiProvider 抽象层）
- **AST**：Tree-sitter（Swift / ObjC / JS / TS）
- **索引**：语义向量 + BM25 + 关键词三模式搜索

## 贡献

欢迎 [Issue](https://github.com/GxFn/AutoSnippet/issues) 与 [PR](https://github.com/GxFn/AutoSnippet/pulls)。

## License

[MIT](LICENSE)
