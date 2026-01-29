# AutoSnippet

基于 SPM 的 iOS 模块 Snippet 与 AI 知识库工具。将模块使用示范写入 Xcode CodeSnippets，支持分类检索、头文件注入，以及基于 AI 的知识沉淀与可视化管理。

[![npm version](https://img.shields.io/npm/v/autosnippet.svg?style=flat-square)](https://www.npmjs.com/package/autosnippet)
[![npm downloads](https://img.shields.io/npm/dm/autosnippet.svg?style=flat-square)](https://www.npmjs.com/package/autosnippet)
[![License](https://img.shields.io/npm/l/autosnippet.svg?style=flat-square)](https://github.com/GxFn/AutoSnippet/blob/main/LICENSE)

---

## 安装

```bash
npm install -g autosnippet
```

## 快速开始

在**项目根目录**执行（需能找到 `AutoSnippetRoot.boxspec.json`，没有会自己创建，关键是首次创建一定要在根目录）：

```bash
# 一键初始化
asd setup

# 启动 Web 管理后台
asd ui
```

浏览器会自动打开 Dashboard，可在 **使用说明** 页查看完整说明。

---

## AI 支持与配置

### 当前支持的 AI

| 提供商 | 默认模型 | 说明 |
|--------|----------|------|
| **Google Gemini** | `gemini-2.0-flash` | 用于 Snippet 提取、摘要、RAG 问答等 |

当前仅支持 **Google Gemini**。`asd create`、`asd ais`、Dashboard 的「按路径/剪贴板创建」与 AI Assistant 均使用该模型。

### 配置指南

**1. 必填：API Key**

在 [Google AI Studio](https://aistudio.google.com/) 申请 API Key，然后通过环境变量传入（勿写入仓库）：

```bash
export ASD_GOOGLE_API_KEY="你的 API Key"
```

或在项目根目录创建 `.env` 文件（已加入 `.gitignore`，勿提交）：

```bash
# .env
ASD_GOOGLE_API_KEY=你的API_Key
```

**2. 可选：模型与提供商**

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `ASD_GOOGLE_API_KEY` | Google Gemini API Key（必填） | — |
| `ASD_AI_PROVIDER` | 提供商，目前仅 `google` | `google` |
| `ASD_AI_MODEL` | 模型名 | `gemini-2.0-flash` |

示例：使用 Pro 模型

```bash
export ASD_AI_MODEL="gemini-1.5-pro"
```

**3. 可选：代理**

若需走代理访问 Google API，可设置：

```bash
export https_proxy="http://127.0.0.1:7890"
# 或
export http_proxy="http://127.0.0.1:7890"
```

---

## Web Dashboard（asd ui）

启动后访问 `http://localhost:3000`，主要能力：

| 页面 | 说明 |
|------|------|
| **Snippets** | 查看、编辑、删除代码片段；同步到 Xcode |
| **Knowledge Base** | 管理 Markdown 技术文档（Skills），与 Snippet 关联 |
| **SPM Explorer** | 按 Target 扫描源码，AI 提取候选；从路径/剪贴板创建知识 |
| **Candidates** | 审核 CLI 批量扫描（`asd ais`）产生的候选，入库或忽略 |
| **AI Assistant** | 基于本地 Snippets/Skills 的 RAG 问答 |
| **使用说明** | 本说明的 Web 版，随 Dashboard 常驻 |

### 新建知识（与 CLI 对齐）

- **按路径**：输入相对路径（如 `Sources/MyMod/Foo.m`）→ 扫描文件，AI 提取标题/摘要/触发键/头文件，审核后保存。
- **按剪贴板**：复制代码后点击「Use Copied Code」→ AI 分析并填充；若由 `// as:create` 打开会带当前文件路径，自动解析头文件。

### 头文件与标记

保存时可勾选「引入头文件」。会写入 `// as:include <TargetName/Header.h> path` 等标记，配合 `asd watch` 在编辑时自动注入 `#import`。

---

## 命令行

### 常用

| 命令 | 说明 |
|------|------|
| `asd ui` | 启动 Web Dashboard |
| `asd create` | 从带 `// as:code` 的文件用 **AI** 提取并创建 Snippet（默认 AI 模式） |
| `asd create --clipboard` | 从剪贴板用 **AI** 创建；可选 `--path 相对路径` 解析头文件 |
| `asd create --no-ai` | 关闭 AI，使用传统交互/预置输入 |
| `asd install` / `asd i` | 将 Snippets 同步到 Xcode |
| `asd ais [Target]` | AI 扫描 SPM Target，结果进 Candidates，在 Dashboard 审核 |
| `asd watch` / `asd w` | 监听源码，执行头文件注入、ALink、`// as:create` 等 |

### create 详解

**AI 模式（默认，与 Web 一致）：**

```bash
# 从文件：选中含 // as:code 的文件，AI 分析代码并带头文件
asd create

# 从剪贴板
asd create --clipboard
asd create -p --path Sources/MyMod/Foo.m   # 带头文件解析
asd create --clipboard --lang swift
```

**传统模式（预置或交互）：**

```bash
asd create --no-ai
asd --preset preset.json create
```

**文件内标记：**

```text
// as:code
UIView *view = [[UIView alloc] init];
// as:code
```

### ai-scan（Candidates）

```bash
asd ais <TargetName>      # 扫描单个 Target
asd ais --all             # 扫描全部
asd ais --batch 5         # 每批 5 个未扫描的 Target
```

结果写入 `Knowledge/.autosnippet/candidates.json`，在 Dashboard **Candidates** 页审核后入库或删除。

### watch 监听

- **头文件注入**：在 Xcode 中选中 Snippet 的 headerVersion，保存后自动在文件头部插入对应 `#import`。
- **ALink**：输入 `#模块键#ALink` 并保存，可打开配置的链接或 README。
- **// as:create**：在源码中写一行 `// as:create`，复制要提炼的代码到剪贴板并保存；watch 会打开 Dashboard 并带当前文件路径，用剪贴板 + 路径创建（自动解析头文件）。

### 标记格式

- ObjC 头文件：`// as:include <ModuleName/Header.h> [相对路径]`
- Swift：`// as:import ModuleName`

---

## 全局选项

- `--preset <path>`：预置输入 JSON（非交互/自动化）。
- `--yes`：非交互；缺必要输入则报错退出。
- 环境变量：`ASD_PRESET` / `ASD_TEST_PRESET` 指定预置路径。

---

## 其他命令

- `asd root`：在项目根创建/更新工作空间，聚合子模块 Snippet。
- `asd init`：在 SPM 模块目录创建模块工作空间。
- `asd setup`：等价于 `init` + `root`。
- `asd share`：共享本地 Snippet。
- `asd u <word> [key] [value]`：按 trigger 更新 Snippet 字段。

---

## 占位符

在 Snippet 代码中使用 `<#placeholder#>`，Xcode 会识别为占位符，用 Tab 切换。多相同占位符可用 ⌥⌘E 连续选择后统一修改。

---

## 贡献

欢迎提交 Issue 与 Pull Request。

## 许可证

MIT，见 [LICENSE](LICENSE)。
