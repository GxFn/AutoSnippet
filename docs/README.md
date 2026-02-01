# AutoSnippet 文档

本目录为项目核心文档与使用说明，可随仓库提交到 GitHub。

## 文档索引

| 文档 | 说明 |
|------|------|
| [使用文档](./使用文档.md) | 安装、常用命令、编辑器内指令、配置、Recipe 格式、Cursor 集成 |
| [术语与 Skills](./术语与Skills.md) | Recipe（配方）与网络标准 Agent Skills 的关系与定义 |
| [权威评分系统与数据格式](./权威评分系统与数据格式.md) | 使用热度、权威分、综合权威分及 recipe-stats 数据格式 |
| [context 配置说明](./context配置说明.md) | 语义索引的 storage、sources、chunking 配置；存储适配器切换（json/lance）；测试覆盖说明 |
| [MCP 配置说明](./MCP配置说明.md) | Cursor MCP 配置与可用工具 |
| [Guard-误报与排除策略](./Guard-误报与排除策略.md) | Guard 规则误报场景、排除策略与 Knowledge 目录说明 |
| [权限设置说明](./权限设置说明.md) | 写权限探针与完整性校验的配置、行为与常见问题 |
| [按场景-语言-模块的个性化推荐-实现计划](./按场景-语言-模块的个性化推荐-实现计划.md) | 按场景/语言/模块的个性化推荐实现计划 |

**规则示例**：iOS 版本规则与违反记录见 Dashboard **Guard** 页，或项目内 `Knowledge/.autosnippet/guard-rules.json`、`guard-violations.json`。

## 快速开始

1. 安装：`npm install -g autosnippet`
2. 在项目根执行：`asd setup` → `asd ui`
3. 详见 [使用文档](./使用文档.md)。
