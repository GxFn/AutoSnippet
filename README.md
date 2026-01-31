# AutoSnippet

连接开发者、AI 与项目知识库：人工审核沉淀标准，知识库存储 Recipe + Snippet，AI 按规范生成代码。基于 SPM，打通 Xcode 补全与 Cursor 按需检索。

[![npm version](https://img.shields.io/npm/v/autosnippet.svg?style=flat-square)](https://www.npmjs.com/package/autosnippet)
[![License](https://img.shields.io/npm/l/autosnippet.svg?style=flat-square)](https://github.com/GxFn/AutoSnippet/blob/main/LICENSE)

---

### 开发者、AI 与知识库

| 角色 | 职责 | 能力 |
|------|------|------|
| **开发者** | 审核与决策；维护项目标准 | 在 Dashboard 审核 Candidate、保存 Recipe；使用 Snippet 补全、`// as:search` 插入；运行 `asd embed`、`asd ui` |
| **Cursor Agent** | 按规范生成代码；检索知识库 | 通过 Skills 理解规范；MCP 按需检索、打开新建 Recipe 页；起草内容供人工审核，不直接改 Knowledge |
| **项目内 AI** | 提取、摘要、扫描、审查 | `asd ais` 扫描；Use Copied Code 分析填充；Guard 审查；Dashboard RAG。由 `.env` 配置 |
| **知识库** | 存储与提供项目标准 | Recipes、Snippets、语义向量索引；Guard、搜索、两种 AI 的上下文均依赖此 |

---

## 安装与快速开始

```bash
npm install -g autosnippet
```

在**项目根目录**执行：

```bash
asd setup      # 初始化
asd ui         # 启动 Dashboard（建议常驻）
```

`asd ui` 会启动 Web 管理后台并后台 watch；首次运行若前端不存在会自动构建。浏览器会自动打开 Dashboard。

![Dashboard 概览](./images/20260131014718_38_167.png)

## 核心流程

1. **组建知识库**：`asd ais <Target>` 或 `asd ais --all` → Dashboard Candidates 审核 → Recipe 入库
2. **依赖关系**：`asd spm-map` 或 Dashboard 刷新
3. **Cursor 集成**：`asd install:cursor-skill --mcp`（安装 Skills + MCP，需 `asd ui` 运行）
4. **语义索引**：`asd ui` 启动时自动 embed；也可手动 `asd embed`

### 闭环

**扫描 → 审核 → 沉淀 → Cursor/AI 使用 → 再沉淀**：项目 AI 通过扫描 target 批量提交候选，Cursor 完成的代码通过 Skill 提交候选，开发者完成的代码通过剪切板提交候选，Dashboard 中的候选经过人工审核进入知识库；知识库内 Recipe 为第一公民，拥有最高优先级。开发者通过 Snippet 获取 Recipe 内容插入编辑器， Cursor 通过 Skills 把 Recipe 产生的 context 当做上下文使用，对向量库进行查询；AI 用知识库产生的代码，过审后添加到知识库，成为了 AI 新的上下文，使得 AI 的开发趋于标准化。

知识库随人工审核持续更新，AI 始终基于最新上下文，Recipe 会在使用中获得评级调整。

## 编辑器内指令

需先运行 `asd watch` 或 `asd ui`。在源码中写入并保存：

| 指令 | 作用 |
|------|------|
| `// as:create` | 剪贴板代码 → 打开 Dashboard 新建 Recipe |
| `// as:guard` [关键词] | 按知识库 AI 审查当前文件，输出到终端 |
| `// as:search` [关键词] | 从知识库检索并插入 Recipe/Snippet |
| `// as:include` / `// as:import` | Snippet 内头文件/模块标记，保存时自动注入 |

## 常用命令

| 命令 | 说明 |
|------|------|
| `asd ui` | 启动 Dashboard + watch |
| `asd create --clipboard` | 从剪贴板创建 Recipe/Snippet |
| `asd install` / `asd i` | 同步 Snippets 到 Xcode |
| `asd ais [Target]` | AI 扫描 Target → Candidates |
| `asd search [keyword]` | 关键词搜索；加 `-m` 语义搜索 |
| `asd install:cursor-skill --mcp` | 安装 Skills 并配置 MCP |
| `asd install:full` | 全量安装；`--parser` 含 Swift 解析器；`--lancedb` 仅 LanceDB |

## 全量安装与可选依赖

克隆或需完整能力时，**任意目录**执行：

```bash
asd install:full           # 核心 + 可选依赖 + Dashboard（前端不存在时构建）
asd install:full --parser  # 上述 + Swift 解析器（ParsePackage，SPM 解析更准确）
asd install:full --lancedb # 仅安装 LanceDB（向量检索更快）
```

**Swift 解析器**：默认回退 `dump-package`；`--parser` 构建 ParsePackage 后 SPM 解析更准确，需本机已装 Swift。

## 配置

- **AI**：项目根 `.env`，设置 `ASD_GOOGLE_API_KEY` 等（见 `.env.example`）。可选 `ASD_AI_PROVIDER`、代理等。
- **LanceDB**：`asd install:full --lancedb`，在 boxspec 的 `context.storage.adapter` 中配置 `"lance"`。

## 术语

- **Recipe**：`Knowledge/recipes/` 下的 Markdown 知识，供 AI 检索、Guard、搜索
- **Snippet**：Xcode 代码片段，通过 trigger（默认 `@`）补全
- **项目根**：含 `AutoSnippetRoot.boxspec.json` 的目录

**详细介绍**：启动 `asd ui` 后访问 Dashboard → **使用说明** 页，可查看完整文档（含 Skills 一览、AI 配置、闭环详解等）。

---

欢迎 [Issue](https://github.com/GxFn/AutoSnippet/issues) 与 [PR](https://github.com/GxFn/AutoSnippet/pulls)。MIT 许可证。
