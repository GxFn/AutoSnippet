# AutoSnippet V2 API 端点参考

**版本**：v2.0.0  
**基础 URL**：`http://localhost:3000/api`  

---

## 三大对外接口

| 接口 | 协议 | 数量 | 面向 | 入口 |
|------|------|------|------|------|
| **HTTP API** | REST + WebSocket | ~91 端点 | Dashboard / 外部客户端 | `bin/api-server.js` |
| **MCP Tools** | stdio (MCP SDK) | 31 工具 | Cursor / VS Code Copilot Agent | `bin/mcp-server.js` |
| **ChatAgent** | 内部 JS 调用 | 31 工具 + 5 任务 | HTTP 路由 + 内部服务 | `lib/service/chat/ChatAgent.js` |

### Skills（10 个）

Skills 是 Agent 行为的声明式路由层，不执行代码，只告诉 Agent **何时用、怎么用**上面三大接口。

| Skill | 定位 |
|-------|------|
| `autosnippet-intent` | 轻量路由器 — 识别用户意图 → 分发到对应 Skill |
| `autosnippet-concepts` | 教学 — 知识库四大概念 + 31 MCP 工具意图映射 |
| `autosnippet-recipes` | 项目标准上下文提供 — Recipe 模型 + 搜索方式 |
| `autosnippet-candidates` | 候选生成 — 单文件 / 批量 Target 扫描 + V2 字段模型 |
| `autosnippet-coldstart` | 知识库冷启动 — 9 维度全面分析 + languageExtension |
| `autosnippet-analysis` | 深度分析 — 增量 8 维度扫描 + 语义字段补全 |
| `autosnippet-create` | 提交入口 — 四种候选提交路径（草稿 / MCP / Dashboard / 批量文件夹） |
| `autosnippet-guard` | Guard 检查 — 被动 `// as:audit` + 主动 MCP 扫描 |
| `autosnippet-lifecycle` | 生命周期 — Candidate → Draft → Active → Deprecated + Agent 权限边界 |
| `autosnippet-structure` | 项目结构 — SPM 目标 / 文件 / 知识图谱浏览 |

---

## 概览

AutoSnippet HTTP API 共 **~91 个端点**，分布在 13 个路由文件中。

| 路由模块 | 前缀 | 端点数 | 说明 |
|---------|------|--------|------|
| health | `/api/health` | 2 | 服务健康检查 |
| auth | `/api/auth` | 3 | 认证与能力探测 |
| candidates | `/api/candidates` | 14 | Candidate 全生命周期 |
| recipes | `/api/recipes` | 13 | Recipe 管理与发布 |
| guardRules | `/api/guard-rules` | 10 | Guard 规则管理 |
| search | `/api/search` | 7 | 统一搜索 + 图查询 |
| snippets | `/api/snippets` | 6 | Snippet 管理 |
| ai | `/api/ai` | 7 | AI Provider 交互 |
| extract | `/api/extract` | 2 | 代码提取 |
| commands | `/api/commands` | 8 | 系统命令执行 |
| spm | `/api/spm` | 5 | SPM 分析 |
| violations | `/api/violations` | 4 | Guard 违规记录 |
| monitoring | `/api/monitoring` | 9 | 系统监控 |

---

## 1. Health（健康检查）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 基础健康检查 |
| GET | `/api/health/ready` | 就绪检查（含依赖状态） |

## 2. Auth（认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| GET | `/api/auth/probe` | 能力探测（git_write） |

## 3. Candidates（候选管理）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/candidates` | 列表（支持分页、过滤） |
| GET | `/api/candidates/stats` | 统计数据 |
| GET | `/api/candidates/:id` | 获取单个 Candidate |
| POST | `/api/candidates` | 创建 Candidate |
| POST | `/api/candidates/batch` | 批量创建 |
| PUT | `/api/candidates/:id` | 更新 Candidate |
| DELETE | `/api/candidates/:id` | 删除 Candidate |
| POST | `/api/candidates/:id/approve` | 审核通过 |
| POST | `/api/candidates/:id/reject` | 审核拒绝 |
| POST | `/api/candidates/:id/apply-to-recipe` | 应用到 Recipe |
| GET | `/api/candidates/:id/similar` | 查找相似 Candidate |
| POST | `/api/candidates/enrich` | AI 丰富化 Candidate |
| GET | `/api/candidates/search` | 搜索 Candidate |
| GET | `/api/candidates/duplicate-check` | 重复检测 |

## 4. Recipes（知识库管理）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/recipes` | 列表（支持分页、分类过滤） |
| GET | `/api/recipes/stats` | 统计数据 |
| GET | `/api/recipes/:id` | 获取单个 Recipe |
| POST | `/api/recipes` | 创建 Recipe |
| PUT | `/api/recipes/:id` | 更新 Recipe |
| DELETE | `/api/recipes/:id` | 删除 Recipe |
| POST | `/api/recipes/:id/publish` | 发布 Recipe |
| POST | `/api/recipes/:id/deprecate` | 废弃 Recipe |
| POST | `/api/recipes/:id/quality` | 更新质量评分 |
| POST | `/api/recipes/:id/adopt` | 采纳 Recipe |
| POST | `/api/recipes/:id/apply` | 应用 Recipe |
| POST | `/api/recipes/batch-usage` | 批量使用统计 |
| GET | `/api/recipes/search` | 搜索 Recipe |

## 5. Guard Rules（规则管理）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/guard-rules` | 列表 |
| GET | `/api/guard-rules/stats` | 统计数据 |
| GET | `/api/guard-rules/:id` | 获取单个规则 |
| POST | `/api/guard-rules` | 创建规则 |
| PUT | `/api/guard-rules/:id` | 更新规则 |
| DELETE | `/api/guard-rules/:id` | 删除规则 |
| POST | `/api/guard-rules/:id/enable` | 启用规则 |
| POST | `/api/guard-rules/:id/disable` | 禁用规则 |
| POST | `/api/guard-rules/check` | 执行代码检查 |
| POST | `/api/guard-rules/import-from-recipe` | 从 Recipe 导入规则 |

## 6. Search（搜索）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/search` | 统一搜索（BM25 + keyword + semantic） |
| GET | `/api/search/graph/query` | 知识图谱查询 |
| GET | `/api/search/graph/impact` | 影响分析 |
| GET | `/api/search/graph/stats` | 图统计 |
| GET | `/api/search/compliance` | 合规搜索 |
| POST | `/api/search/trigger` | 触发搜索索引刷新 |
| GET | `/api/search/context-aware` | 上下文感知搜索 |

## 7. Snippets（代码片段）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/snippets` | 列表 |
| GET | `/api/snippets/:id` | 获取单个 Snippet |
| POST | `/api/snippets` | 创建 Snippet |
| PUT | `/api/snippets/:id` | 更新 Snippet |
| DELETE | `/api/snippets/:id` | 删除 Snippet |
| POST | `/api/snippets/:id/install` | 安装到 Xcode |

## 8. AI（AI 交互 — 已统一走 ChatAgent）

| 方法 | 路径 | 说明 | 内部实现 |
|------|------|------|----------|
| GET | `/api/ai/config` | 获取当前 AI Provider 配置 | 直接读 container |
| POST | `/api/ai/config` | 切换 AI Provider | `createProvider()` 基础设施 |
| POST | `/api/ai/summarize` | AI 代码摘要 | `chatAgent.executeTool('summarize_code')` |
| POST | `/api/ai/translate` | AI 翻译 | `chatAgent.executeTool('ai_translate')` |
| POST | `/api/ai/chat` | AI 对话（ReAct 循环） | `chatAgent.execute(prompt, {history})` |
| POST | `/api/ai/tool` | 直接执行 ChatAgent 工具 | `chatAgent.executeTool(tool, params)` |
| POST | `/api/ai/task` | 执行预定义多步任务 | `chatAgent.runTask(task, params)` |
| GET | `/api/ai/capabilities` | 查询全部工具 + 任务清单 | `chatAgent.getCapabilities()` |

## 9. Extract（代码提取）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/extract/from-path` | 从文件路径提取代码 |
| POST | `/api/extract/from-text` | 从文本提取代码 |

## 10. Commands（系统命令）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/commands/install` | 安装集成 |
| GET | `/api/commands/spm-map` | SPM 映射 |
| POST | `/api/commands/embed` | 嵌入操作 |
| GET | `/api/commands/status` | 命令状态 |
| GET | `/api/commands/files` | 列出文件 |
| POST | `/api/commands/file` | 文件操作 |
| DELETE | `/api/commands/file` | 删除文件 |
| POST | `/api/commands/execute` | 执行命令 |

## 11. SPM（Swift Package Manager）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/spm/targets` | 列出 Targets |
| GET | `/api/spm/dep-graph` | 获取依赖图 |
| GET | `/api/spm/target-files` | 获取 Target 文件列表 |
| POST | `/api/spm/scan` | 扫描 Target |
| POST | `/api/spm/scan-project` | 扫描整个项目 |

## 12. Violations（违规记录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/violations` | 列出违规记录 |
| GET | `/api/violations/stats` | 违规统计 |
| DELETE | `/api/violations` | 清除违规记录 |
| POST | `/api/violations/generate-rules` | 从违规生成 Guard 规则 |

## 13. Monitoring（系统监控）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/monitoring/health` | 详细健康检查 |
| GET | `/api/monitoring/performance` | 性能指标 |
| GET | `/api/monitoring/errors` | 错误日志 |
| GET | `/api/monitoring/cache` | 缓存状态 |
| GET | `/api/monitoring/realtime` | 实时指标 |
| GET | `/api/monitoring/dashboard` | 监控仪表盘数据 |
| POST | `/api/monitoring/reset` | 重置监控数据 |
| GET | `/api/monitoring/audit` | 审计日志 |
| GET | `/api/monitoring/sessions` | 活跃会话 |

---

## MCP 工具参考（31 个）

### System

| 工具名 | 说明 | Gateway |
|--------|------|---------|
| `autosnippet_health` | 健康检查 | — |
| `autosnippet_capabilities` | 系统能力声明 | — |

### Search

| 工具名 | 说明 | Gateway |
|--------|------|---------|
| `autosnippet_search` | 统一搜索 | — |
| `autosnippet_context_search` | 上下文搜索 | — |
| `autosnippet_keyword_search` | 关键词搜索 | — |
| `autosnippet_semantic_search` | 语义搜索 | — |

### Browse

| 工具名 | 说明 | Gateway |
|--------|------|---------|
| `autosnippet_list_rules` | 列出 Guard 规则 | — |
| `autosnippet_list_patterns` | 列出模式 | — |
| `autosnippet_list_facts` | 列出事实 | — |
| `autosnippet_list_recipes` | 列出 Recipe | — |
| `autosnippet_get_recipe` | 获取单个 Recipe | — |
| `autosnippet_recipe_insights` | Recipe 洞察 | — |
| `autosnippet_compliance_report` | 合规报告 | — |
| `autosnippet_confirm_usage` | 确认使用 | — |

### Structure

| 工具名 | 说明 | Gateway |
|--------|------|---------|
| `autosnippet_get_targets` | 获取 Targets | — |
| `autosnippet_get_target_files` | 获取 Target 文件 | — |
| `autosnippet_get_target_metadata` | 获取 Target 元数据 | — |
| `autosnippet_graph_query` | 图查询 | — |
| `autosnippet_graph_impact` | 影响分析 | — |
| `autosnippet_graph_path` | 路径查找 | — |
| `autosnippet_graph_stats` | 图统计 | — |

### Candidate

| 工具名 | 说明 | Gateway |
|--------|------|---------|
| `autosnippet_validate_candidate` | 验证 Candidate | — |
| `autosnippet_check_duplicate` | 重复检测 | — |
| `autosnippet_submit_candidate` | 提交单个 Candidate | ✅ `candidate:create` |
| `autosnippet_submit_candidates` | 批量提交 Candidate | ✅ `candidate:create` |
| `autosnippet_submit_draft_recipes` | 提交草稿 Recipe | ✅ `recipe:create` |
| `autosnippet_enrich_candidates` | AI 丰富化 | ✅ `candidate:create` |

### Guard

| 工具名 | 说明 | Gateway |
|--------|------|---------|
| `autosnippet_guard_check` | Guard 代码检查 | ✅ `guard_rule:check_code` |
| `autosnippet_guard_audit_files` | Guard 文件审计 | ✅ `guard_rule:check_code` |
| `autosnippet_scan_project` | 项目扫描 | ✅ `guard_rule:check_code` |

### Bootstrap

| 工具名 | 说明 | Gateway |
|--------|------|---------|
| `autosnippet_bootstrap_knowledge` | 知识库引导初始化 | — |

---

## ChatAgent（统一 AI 代理 — 31 工具 + 5 任务）

> **定位**：项目内部的统一 AI 入口。所有业务级 AI 调用均通过 ChatAgent，不再直接使用 AiProvider。  
> **文件**：`lib/service/chat/ChatAgent.js` + `lib/service/chat/tools.js`  
> **执行模式**：ReAct 循环（最多 6 轮迭代）或直接工具调用

### 三种调用方式

| 方式 | 方法 | 适用场景 |
|------|------|----------|
| **ReAct 对话** | `chatAgent.execute(prompt, {history})` | Dashboard Chat，需要多步推理 |
| **直接工具** | `chatAgent.executeTool(name, params)` | HTTP 路由 / 内部服务，确定性调用 |
| **预定义任务** | `chatAgent.runTask(name, params)` | 多步编排任务，Dashboard 一键触发 |

### 31 个 ChatAgent 工具

#### 查询类（8 个）

| 工具名 | 说明 | 必填参数 |
|--------|------|----------|
| `search_recipes` | 搜索 Recipe（BM25 + keyword + semantic） | — |
| `search_candidates` | 搜索/列出候选（按状态/语言/分类筛选） | — |
| `get_recipe_detail` | 获取单个 Recipe 完整详情 | `recipeId` |
| `get_project_stats` | 知识库整体统计（Recipe/Candidate/图谱） | — |
| `search_knowledge` | RAG 语义搜索（向量 + 关键词融合） | `query` |
| `get_related_recipes` | 知识图谱关联查询 | `recipeId` |
| `list_guard_rules` | 列出 Guard 规则（按语言/状态过滤） | — |
| `get_recommendations` | 推荐 Recipe（使用频率 + 质量排序） | — |

#### AI 分析类（4 个）

| 工具名 | 说明 | 必填参数 |
|--------|------|----------|
| `summarize_code` | AI 代码摘要（功能描述 + 关键 API + 使用建议） | `code` |
| `extract_recipes` | 从源码批量提取 Recipe 结构（含 provider fallback） | `targetName`, `files` |
| `enrich_candidate` | AI 语义字段补全（rationale/knowledgeType/complexity/scope/steps/constraints） | `candidateIds` |
| `ai_translate` | AI 翻译（中→英） | — |

#### Guard 安全类（3 个）

| 工具名 | 说明 | 必填参数 |
|--------|------|----------|
| `guard_check_code` | 代码 Guard 检查（内置 + 自定义规则） | `code` |
| `query_violations` | 查询违规历史 + 统计 | — |
| `generate_guard_rule` | AI 生成 Guard 规则（描述 → 正则 + 规则定义） | `description` |

#### 生命周期类（7 个）

| 工具名 | 说明 | 必填参数 |
|--------|------|----------|
| `submit_candidate` | 提交新候选到审核队列 | `code`, `language`, `category` |
| `approve_candidate` | 批准候选（pending → approved） | `candidateId` |
| `reject_candidate` | 驳回候选 + 理由 | `candidateId`, `reason` |
| `publish_recipe` | 发布 Recipe（draft → active） | `recipeId` |
| `deprecate_recipe` | 弃用 Recipe + 原因 | `recipeId`, `reason` |
| `update_recipe` | 更新 Recipe 字段 | `recipeId`, `updates` |
| `record_usage` | 记录 Recipe 使用（adoption / application） | `recipeId` |

#### 质量与反馈类（3 个）

| 工具名 | 说明 | 必填参数 |
|--------|------|----------|
| `quality_score` | 5 维度质量评分（A-F 等级） | `recipeId` |
| `validate_candidate` | 候选校验（必填字段 + 格式 + 质量） | `candidate` |
| `get_feedback_stats` | 用户反馈统计 + 热门 Recipe | — |

#### 知识图谱类（3 个）

| 工具名 | 说明 | 必填参数 |
|--------|------|----------|
| `check_duplicate` | 候选查重（Jaccard 相似度） | `candidate` |
| `discover_relations` | AI 关系发现（requires/extends/enforces/calls） | `recipePairs` |
| `add_graph_edge` | 手动添加关系边 | `fromId`, `toId`, `relation` |

#### 基础设施类（3 个）

| 工具名 | 说明 | 必填参数 |
|--------|------|----------|
| `graph_impact_analysis` | 影响范围分析（下游依赖追溯） | `recipeId` |
| `rebuild_index` | 向量索引重建 | — |
| `query_audit_log` | 审计日志查询 | — |

### 5 个预定义任务

| 任务名 | 说明 | 步骤 |
|--------|------|------|
| `check_and_submit` | 提交前自动查重 + 质量预评 | `check_duplicate` → 相似度 ≥ 0.7 时 AI 二次判断 → 推荐 safe/block/review |
| `discover_all_relations` | 批量发现 Recipe 关系 | 获取全部 Recipe → 两两配对 → 分批（20 对/批）`discover_relations` |
| `full_enrich` | 批量 AI 语义补全 | 列出缺失字段的候选 → `enrich_candidate`（上限 20 条） |
| `quality_audit` | 全量质量审计 | 遍历 active Recipe → `quality_score` → 低于 0.6 标记为低质量 |
| `guard_full_scan` | 完整 Guard 扫描 | `guard_check_code` → 违规项 AI 生成修复建议 |

### ChatAgent 调用来源

> 以下列出所有通过 `chatAgent.executeTool()` / `chatAgent.execute()` / `chatAgent.runTask()` 的调用点。

| 调用方 | 端点 / 方法 | ChatAgent 调用 |
|--------|------------|----------------|
| `routes/ai.js` | `POST /ai/summarize` | `executeTool('summarize_code')` |
| `routes/ai.js` | `POST /ai/translate` | `executeTool('ai_translate')` |
| `routes/ai.js` | `POST /ai/chat` | `execute(prompt, {history})` — ReAct 循环 |
| `routes/ai.js` | `POST /ai/tool` | `executeTool(tool, params)` — 通用工具入口 |
| `routes/ai.js` | `POST /ai/task` | `runTask(task, params)` — 通用任务入口 |
| `routes/violations.js` | `POST /rules/generate` | `executeTool('generate_guard_rule')` |
| `routes/candidates.js` | `POST /enrich` | `executeTool('enrich_candidate')` |
| `routes/candidates.js` | 候选创建后 | `executeTool('check_duplicate')` — 自动查重 |
| `routes/recipes.js` | Recipe 创建后 | `executeTool('discover_relations')` — 异步后台 |
| `routes/recipes.js` | `POST /discover-relations` | `runTask('discover_all_relations')` |
| `SpmService.js` | `scanTarget()` / `scanProject()` | `executeTool('extract_recipes')` + aiFactory 回退 |
| `CreateHandler.js` | `// as:c` 指令处理 | `executeTool('summarize_code')` — AI 摘要回退 |
| `DraftHandler.js` | `_draft_*.md` 保存处理 | `executeTool('summarize_code')` — AI 摘要回退 |

### 遗留直接 AI 调用（基础设施层，不走 ChatAgent）

| 文件 | 调用 | 原因 |
|------|------|------|
| `SearchEngine.js` | `aiProvider.embed()` | 向量操作，非业务 AI |
| `RetrievalFunnel.js` | `aiProvider.embed()` | 向量操作 |
| `IndexingPipeline.js` | `aiProvider.embed()` | 向量操作 |
| `ServiceContainer.js` | DI 初始化层 | 创建/注入 AI Provider 实例 |
| `POST /ai/config` | `createProvider()` | Provider 管理基础设施 |

---

## Skills 详细参考（10 个）

> Skills 是声明式的 Agent 行为指南（`.md` 文件），安装在 IDE 中供 Cursor / Copilot Agent 读取。  
> **位置**：`skills/autosnippet-*/SKILL.md`  
> Skills 不执行代码 — 它们告诉 Agent 何时用什么 MCP 工具、走什么流程。

### 1. autosnippet-intent（路由器）

**职责**：识别用户意图，分发到对应 Skill。所有对话的第一站。

| 用户意图 | 路由到 |
|----------|--------|
| "搜索/查找 Recipe" | autosnippet-recipes |
| "提交候选/添加知识" | autosnippet-create |
| "扫描项目/分析代码" | autosnippet-candidates 或 autosnippet-analysis |
| "初始化知识库/冷启动" | autosnippet-coldstart |
| "Guard 检查/代码审计" | autosnippet-guard |
| "看项目结构/依赖图" | autosnippet-structure |
| "Recipe 发布/弃用" | autosnippet-lifecycle |
| "什么是 Recipe/Candidate" | autosnippet-concepts |

### 2. autosnippet-concepts（概念教学）

**职责**：教 Agent 理解 AutoSnippet 核心概念。

- 知识库四大组成：Snippets / Recipes / Candidates / Context Index（向量库）
- 31 MCP 工具按意图分类映射表
- 统一 JSON Envelope 响应读取指引
- 工具失败回退策略

### 3. autosnippet-recipes（知识库上下文）

**职责**：项目标准上下文提供者 — Agent 编码时应优先查询 Recipe。

- V2 Recipe 模型（kind / knowledgeType / complexity / scope / content / relations / constraints）
- 三种搜索方式：上下文搜索 / `asd search` / MCP 工具
- Agent 权限边界：只读 + 提交候选，不能直接修改 Recipe

### 4. autosnippet-candidates（候选生成）

**职责**：指导 Agent 如何生成高质量候选。

- 单文件扫描 → 提交候选
- 批量 SPM Target 扫描 → 批量提交
- V2 候选字段 7 层模型（Core Identity → Classification → Description → Structured Content → Constraints & Relations → Reasoning → Quality & Source）

### 5. autosnippet-coldstart（冷启动）

**职责**：首次接入项目时从零建立知识库。

- Phase 0：`bootstrap_knowledge` 获取项目结构化数据
- Phase 1：架构分析（全局视角，3-8 条)
- Phase 2：逐 Target 8 维度代码分析
- Phase 3：项目技术特征汇总
- Phase 4：Agent 开发注意事项提取
- Phase 5：批量提交（预期 70-150 条候选）
- 语言特有扩展（extraDimensions / typicalPatterns / antiPatterns / agentCautions）

### 6. autosnippet-analysis（深度分析）

**职责**：已有知识库后的增量分析 + 语义字段补全。

- Capability 1：全项目增量扫描（8 维度：架构/代码模式/规范/最佳实践/调用链/数据流/依赖/Bug）
- Capability 2：语义字段补全（rationale / knowledgeType / complexity / scope / steps / constraints）
- Capability 3：候选 → Recipe 查漏补缺（发布前检查清单）

### 7. autosnippet-create（提交入口）

**职责**：4 种候选提交路径指南。

| 路径 | 方式 |
|------|------|
| 草稿文件 | 写 `_draft_recipe.md` → FileWatcher 自动检测 |
| 批量文件夹 | `.autosnippet-drafts/` → `submit_draft_recipes` |
| MCP 结构化 | `submit_candidate` / `submit_candidates` |
| Dashboard | `open http://localhost:3000/?action=create&source=clipboard` |

### 8. autosnippet-guard（Guard 检查）

**职责**：代码合规检查 — 被动 + 主动两种模式。

- **被动**：`// as:audit` 注释 → FileWatcher → AI 审查
- **主动**：`guard_check`（单代码）/ `guard_audit_files`（多文件）/ `scan_project`（全项目）
- Guard 规则来源 = Recipe 内容本身（kind=rule 作为规则）

### 9. autosnippet-lifecycle（生命周期）

**职责**：Agent 权限边界与 Recipe 生命周期。

```
Candidate → (human approves) → Draft Recipe → (human publishes) → Active → Deprecated
```

- Agent 可做：提交候选、校验候选、搜索 Recipe、记录使用
- Agent 不可做：创建/修改/发布/弃用/删除 Recipe、修改质量评分

### 10. autosnippet-structure（项目结构）

**职责**：SPM 项目结构发现 + 知识图谱浏览。

- 结构发现：`get_targets` / `get_target_files` / `get_target_metadata`
- 图谱浏览：`graph_query` / `graph_impact` / `graph_path` / `graph_stats`
- 依赖文件：`AutoSnippet/AutoSnippet.spmmap.json`
