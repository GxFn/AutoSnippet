# Agent · MCP · Skills — 架构与调用链

> AutoSnippet V2 的 AI 能力层由三大组件构成：**ChatAgent（项目内 AI 中心）**、**MCP Server（外部 Agent 接口）**、**Skills（领域知识文档库）**。本文档全面阐述三者的设计目标、内部结构、协作关系与调用链路。

---

## 1. 设计总览

### 1.1 核心架构原则

```
项目内所有 AI 调用都走 ChatAgent + tool —— 唯一 AI 执行中心
```

这条原则贯穿整个架构设计：

| 层级 | 组件 | 角色 | AI 能力 |
|------|------|------|---------|
| 内部 AI | **ChatAgent** | 项目内唯一 AI 执行中心 | ✅ 拥有 aiProvider，执行所有 AI 推理 |
| 外部接口 | **MCP Server** | 为 IDE AI Agent 暴露工具 | ❌ 自身无 AI，外部 Agent 自带 |
| 知识增强 | **Skills** | 领域操作指南文档 | ❌ 纯静态文档，零 AI 调用 |
| 共享层 | **handlers/*.js** | 底层业务实现 | ❌ 纯启发式 / 数据处理 |

### 1.2 分层架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       消费者 (Consumers)                         │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │ Dashboard UI │   │  HTTP API    │   │ IDE Agent            │ │
│  │ (浏览器)      │   │  (REST)      │   │ (Cursor/Copilot/…)  │ │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬───────────┘ │
│         │                  │                      │             │
│         ▼                  ▼                      ▼             │
│  ┌─────────────────────────────┐      ┌──────────────────────┐  │
│  │       ChatAgent             │      │     MCP Server       │  │
│  │  (ReAct + DAG Pipeline)     │      │  (stdio transport)   │  │
│  │  33 tools via ToolRegistry  │      │  34 tools via TOOLS  │  │
│  │  ✅ 拥有 AI Provider        │      │  ❌ 无 AI Provider    │  │
│  └───────────┬─────────────────┘      └──────────┬───────────┘  │
│              │                                   │              │
│              ▼                                   ▼              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                  共享 Handlers 层                            │ │
│  │  bootstrap.js │ search.js │ candidate.js │ guard.js │ ...  │ │
│  │  ────────── 纯启发式 / 数据处理，零 AI 调用 ──────────────── │ │
│  └───────────────────────────┬─────────────────────────────────┘ │
│                              │                                   │
│              ┌───────────────┼────────────────┐                  │
│              ▼               ▼                ▼                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ SQLite DB    │ │ 向量索引      │ │  Skills (13 SKILL.md)   │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. ChatAgent — 项目内唯一 AI 执行中心

> 源码: `lib/service/chat/ChatAgent.js` (703 行)

### 2.1 三种调用模式

| 模式 | 入口方法 | 调用方 | 特点 |
|------|----------|--------|------|
| **交互式对话** | `execute(prompt, {history})` | Dashboard Chat | ReAct 循环，LLM 自主决定调用工具 |
| **程序化调用** | `executeTool(name, params)` | 内部代码 / DAG 步骤 | 直接执行指定工具，跳过 ReAct |
| **DAG 管线** | `runTask(taskName, params)` | 任何调用方 | TaskPipeline 编排多步骤有序执行 |

### 2.2 ReAct 循环

Dashboard Chat 走 ReAct 模式，最多 6 轮迭代：

```
User Prompt
    │
    ▼
┌──────────────────┐
│ LLM 推理 (Thought) │ ◄─── System Prompt (工具描述 + Skills 清单 + 使用规则)
└────────┬─────────┘
         │
    ┌────┴────┐
    │ Action? │
    └────┬────┘
    Yes  │  No
    │    │    │
    ▼    │    ▼
解析 Action │  返回最终回答
    │    │
    ▼    │
执行 Tool  │
    │    │
    ▼    │
Observation │
    │    │
    ▼    │
再次推理 ──┘
(≤ MAX_ITERATIONS=6)
```

**LLM 调用工具的格式**:

````
```action
{"tool": "tool_name", "params": {"key": "value"}}
```
````

ChatAgent 通过 `#parseAction()` 从 LLM 响应中提取 action JSON，如果没有 action 块则视为最终回答。

### 2.3 System Prompt 与 Skills 感知

ChatAgent 的 system prompt 由 `#buildSystemPrompt()` 动态生成，包含三部分：

1. **工具描述** — 遍历 `ToolRegistry`，列出每个工具的 name / description / parameters
2. **Skills 清单** — 调用 `#listAvailableSkills()` 扫描 `skills/` 目录，解析每个 `SKILL.md` 的 frontmatter 描述，生成表格 + 场景→Skill 推荐映射
3. **使用规则** — 8 条规则，其中 Rule 7 定义了任务→Skill 的强制加载映射：

| 任务场景 | 强制加载 Skill |
|----------|---------------|
| 冷启动/初始化 | `autosnippet-coldstart` |
| 深度分析/扫描 | `autosnippet-analysis` |
| 候选创建/提交 | `autosnippet-candidates` |
| 代码规范/Guard | `autosnippet-guard` |
| 不确定做什么 | `autosnippet-intent` |

### 2.4 DAG 管线 — TaskPipeline

> 源码: `lib/service/chat/TaskPipeline.js` (338 行)

TaskPipeline 是轻量级 DAG 任务编排引擎，核心能力：

- **依赖声明** (`dependsOn`) — 步骤按拓扑排序，同层并行执行
- **参数引用** — 函数式 `(ctx) => value` 或字符串 `'stepName:path'`
- **条件跳过** (`when`) — 运行时决定是否执行某步骤
- **错误策略** — `fail`（中断整个管线）或 `continue`（记录错误，继续其他步骤）
- **重试** — 支持 `retries` + `retryDelay`

**内置管线: `bootstrap_full_pipeline`**

```
                     ┌───────────────────────┐
                     │   Phase 0: bootstrap  │
                     │  (纯启发式, 无 AI)      │
                     │  SPM 扫描 → 依赖图谱    │
                     │  → 9 维度候选创建        │
                     └──────────┬────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                                   ▼
   ┌──────────────────┐              ┌──────────────────────┐
   │ Phase 1: enrich  │              │ Phase 1: loadSkill   │
   │ (AI 结构补齐)     │    并行       │ (加载语言参考 Skill)   │
   │ 补全 category /   │              │ 为 refine 提供        │
   │ trigger / summary │              │ 最佳实践上下文         │
   └────────┬─────────┘              └──────────┬───────────┘
            │                                   │
            └─────────────┬─────────────────────┘
                          ▼
               ┌──────────────────────┐
               │  Phase 2: refine     │
               │  (AI 内容润色)        │
               │  summary 精炼 / 补充  │
               │  insight / relations  │
               │  / confidence / tags  │
               └──────────────────────┘
```

**关键设计**：`bootstrap` 步骤调用共享 handler `bootstrapKnowledge()`，这是纯启发式的（不调 AI）。所有 AI 增强都在 ChatAgent 的 DAG 步骤 `enrich` 和 `refine` 中通过 tool 执行，确保 **AI 调用只走 ChatAgent**。

### 2.5 ChatAgent 工具清单 (33 个)

ChatAgent 通过 `ToolRegistry` 管理 33 个工具，按功能域分组：

| 功能域 | 数量 | 代表工具 |
|--------|------|----------|
| 查询类 | 8 | `search_recipes`, `search_knowledge`, `get_related_recipes` |
| AI 分析类 | 5 | `summarize_code`, `enrich_candidate`, `refine_bootstrap_candidates` |
| Guard 安全类 | 3 | `guard_check_code`, `generate_guard_rule` |
| 生命周期操作类 | 7 | `submit_candidate`, `approve_candidate`, `publish_recipe` |
| 质量与反馈类 | 3 | `quality_score`, `validate_candidate` |
| 知识图谱类 | 3 | `check_duplicate`, `discover_relations`, `add_graph_edge` |
| 基础设施类 | 3 | `graph_impact_analysis`, `rebuild_index`, `query_audit_log` |
| Skills & Bootstrap | 2 | `load_skill`, `bootstrap_knowledge` |

---

## 3. MCP Server — 外部 Agent 接口

> 源码: `lib/external/mcp/McpServer.js` (218 行)

### 3.1 设计定位

MCP (Model Context Protocol) Server 通过 stdio transport 为 IDE AI Agent（Cursor、VS Code Copilot、Claude Desktop 等）暴露工具集。**MCP 自身不拥有 AI 能力**，外部 Agent 自带 AI 并根据工具描述自主决策调用。

```
┌─────────────────────────────────┐
│   IDE AI Agent (Cursor/Copilot) │ ◄── 自带 AI (GPT-4/Claude/…)
│                                 │
│  1. 读取 tool list (34 tools)    │
│  2. 根据用户指令 + tool 描述，    │
│     自主决定调用哪些工具          │
│  3. 解读工具返回值               │
└────────────┬────────────────────┘
             │ stdio (JSON-RPC)
             ▼
┌─────────────────────────────────┐
│         MCP Server              │
│  ┌───────────────────────────┐  │
│  │ _handleToolCall(name,args)│  │
│  │        switch/case        │  │
│  │  → handlers/*.js          │  │
│  └──────────┬────────────────┘  │
│             │                   │
│  ┌──────────▼────────────────┐  │
│  │    Gateway Gating         │  │
│  │  (写操作权限/宪法/审计)     │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

### 3.2 Handler 模块化

MCP Server 采用模块化 handler 设计，8 个处理器模块通过命名空间 import 注册：

| Handler 模块 | 文件 | 职责 |
|-------------|------|------|
| `systemHandlers` | `handlers/system.js` | 健康检查、能力描述 |
| `searchHandlers` | `handlers/search.js` | 统合搜索、上下文检索、关键词、语义 |
| `browseHandlers` | `handlers/browse.js` | 知识浏览（规则/模式/事实/Recipe） |
| `structureHandlers` | `handlers/structure.js` | SPM Target、依赖图谱、知识图谱 |
| `candidateHandlers` | `handlers/candidate.js` | 候选校验、提交、AI 补全 |
| `guardHandlers` | `handlers/guard.js` | Guard 规则检查、文件审计、项目扫描 |
| `bootstrapHandlers` | `handlers/bootstrap.js` | 冷启动知识库初始化、AI 精炼 |
| **`skillHandlers`** | **`handlers/skill.js`** | **Skills 发现 + 加载** |

路由通过 `_handleToolCall()` 中的 `switch/case` 分发到对应 handler。

### 3.3 Gateway Gating

**只有写操作**经过 Gateway 权限检查，读操作直接跳过以保持性能：

```javascript
// tools.js 中的映射
TOOL_GATEWAY_MAP = {
  autosnippet_submit_candidate:    { action: 'candidate:create',    resource: 'candidates' },
  autosnippet_submit_candidates:   { action: 'candidate:create',    resource: 'candidates' },
  autosnippet_submit_draft_recipes:{ action: 'candidate:create',    resource: 'candidates' },
  autosnippet_enrich_candidates:   { action: 'candidate:update',    resource: 'candidates' },
  autosnippet_bootstrap_knowledge: { action: 'knowledge:bootstrap', resource: 'knowledge' },
  autosnippet_bootstrap_refine:    { action: 'candidate:update',    resource: 'candidates' },
  autosnippet_guard_audit_files:   { action: 'guard_rule:check_code', resource: 'guard_rules' },
  autosnippet_scan_project:        { action: 'guard_rule:check_code', resource: 'guard_rules' },
};
```

Gateway 检查流程：`权限验证 → 宪法合规 → 审计记录`。如果 Gateway 未初始化或内部故障，降级放行（系统不因权限组件故障而瘫痪）。

### 3.4 MCP 工具清单 (34 个)

| 编号 | 工具名 | 功能 |
|------|--------|------|
| 1 | `autosnippet_health` | 健康检查 |
| 2 | `autosnippet_search` | 统合搜索 (BM25+semantic) |
| 3 | `autosnippet_guard_check` | Guard 规则检查 |
| 4 | `autosnippet_context_search` | 智能上下文检索 (4 层漏斗) |
| 5 | `autosnippet_list_rules` | 列出 Guard 规则 |
| 6 | `autosnippet_list_patterns` | 列出代码模式 |
| 7 | `autosnippet_list_facts` | 列出事实知识 |
| 8 | `autosnippet_keyword_search` | SQL LIKE 关键词搜索 |
| 9 | `autosnippet_semantic_search` | 向量语义搜索 |
| 10 | `autosnippet_list_recipes` | 列出 Recipe |
| 11 | `autosnippet_get_recipe` | 获取 Recipe 详情 |
| 12 | `autosnippet_recipe_insights` | Recipe 洞察分析 |
| 13 | `autosnippet_compliance_report` | 合规报告 |
| 14 | `autosnippet_confirm_usage` | 确认使用 |
| 15 | `autosnippet_get_targets` | 获取 SPM Targets |
| 16 | `autosnippet_get_target_files` | 获取 Target 文件列表 |
| 17 | `autosnippet_get_target_metadata` | 获取 Target 元数据 |
| 18 | `autosnippet_graph_query` | 知识图谱查询 |
| 19 | `autosnippet_graph_impact` | 变更影响分析 |
| 20 | `autosnippet_graph_path` | 知识路径查找 |
| 21 | `autosnippet_graph_stats` | 图谱统计 |
| 22 | `autosnippet_validate_candidate` | 候选校验 |
| 23 | `autosnippet_check_duplicate` | 查重 |
| 24 | `autosnippet_submit_candidate` | 提交单条候选 |
| 25 | `autosnippet_submit_candidates` | 批量提交候选 |
| 26 | `autosnippet_submit_draft_recipes` | 提交草稿 Recipe |
| 27 | `autosnippet_enrich_candidates` | 候选结构补齐 (诊断模式) |
| 28-29 | `autosnippet_guard_audit_files` / `autosnippet_scan_project` | Guard 文件审计 / 项目扫描 |
| 30 | `autosnippet_capabilities` | 能力列表 |
| 31 | `autosnippet_bootstrap_knowledge` | 冷启动知识库 (纯启发式) |
| 32 | ~~(旧空位)~~ | — |
| 33 | **`autosnippet_list_skills`** | **列出所有 Skills + 场景摘要** |
| 34 | **`autosnippet_load_skill`** | **加载指定 Skill 文档** |
| 35 | `autosnippet_bootstrap_refine` | 候选 AI 精炼 |

---

## 4. Skills — 领域知识文档系统

> 源码: `skills/` 目录，每个 Skill 一个子目录 + `SKILL.md`

### 4.1 设计理念

Skills 是 **Agent 的知识增强文档**（非代码模块），指导 Agent 如何高质量地完成特定领域任务。Skills 解决的核心问题：

- **LLM 不知道 AutoSnippet 的领域规范** — Skills 提供具体的操作指南和质量标准
- **不同任务需要不同专业知识** — 按需加载，避免 Token 浪费
- **跨消费者一致性** — ChatAgent 和 MCP 外部 Agent 共享同一套 Skills

### 4.2 Skill 清单 (13 个)

| Skill 名称 | 适用场景 |
|------------|---------|
| `autosnippet-intent` | 意图路由 — 不确定该用哪个 Skill 时先加载此 Skill |
| `autosnippet-coldstart` | 冷启动 / 初始化知识库的完整 9 维度分析指南 |
| `autosnippet-analysis` | 深度项目分析 — 扫描 + 语义补齐 + 缺口填充 |
| `autosnippet-candidates` | 生成/提交高质量候选（V2 全字段结构化） |
| `autosnippet-create` | 将代码提交到知识库（Dashboard 入口） |
| `autosnippet-guard` | 代码规范审计（Guard 规则检查） |
| `autosnippet-recipes` | 项目标准查询（Recipe 上下文检索） |
| `autosnippet-structure` | 项目结构分析（SPM Target / 依赖图谱） |
| `autosnippet-concepts` | AutoSnippet 核心概念学习 |
| `autosnippet-lifecycle` | Recipe 生命周期与 Agent 权限边界 |
| `autosnippet-reference-swift` | Swift 语言最佳实践参考 |
| `autosnippet-reference-objc` | Objective-C 语言最佳实践参考 |
| `autosnippet-reference-jsts` | JavaScript/TypeScript 语言最佳实践参考 |

### 4.3 Skill 文档结构

每个 Skill 的 `SKILL.md` 遵循统一结构：

```markdown
---
name: autosnippet-coldstart
description: 冷启动全流程指南
---

# Skill 名称

## 概述
操作指南的总体描述...

## 具体操作步骤
1. ...
2. ...

## 质量标准
- ...

## 注意事项
- ...
```

### 4.4 Skills 关系图谱

Skills 之间存在静态的关联推荐映射，加载一个 Skill 时会返回相关 Skill 推荐：

```
                 autosnippet-intent
                  (意图路由入口)
                       │
         ┌─────────────┼──────────────────┐
         ▼             ▼                  ▼
  ┌──────────┐  ┌────────────┐   ┌──────────────┐
  │ coldstart│  │  analysis  │   │  candidates  │
  │ (冷启动)  │  │  (项目分析) │   │ (候选生成)    │
  └──┬───┬───┘  └──┬─────┬──┘   └──┬──────┬───┘
     │   │         │     │         │      │
     │   ▼         ▼     │         ▼      ▼
     │ structure  candidates      create  lifecycle
     │   │                               │
     ▼   ▼                               ▼
  reference-{swift,objc,jsts}         concepts
                                        │
                                        ▼
                                     recipes ◄──► guard
```

---

## 5. Skills 的三条消费路径

### 5.1 路径一: ChatAgent 消费 Skills

```
ChatAgent System Prompt
    │
    ├── #listAvailableSkills()       ← 扫描 skills/ 目录，解析 SKILL.md frontmatter
    │   返回 [{name, summary}]          嵌入系统提示词表格 + 场景推荐
    │
    └── Rule 7 (强制加载规则)          ← LLM 在特定场景必须先调 load_skill
         │
         ▼
    load_skill 工具 (ChatAgent ToolRegistry)
         │
         ▼
    读取 skills/{name}/SKILL.md
         │
         ▼
    返回 { skillName, content }     ← LLM 获得领域指南，用于后续推理
```

**特点**：
- ChatAgent 构建 system prompt 时自动嵌入 Skills 概览表格
- LLM 根据 Rule 7 和场景→Skill 推荐主动调用 `load_skill`
- 在 DAG 管线中，`loadSkill` 步骤也通过 `executeTool('load_skill', ...)` 消费

### 5.2 路径二: MCP 外部 Agent 消费 Skills

```
IDE AI Agent (Cursor/Copilot/Claude)
    │
    ├── autosnippet_list_skills      ← 发现所有 Skills 及场景摘要
    │   返回 [{name, summary, useCase}]
    │
    └── autosnippet_load_skill       ← 按需加载指定 Skill 完整文档
         │
         ▼
    handlers/skill.js
         │
         ├── listSkills()             ← 扫描 skills/ 目录 + _parseSkillSummary()
         │   返回 SKILL_USE_CASES 映射
         │
         └── loadSkill(ctx, args)     ← 读取 SKILL.md + section 过滤
             返回 { content, useCase, relatedSkills }
```

**特点**：
- 外部 Agent 可先调 `list_skills` 了解能力全景
- `load_skill` 返回 `relatedSkills` 推荐，引导深度探索
- 支持 `section` 参数只加载特定章节，节省 Token
- 工具描述中内置 7 个核心 Skill 推荐，引导外部 Agent 使用

### 5.3 路径三: Bootstrap 冷启动中的 Skills 增强

```
bootstrapKnowledge(ctx, args)
    │
    ├── args.loadSkills ?? true       ← 默认开启 Skill 增强
    │
    └── _loadSkillDimensions()        ← 读取 coldstart + 语言参考 Skill
         │
         ├── autosnippet-coldstart/SKILL.md    → 增强 9 维度的 guide 定义
         │
         └── autosnippet-reference-{lang}/     → 增强语言特定的最佳实践维度
              SKILL.md
         │
         ▼
    合并到 analysisFramework.dimensions
    每个维度增加 skillGuide 字段
```

**特点**：
- 在 bootstrap 阶段（Phase 2）自动加载 Skills 增强维度定义
- 不涉及 AI 调用（Skills 是静态文档）
- 增强后的维度 `guide` 指导启发式候选生成的质量
- 此路径被 ChatAgent 和 MCP 共享（通过共享 handler `bootstrapKnowledge()`）

---

## 6. 完整调用链示例

### 6.1 场景: Dashboard 用户发起冷启动

```
用户: "帮我初始化这个 Swift 项目的知识库"
 │
 ▼
ChatAgent.execute(prompt, {history})
 │
 ▼ (ReAct 循环)
LLM 推理 → 匹配 Rule 7 (冷启动 → autosnippet-coldstart)
 │
 ▼ (Iteration 1)
Action: load_skill("autosnippet-coldstart")
 │
 ▼
ToolRegistry.execute('load_skill', {skillName: 'autosnippet-coldstart'})
 │
 ▼
读取 skills/autosnippet-coldstart/SKILL.md → 返回 9 维度分析指南
 │
 ▼ (Iteration 2)
LLM 获得冷启动指南，决定调用 bootstrap_knowledge
Action: bootstrap_knowledge({maxFiles: 500, loadSkills: true})
 │
 ▼
ToolRegistry.execute('bootstrap_knowledge', ...)
 │
 ▼
bootstrapKnowledge(ctx, args)  ← 共享 handler, 纯启发式
 │
 ├── SPM Target 扫描
 ├── 依赖图谱构建
 ├── Skills 增强维度定义 (Phase 2)
 ├── 代码文件分析 (Phase 3)
 ├── 候选生成 (Phase 4)
 └── 返回 {filesByTarget, dependencyGraph, bootstrapCandidates, analysisFramework}
 │
 ▼ (Iteration 3)
LLM 看到候选列表，决定进一步补全
Action: enrich_candidate({candidateIds: [...]})
 │
 ▼
...（后续 enrich → refine 循环）
```

### 6.2 场景: Cursor Agent 通过 MCP 冷启动

```
Cursor Agent (外部 AI, 自带 GPT-4/Claude)
 │
 ▼
MCP: autosnippet_list_skills()                  ← Step 0: 发现 Skills
 │
 ▼
MCP: autosnippet_load_skill("autosnippet-coldstart")   ← Step 1: 加载冷启动指南
 │
 ▼
MCP: autosnippet_bootstrap_knowledge({loadSkills: true}) ← Step 2: 执行冷启动
 │
 ▼
    Gateway Gating → bootstrapHandlers.bootstrapKnowledge(ctx, args)
 │
 ▼
MCP: autosnippet_enrich_candidates({candidateIds: [...]})  ← Step 3: 结构补齐
 │
 ▼
    Gateway Gating → candidateHandlers.enrichCandidates(ctx, args)
 │
 ▼
Cursor Agent 根据 missingFields 自行用 AI 补全字段            ← 外部 Agent 自有 AI
 │
 ▼
MCP: autosnippet_submit_candidates([...])      ← Step 4: 更新候选
 │
 ▼
MCP: autosnippet_bootstrap_refine(...)         ← Step 5: AI 润色（使用项目内 AI）
```

**核心差异**：MCP 路径中，**步骤之间的编排由外部 Agent 自主决策**（不是 ChatAgent 的 ReAct/DAG），外部 Agent 自带 AI 能力做推理。项目内 AI（如 `bootstrap_refine`）仅在需要使用项目内 aiProvider 时被调用。

### 6.3 场景: DAG 管线自动化冷启动

```
ChatAgent.runTask('bootstrap_full_pipeline', {maxFiles: 500})
 │
 ▼
TaskPipeline.execute(executor, inputs)
 │
 ▼ Phase 0 (拓扑层 0)
 bootstrap_knowledge({loadSkills: true, maxFiles: 500})
     → bootstrapKnowledge(ctx, args) [共享 handler, 纯启发式]
     → 产出: bootstrapCandidates.ids, skillsLoaded
 │
 ▼ Phase 1 (拓扑层 1, 并行)
 ┌─── enrich_candidate({candidateIds: ctx._results.bootstrap.bootstrapCandidates.ids})
 │    when: ids.length > 0
 │
 └─── load_skill({skillName: 'autosnippet-reference-swift'})  // 或 coldstart
      when: autoRefine !== false && hasAI
 │
 ▼ Phase 2 (拓扑层 2)
 refine_bootstrap_candidates({userPrompt: 基于 Skill 内容构造})
     when: bootstrapCandidates.created > 0 && hasAI
     dependsOn: [enrich, loadSkill]
```

---

## 7. ChatAgent 与 MCP 的关键差异

| 维度 | ChatAgent | MCP Server |
|------|-----------|------------|
| **AI 能力** | ✅ 拥有 aiProvider | ❌ 自身无 AI |
| **调用决策** | LLM ReAct 自主推理 / DAG 编排 | 外部 Agent 自主编排 |
| **工具注册** | ToolRegistry (33 个) | TOOLS array + switch/case (34 个) |
| **Skills 呈现** | System prompt 内嵌表格 + 场景推荐 | 独立工具 (list_skills + load_skill) |
| **Gateway** | 无 (项目内信任) | 写操作 gating |
| **传输方式** | 内存直调 | stdio JSON-RPC |
| **适用场景** | Dashboard Chat / HTTP API / 程序化 | IDE Agent (Cursor/Copilot/Claude) |

### 工具命名差异

ChatAgent 与 MCP 采用不同的命名风格：

| ChatAgent 工具 | MCP 工具 | 共享 Handler |
|---------------|----------|-------------|
| `load_skill` | `autosnippet_load_skill` | `handlers/skill.js` |
| `bootstrap_knowledge` | `autosnippet_bootstrap_knowledge` | `handlers/bootstrap.js` |
| `search_recipes` | `autosnippet_search` | `handlers/search.js` |

MCP 工具使用 `autosnippet_` 前缀，遵循 MCP 规范中的命名空间约定，避免与其他 MCP server 的工具冲突。

---

## 8. handlers/skill.js — Skills Handler 实现详解

> 源码: `lib/external/mcp/handlers/skill.js` (188 行)

### 8.1 架构定位

Skills Handler 是 **纯只读文件操作**，不涉及 AI 调用、不涉及数据库、不需要 Gateway gating。它在 handler 层级中是最轻量的模块。

### 8.2 核心组件

```javascript
// 1. 摘要解析器 — 从 SKILL.md frontmatter 提取 description
_parseSkillSummary(skillName)
  → 正则匹配 /^description:\s*(.+?)$/m
  → 截断到第一句或 120 字符

// 2. 场景映射表 — 静态定义 13 个 Skill 的适用场景
SKILL_USE_CASES = {
  'autosnippet-intent': '不确定该用哪个能力时...',
  'autosnippet-coldstart': '冷启动/初始化知识库...',
  ...
}

// 3. 相关 Skill 推荐 — 静态关系图谱
_getRelatedSkills(skillName)
  → 返回 2-3 个关联 Skill 名称数组

// 4. listSkills() — 扫描 skills/ 目录，汇聚 name + summary + useCase
// 5. loadSkill(ctx, args) — 读取 SKILL.md，支持 section 过滤
```

### 8.3 Section 过滤

`loadSkill` 支持 `section` 参数，通过正则匹配 `## 标题` 只返回特定章节，显著减少 Token 消耗：

```javascript
// 请求
{ skillName: 'autosnippet-coldstart', section: '质量标准' }

// 正则
/^##\s+.*质量标准.*$\n([\s\S]*?)(?=^##\s|$)/mi

// 只返回匹配的章节内容，而非整个 SKILL.md
```

### 8.4 容错设计

- **Skill 不存在**：返回 `SKILL_NOT_FOUND` 错误 + 所有可用 Skill 名称列表，帮助 Agent 自动修正
- **Skills 目录不可读**：返回 `SKILLS_READ_ERROR`，不影响其他工具运行
- **SKILL.md 解析失败**：降级返回 Skill 目录名作为 summary

---

## 9. 数据流总结

```
               ┌────────────────────────────────────────────────────┐
               │                   Skills 数据流                     │
               │                                                    │
               │  skills/autosnippet-*/SKILL.md  (13 个静态文档)      │
               │            │                                       │
               │    ┌───────┼───────────────────────┐               │
               │    │       │                       │               │
               │    ▼       ▼                       ▼               │
               │ ChatAgent  MCP handlers/skill.js   bootstrap.js    │
               │ #listAvailableSkills()  listSkills()  _loadSkillDimensions()
               │ → system prompt       → JSON envelope  → analysisFramework
               │ #load_skill tool      loadSkill()     .dimensions[].skillGuide
               │ → ReAct observation   → JSON envelope              │
               │    │       │                       │               │
               │    ▼       ▼                       ▼               │
               │  LLM 推理增强  外部 Agent 决策增强    候选质量增强     │
               └────────────────────────────────────────────────────┘
```

---

## 10. 扩展指南

### 10.1 新增一个 Skill

1. 在 `skills/` 下创建目录 `autosnippet-{name}/`
2. 编写 `SKILL.md`，确保包含 frontmatter `description` 字段
3. 在 `handlers/skill.js` 的 `SKILL_USE_CASES` 中添加场景描述
4. 在 `_getRelatedSkills()` 中维护关联关系
5. ChatAgent 的 `#listAvailableSkills()` 和 MCP 的 `listSkills()` 会自动发现新 Skill

### 10.2 新增一个 MCP 工具

1. 在 `tools.js` 的 `TOOLS` 数组中添加工具 Schema（name、description、inputSchema）
2. 在对应 `handlers/*.js` 中实现 handler 函数
3. 在 `McpServer.js` 的 `_handleToolCall()` switch 中添加路由
4. 写操作需在 `TOOL_GATEWAY_MAP` 中注册 Gateway action
5. 更新 McpServer.js 和 tools.js 顶部注释中的工具数量

### 10.3 新增一个 ChatAgent 工具

1. 在 `lib/service/chat/tools.js` 中定义工具对象 `{name, description, parameters, handler}`
2. 添加到 `ALL_TOOLS` 数组导出
3. ToolRegistry 会在初始化时自动注册
4. ChatAgent System Prompt 会自动包含新工具的描述

### 10.4 新增一个 DAG 管线

```javascript
chatAgent.registerPipeline(new TaskPipeline('my_pipeline', [
  { name: 'step1', tool: 'tool_a', params: { ... } },
  { name: 'step2', tool: 'tool_b', dependsOn: ['step1'],
    params: { data: (ctx) => ctx._results.step1.output } },
  { name: 'step3', tool: 'tool_c', dependsOn: ['step2'],
    when: (ctx) => ctx._results.step2.shouldContinue,
    errorStrategy: 'continue' },
]));
```

---

## 附录 A: 文件索引

| 文件 | 行数 | 角色 |
|------|------|------|
| `lib/service/chat/ChatAgent.js` | 703 | 项目内 AI 中心 (ReAct + DAG) |
| `lib/service/chat/TaskPipeline.js` | 338 | DAG 任务编排引擎 |
| `lib/service/chat/tools.js` | 1176 | ChatAgent 工具定义 (33 个) |
| `lib/external/mcp/McpServer.js` | 218 | MCP Server 主入口 |
| `lib/external/mcp/tools.js` | 647 | MCP 工具 Schema (34 个) |
| `lib/external/mcp/handlers/skill.js` | 188 | Skills Handler (list + load) |
| `lib/external/mcp/handlers/bootstrap.js` | 1596 | 冷启动 Handler |
| `lib/external/mcp/handlers/search.js` | — | 搜索 Handler |
| `lib/external/mcp/handlers/candidate.js` | — | 候选 Handler |
| `lib/external/mcp/handlers/guard.js` | — | Guard Handler |
| `lib/external/mcp/handlers/browse.js` | — | 知识浏览 Handler |
| `lib/external/mcp/handlers/structure.js` | — | 结构 Handler |
| `lib/external/mcp/handlers/system.js` | — | 系统 Handler |
| `skills/autosnippet-*/SKILL.md` | — | 13 个领域知识文档 |
