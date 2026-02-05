# AutoSnippet Copilot Instructions

## 项目概览
- 项目名称：AutoSnippet
- 目标：通过 Recipe/Snippet/向量检索构建团队知识库与代码复用工作流。
- 项目根：包含 `*.boxspec.json` 的目录（当前仓库为 `AutoSnippet.boxspec.json`）。

## 知识库与结构
- 知识库根目录：`AutoSnippet/`（默认，**用户项目可通过 `boxspec.knowledgeBase.dir` 配置改为 `Knowledge/` 或其他**）
- Recipe：`AutoSnippet/recipes/*.md`（或用户配置的 `{knowledgeBase.dir}/recipes/`）
- Snippet：`AutoSnippet/snippets/*.json` 或 root spec `list`
- Candidates：`AutoSnippet/.autosnippet/candidates.json`
- 向量索引：`AutoSnippet/.autosnippet/context/`（`asd embed` 生成）
- Recipe 统计：`AutoSnippet/.autosnippet/recipe-stats.json`
  - 统计权重：`AutoSnippet/.autosnippet/recipe-stats-weights.json` 或 boxspec `recipes.statsWeights`

## 强制规则（必须遵守）
1. **禁止直接修改** 知识库目录内容（如 `AutoSnippet/recipes/`、`AutoSnippet/snippets/`、`AutoSnippet/.autosnippet/candidates.json`）。
2. 创建或入库必须走 **Dashboard** 或 MCP 流程（如 `autosnippet_open_create`、`autosnippet_submit_candidates`）。
3. **优先使用 Recipe** 作为项目标准；源代码仅作补充。
4. MCP 检索优先：可用 `autosnippet_context_search` 获取语义检索结果。
5. MCP 调用失败时，**不要在同一轮重复重试**，回退到已读文档或静态上下文。
6. Skills 负责语义与流程，MCP 负责能力与调用；不要在 Skill 内硬编码 URL/HTTP。

## Recipe 结构要点
- 必须包含：Frontmatter（`title`、`trigger` 必填）+ `## Snippet / Code Reference` + `## AI Context / Usage Guide`。
- 多段 Recipe 可用「空行 + `---` + 下一段 Frontmatter」分隔。
  - 已是完整 Recipe Markdown 时可直接解析入库，无需 AI 重写。

## 推荐工作流
- 查找：先用 MCP `autosnippet_context_search` 或 Dashboard Search，或在编辑器中使用 `ass` 快捷联想。
- 产出候选：生成结构化候选并提交到 Candidates。
- 采纳与评分：可使用 `autosnippet_confirm_recipe_usage`、`autosnippet_request_recipe_rating`。

## 与 Cursor 规则联动
- 本文件与 `templates/cursor-rules/autosnippet-conventions.mdc` 保持一致，均用于提供 AI 的基础项目认知与必要说明。
- 如有冲突，以 **禁止修改 Knowledge** 与 **Recipe 优先** 原则为准。
