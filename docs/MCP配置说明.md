# MCP 配置说明

Cursor 通过 MCP（Model Context Protocol）调用 AutoSnippet 知识库与 Dashboard API。本文说明如何配置 MCP 以及当前提供的工具。

---

## 前置条件

- **asd ui 已运行**：MCP 工具通过 HTTP 访问本地 Dashboard（默认 `http://localhost:3000`），需先在项目根执行 `asd ui`。
- **Cursor 支持 MCP**：在 Cursor 设置中配置 MCP 服务器（见下文）。
- 部分工具（如采纳表单、打分）需要 Cursor 支持 **MCP Elicitation**（表单/用户确认）。

---

## Cursor 配置

在项目或用户目录下配置 MCP 服务器，例如：

- 项目内：`.cursor/mcp.json`
- 用户级：`~/.cursor/mcp.json`

示例（stdio 模式，由 Cursor 启动 MCP 进程）。可写 `"type": "stdio"` 明确传输方式（部分 Cursor 版本或 UI 会用到；无此字段时通常也能根据 command/args 推断为 stdio）：

```json
{
  "mcpServers": {
    "autosnippet": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/AutoSnippet/scripts/mcp-server.js"],
      "cwd": "/path/to/your/project/root"
    }
  }
}
```

或使用已安装的全局命令（若通过 `npm install -g autosnippet` 安装并配置了 asd 与 mcp-server 路径）：

```json
{
  "mcpServers": {
    "autosnippet": {
      "type": "stdio",
      "command": "node",
      "args": ["<AutoSnippet 安装路径>/scripts/mcp-server.js"],
      "cwd": "<项目根路径>"
    }
  }
}
```

`cwd` 应为含 `AutoSnippet/AutoSnippet.boxspec.json` 的项目根，以便 API 请求正确解析项目路径。  
环境变量 `ASD_UI_URL` 可覆盖 Dashboard 地址（默认 `http://localhost:3000`）。

---

## 可用工具一览

| 工具名 | 说明 |
|--------|------|
| `autosnippet_open_create` | 打开 Dashboard 新建 Recipe 页（Use Copied Code 流程），可选传入 path 用于头文件解析。 |
| `autosnippet_context_search` | 按自然语言查询检索知识库，返回相关 Recipe/文档；仅静默返回，不触发表单。 |
| `autosnippet_get_targets` | 获取项目所有 SPM Target 列表。 |
| `autosnippet_get_target_files` | 获取指定 Target 的源码文件列表，需传入 targetName。 |
| `autosnippet_submit_candidates` | 将结构化候选（targetName + items 数组）批量提交到 Dashboard Candidates，用于批量扫描等。 |
| `autosnippet_submit_draft_recipes` | 将草稿 .md 文件解析并提交为候选。推荐先创建草稿文件夹、每个 Recipe 一个文件，不推荐一个大文件；支持纯介绍文档（无代码），此类不生成 Snippet。可选提交后删除已提交文件。 |
| `autosnippet_confirm_recipe_usage` | 弹出「是否采纳/使用」确认，用户确认后记为人工使用（humanUsageCount +1）；需 Cursor 支持 Elicitation。 |
| `autosnippet_request_recipe_rating` | 向用户请求对某条 Recipe 的权威分（0～5 星），结果写入 recipe-stats；需 Cursor 支持 Elicitation。 |

工具参数与行为以 `scripts/mcp-server.js` 内注册的 `inputSchema` 与描述为准。

---

## 相关文档

- [使用文档](./使用文档.md)：`asd ui`、Dashboard、编辑器内指令与工作流。
- [权威评分系统与数据格式](./权威评分系统与数据格式.md)：human/guard/ai 使用统计与综合权威分。
