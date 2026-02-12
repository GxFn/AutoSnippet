/**
 * MCP 工具定义（31 个）+ Gateway 映射
 *
 * 只包含 JSON Schema 级别的声明，不含任何业务逻辑。
 */

/**
 * MCP 工具 → Gateway action 映射（仅写操作需要 gating）
 * 只读工具不在此映射中，跳过 Gateway 以保持性能
 */
export const TOOL_GATEWAY_MAP = {
  autosnippet_submit_candidate: { action: 'candidate:create', resource: 'candidates' },
  autosnippet_submit_candidates: { action: 'candidate:create', resource: 'candidates' },
  autosnippet_submit_draft_recipes: { action: 'candidate:create', resource: 'candidates' },
  autosnippet_guard_audit_files: { action: 'guard_rule:check_code', resource: 'guard_rules' },
  autosnippet_scan_project: { action: 'guard_rule:check_code', resource: 'guard_rules' },
  autosnippet_enrich_candidates: { action: 'candidate:update', resource: 'candidates' },
  autosnippet_bootstrap_knowledge: { action: 'knowledge:bootstrap', resource: 'knowledge' },
  autosnippet_bootstrap_refine: { action: 'candidate:update', resource: 'candidates' },
};

export const TOOLS = [
  // 1. 健康检查
  {
    name: 'autosnippet_health',
    description: '检查 AutoSnippet V2 服务健康状态与能力概览。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // 2. 统合搜索（auto 模式同时 BM25+semantic 融合去重）
  {
    name: 'autosnippet_search',
    description: '统合搜索入口（推荐首选）。默认 auto 模式同时执行 BM25 + 向量语义搜索并融合去重，也可指定 keyword/bm25/semantic。返回 byKind 分组。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或自然语言查询' },
        kind: { type: 'string', enum: ['all', 'rule', 'pattern', 'fact'], default: 'all', description: '按知识类型过滤' },
        mode: { type: 'string', enum: ['auto', 'keyword', 'bm25', 'semantic'], default: 'auto', description: 'auto=BM25+semantic 融合; keyword=SQL LIKE 精确; bm25=词频排序; semantic=向量语义' },
        limit: { type: 'number', default: 10 },
      },
      required: ['query'],
    },
  },
  // 3. Guard 检查
  {
    name: 'autosnippet_guard_check',
    description: '对代码运行 Guard 规则检查，返回违规列表。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '待检查的源码' },
        language: { type: 'string', description: '语言（objc/swift 等）' },
        filePath: { type: 'string', description: '文件路径（可选，用于语言推断）' },
      },
      required: ['code'],
    },
  },
  // 4. 智能上下文搜索（RetrievalFunnel + SearchEngine 多层检索）
  {
    name: 'autosnippet_context_search',
    description: '智能上下文检索：4 层检索漏斗（倒排索引 + 语义重排 + 多信号加权 + 上下文感知）。返回 byKind 分组结果。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '自然语言查询' },
        limit: { type: 'number', default: 5 },
        sessionId: { type: 'string', description: '会话 ID（连续对话上下文）' },
        userId: { type: 'string', description: '用户 ID（个性化推荐）' },
        language: { type: 'string', description: '当前语言（用于上下文感知重排）' },
        sessionHistory: { type: 'array', items: { type: 'object' }, description: '会话历史（用于 Layer 4 上下文感知重排，可选）' },
      },
      required: ['query'],
    },
  },
  // 5. 列出 Guard 规则
  {
    name: 'autosnippet_list_rules',
    description: '列出知识库中的所有 Guard 规则（kind=rule）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 20 },
        status: { type: 'string', description: '按状态过滤：active/draft/deprecated' },
        language: { type: 'string', description: '按语言过滤' },
        category: { type: 'string', description: '按分类过滤' },
      },
      required: [],
    },
  },
  // 6. 列出可复用模式
  {
    name: 'autosnippet_list_patterns',
    description: '列出知识库中的可复用模式（kind=pattern）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 20 },
        language: { type: 'string' },
        category: { type: 'string' },
      },
      required: [],
    },
  },
  // 7. SQL LIKE 精确关键词搜索
  {
    name: 'autosnippet_keyword_search',
    description: '精确关键词搜索（SQL LIKE），适合已知函数名、类名、ObjC 方法名等精确字符串检索。比 BM25 更精确但无语义理解。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '精确关键词（类名、方法名、字符串片段）' },
        limit: { type: 'number', default: 10 },
        kind: { type: 'string', enum: ['all', 'rule', 'pattern', 'fact'], default: 'all', description: '按知识类型过滤' },
      },
      required: ['query'],
    },
  },
  // 8. 向量语义搜索
  {
    name: 'autosnippet_semantic_search',
    description: '向量语义搜索（embedding 相似度），适合模糊意图/自然语言描述。需要 vectorStore+aiProvider；不可用时自动降级到 BM25 并标注 degraded。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '自然语言描述（例如"如何处理网络超时重试"）' },
        limit: { type: 'number', default: 10 },
        kind: { type: 'string', enum: ['all', 'rule', 'pattern', 'fact'], default: 'all', description: '按知识类型过滤' },
      },
      required: ['query'],
    },
  },
  // 9. 知识图谱查询
  {
    name: 'autosnippet_graph_query',
    description: '查询知识图谱：获取 Recipe 的所有关系（依赖、扩展、冲突等）。',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID（Recipe ID）' },
        nodeType: { type: 'string', default: 'recipe' },
        relation: { type: 'string', description: '关系类型过滤' },
        direction: { type: 'string', enum: ['out', 'in', 'both'], default: 'both' },
      },
      required: ['nodeId'],
    },
  },
  // 10. 知识影响分析
  {
    name: 'autosnippet_graph_impact',
    description: '影响分析：分析修改某 Recipe 会影响哪些下游依赖。',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
        nodeType: { type: 'string', default: 'recipe' },
        maxDepth: { type: 'number', default: 3 },
      },
      required: ['nodeId'],
    },
  },
  // 11. 知识图谱路径查找
  {
    name: 'autosnippet_graph_path',
    description: '查找两个知识节点之间的关联路径（BFS 最短路径），可发现 Recipe 之间的间接关联。',
    inputSchema: {
      type: 'object',
      properties: {
        fromId: { type: 'string', description: '起始节点 ID（Recipe ID）' },
        toId: { type: 'string', description: '目标节点 ID（Recipe ID）' },
        fromType: { type: 'string', default: 'recipe' },
        toType: { type: 'string', default: 'recipe' },
        maxDepth: { type: 'number', default: 5, description: 'BFS 最大搜索深度（1-10）' },
      },
      required: ['fromId', 'toId'],
    },
  },
  // 12. 知识图谱统计
  {
    name: 'autosnippet_graph_stats',
    description: '获取知识图谱全局统计：边总数、各关系类型分布、节点类型分布。用于了解知识库关联密度。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // 13. 获取 SPM Target 列表（含摘要统计）
  {
    name: 'autosnippet_get_targets',
    description: '获取项目所有 SPM Target 列表。默认附带每个 Target 的文件数、语言统计和推断职责（inferredRole）。使用 includeSummary=false 可仅返回基础列表。',
    inputSchema: {
      type: 'object',
      properties: {
        includeSummary: { type: 'boolean', default: true, description: '是否附带文件数与语言统计摘要（默认 true）' },
      },
      required: [],
    },
  },
  // 14. 获取 Target 源码文件
  {
    name: 'autosnippet_get_target_files',
    description: '获取指定 SPM Target 的源码文件列表。支持 includeContent 返回文件内容（可配合 contentMaxLines 截断）。用于逐 Target 深入分析。',
    inputSchema: {
      type: 'object',
      properties: {
        targetName: { type: 'string', description: 'Target 名称' },
        includeContent: { type: 'boolean', default: false, description: '是否返回文件内容' },
        contentMaxLines: { type: 'number', default: 100, description: '每文件最大返回行数（需 includeContent=true）' },
        maxFiles: { type: 'number', default: 500, description: '最大文件数' },
      },
      required: ['targetName'],
    },
  },
  // 15. 获取 Target 元数据
  {
    name: 'autosnippet_get_target_metadata',
    description: '获取指定 SPM Target 的元数据：依赖列表、Package 信息、推断职责、以及 knowledge_edges 中的图谱关系。',
    inputSchema: {
      type: 'object',
      properties: {
        targetName: { type: 'string', description: 'Target 名称' },
      },
      required: ['targetName'],
    },
  },
  // 16. 候选校验
  {
    name: 'autosnippet_validate_candidate',
    description: '对候选 Recipe 进行结构化预校验（字段完整性、格式、规范性）。检查 5 层：核心必填(title/code)、分类(category/knowledgeType/complexity)、描述文档(trigger/summary/usageGuide)、结构化内容(rationale/headers/steps/codeChanges)、约束与推理(constraints/reasoning)。',
    inputSchema: {
      type: 'object',
      properties: {
        candidate: {
          type: 'object',
          description: '候选结构（完整字段校验）',
          properties: {
            title: { type: 'string', description: '中文简短标题（必填）' },
            code: { type: 'string', description: '代码片段（strict 模式下必填）' },
            language: { type: 'string', description: '编程语言' },
            category: { type: 'string', description: '分类：View/Service/Tool/Model/Network/Storage/UI/Utility' },
            knowledgeType: { type: 'string', description: '知识维度：code-pattern|architecture|best-practice|boundary-constraint 等' },
            complexity: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'], description: '复杂度' },
            scope: { type: 'string', enum: ['universal', 'project-specific', 'target-specific'] },
            tags: { type: 'array', items: { type: 'string' } },
            description: { type: 'string', description: '一句话描述' },
            summary: { type: 'string', description: '详细摘要（Markdown）' },
            trigger: { type: 'string', description: '触发关键词（建议 @ 开头）' },
            usageGuide: { type: 'string', description: '使用指南（Markdown）' },
            rationale: { type: 'string', description: '设计原理/为什么这样做' },
            headers: { type: 'array', items: { type: 'string' }, description: 'import/include 依赖声明' },
            steps: { type: 'array', items: { type: 'object' }, description: '实施步骤 [{title, description, code}]' },
            codeChanges: { type: 'array', items: { type: 'object' }, description: '代码变更 [{file, before, after, explanation}]' },
            constraints: { type: 'object', description: '约束 {boundaries[], preconditions[], sideEffects[], guards[]}' },
            reasoning: {
              type: 'object',
              description: '推理依据（强烈建议提供）：{whyStandard, sources[], confidence}',
              properties: {
                whyStandard: { type: 'string' },
                sources: { type: 'array', items: { type: 'string' } },
                confidence: { type: 'number', description: '0-1' },
              },
            },
          },
        },
        strict: { type: 'boolean', default: false, description: 'strict 模式下 code 为必填' },
      },
      required: ['candidate'],
    },
  },
  // 17. 相似度检测
  {
    name: 'autosnippet_check_duplicate',
    description: '对候选与现有 Recipe 做相似度检测，返回相似条目列表。',
    inputSchema: {
      type: 'object',
      properties: {
        candidate: {
          type: 'object',
          properties: { title: { type: 'string' }, summary: { type: 'string' }, usageGuide: { type: 'string' }, code: { type: 'string' } },
        },
        threshold: { type: 'number', default: 0.7 },
        topK: { type: 'number', default: 5 },
      },
      required: ['candidate'],
    },
  },
  // 18. 单条候选提交（支持结构化 content）
  {
    name: 'autosnippet_submit_candidate',
    description:
      '提交单条代码片段候选供审核。支持 V2 结构化全字段。含限流保护。Agent 必须提供 reasoning（推理依据）。\n' +
      '⚠️ Recipe-Ready 要求：为使候选直接审核通过为 Recipe，请尽量填写以下字段：\n' +
      '  必填: title, code, language, category, trigger(@开头), summary_cn, headers(完整import语句)\n' +
      '  强烈建议: summary_en, usageGuide(Markdown ### 章节), reasoning, knowledgeType, complexity\n' +
      '  推荐: usageGuide_en, rationale, steps, constraints, relations\n' +
      '如字段不全，返回值中 recipeReadyHints 会提示缺失字段，Agent 应据此补全后重新提交或调用 enrich_candidates 查漏。',
    inputSchema: {
      type: 'object',
      properties: {
        // ── 核心（必填）──
        title: { type: 'string', description: '中文简短标题（≤20字）' },
        code: { type: 'string', description: '代码片段（映射到 content.pattern），使用 Xcode 占位符 <#name#>' },
        language: { type: 'string', description: '编程语言：swift / objectivec（必须小写）' },
        // ── 分类 ──
        category: { type: 'string', description: '分类（必填）：View/Service/Tool/Model/Network/Storage/UI/Utility' },
        knowledgeType: { type: 'string', description: '知识维度：code-pattern|architecture|best-practice|code-standard|code-relation|inheritance|call-chain|data-flow|module-dependency|boundary-constraint|code-style|solution' },
        complexity: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
        scope: { type: 'string', enum: ['universal', 'project-specific', 'target-specific'], description: '适用范围' },
        tags: { type: 'array', items: { type: 'string' }, description: '可搜索标签' },
        // ── 描述与文档（双语） ──
        description: { type: 'string', description: '一句话功能描述' },
        summary: { type: 'string', description: '中文详细摘要（等同 summary_cn，Markdown）' },
        summary_cn: { type: 'string', description: '中文摘要（≤100字）。与 summary 二选一' },
        summary_en: { type: 'string', description: '英文摘要（≤100 words）。强烈建议提供，提升检索与 AI 理解' },
        trigger: { type: 'string', description: '触发关键词（必填，@开头，小写，如 @video-cover-cell）' },
        usageGuide: { type: 'string', description: '中文使用指南（等同 usageGuide_cn，Markdown ### 章节格式）' },
        usageGuide_cn: { type: 'string', description: '中文使用指南。与 usageGuide 二选一' },
        usageGuide_en: { type: 'string', description: '英文使用指南（Markdown ### 章节格式）。推荐提供' },
        // ── 结构化内容 ──
        rationale: { type: 'string', description: '设计原理/为什么这样做' },
        steps: { type: 'array', items: { type: 'object' }, description: '实施步骤 [{title, description, code}]' },
        codeChanges: { type: 'array', items: { type: 'object' }, description: '代码变更 [{file, before, after, explanation}]' },
        verification: { type: 'object', description: '验证方式 {method, expectedResult, testCode}' },
        headers: { type: 'array', items: { type: 'string' }, description: '完整 import/include 语句（必填）如 ["#import <Module/Header.h>"] 或 ["import Foundation"]' },
        // ── 约束与关系 ──
        constraints: { type: 'object', description: '约束 {boundaries[], preconditions[], sideEffects[], guards[{pattern,severity,message}]}' },
        relations: { type: 'object', description: '关系 {dependsOn[], extends[], conflicts[], related[], inherits[], implements[], calls[], dataFlow[]}，每项 {target, description}' },
        // ── 质量 & 来源 ──
        quality: { type: 'object', description: '质量评分 {codeCompleteness, projectAdaptation, documentationClarity} (0-1)' },
        sourceFile: { type: 'string', description: '来源文件路径' },
        // ── 推理依据（Reasoning）— 必填 ──
        reasoning: {
          type: 'object',
          description: '推理依据：为什么提取这段代码。Agent 必须填写。',
          properties: {
            whyStandard: { type: 'string', description: '为什么这段代码值得沉淀为知识——如"该模式在项目中被反复使用且新人容易写错"' },
            sources: { type: 'array', items: { type: 'string' }, description: '来源列表：文件路径、文档链接、上下文引用等' },
            confidence: { type: 'number', description: '置信度 0-1，表示 Agent 对这条候选质量的确信程度' },
            qualitySignals: { type: 'object', description: '质量信号 {clarity, reusability, importance} 等自由 KV' },
            alternatives: { type: 'array', items: { type: 'string' }, description: '备选方案描述（如果有替代实现）' },
          },
          required: ['whyStandard', 'sources', 'confidence'],
        },
        source: { type: 'string', description: '来源标识（默认 mcp）' },
        clientId: { type: 'string', description: '客户端标识（用于限流）' },
      },
      required: ['title', 'code', 'language'],
    },
  },
  // 19. 批量候选提交
  {
    name: 'autosnippet_submit_candidates',
    description:
      '批量提交候选到 Candidates，支持去重与限流。每个 item 支持 V2 全字段。返回逐条结果与 recipeReadyHints。\n' +
      '⚠️ Recipe-Ready：请尽量每条填写 category, trigger(@开头), summary_cn, summary_en, headers, reasoning。缺失字段会在 recipeReadyHints 中提示。',
    inputSchema: {
      type: 'object',
      properties: {
        targetName: { type: 'string', description: 'Target 名称' },
        items: {
          type: 'array',
          description: '候选数组，每项字段详见 submit_candidate。尽量填充全部 Recipe-Ready 字段。',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' }, code: { type: 'string' }, language: { type: 'string' },
              category: { type: 'string' }, knowledgeType: { type: 'string' },
              complexity: { type: 'string' }, scope: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              description: { type: 'string' },
              summary: { type: 'string', description: '中文摘要（等同 summary_cn）' },
              summary_cn: { type: 'string', description: '中文摘要' },
              summary_en: { type: 'string', description: '英文摘要（强烈建议）' },
              trigger: { type: 'string', description: '触发词（@开头）' },
              usageGuide: { type: 'string', description: '中文使用指南（等同 usageGuide_cn）' },
              usageGuide_cn: { type: 'string', description: '中文使用指南' },
              usageGuide_en: { type: 'string', description: '英文使用指南' },
              rationale: { type: 'string' },
              steps: { type: 'array', items: { type: 'object' } },
              codeChanges: { type: 'array', items: { type: 'object' } },
              verification: { type: 'object' },
              headers: { type: 'array', items: { type: 'string' }, description: '完整 import 语句' },
              constraints: { type: 'object' }, relations: { type: 'object' },
              quality: { type: 'object' }, sourceFile: { type: 'string' },
              reasoning: { type: 'object', description: '{whyStandard, sources[], confidence}（必填）' },
            },
            required: ['title', 'code', 'language'],
          },
        },
        source: { type: 'string', default: 'cursor-scan' },
        deduplicate: { type: 'boolean', default: true },
        clientId: { type: 'string' },
      },
      required: ['targetName', 'items'],
    },
  },
  // 20. 草稿 Recipe 提交
  {
    name: 'autosnippet_submit_draft_recipes',
    description: '解析草稿 Markdown 文件为 Recipe 候选并提交。支持完整 Recipe 和纯介绍。保留解析出的全部结构化字段（trigger/usageGuide/headers 等）。自动生成默认 reasoning。',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { description: '草稿文件路径（字符串或数组）' },
        targetName: { type: 'string', default: '_draft' },
        source: { type: 'string', default: 'copilot-draft' },
        deleteAfterSubmit: { type: 'boolean', default: false },
        clientId: { type: 'string' },
      },
      required: ['filePaths'],
    },
  },
  // 21. 能力声明
  {
    name: 'autosnippet_capabilities',
    description: '列出所有可用 MCP 工具的概览。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // 22. 列出 Recipes（通用，支持多条件组合过滤）
  {
    name: 'autosnippet_list_recipes',
    description: '列出 Recipe 列表（支持 kind/language/category/knowledgeType/status/complexity/tags 多条件组合过滤）。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'kind 过滤：rule/pattern/fact' },
        language: { type: 'string' },
        category: { type: 'string' },
        knowledgeType: { type: 'string', description: '知识类型过滤' },
        status: { type: 'string', description: '状态过滤：active/draft/deprecated' },
        complexity: { type: 'string', description: '复杂度过滤' },
        limit: { type: 'number', default: 20 },
      },
      required: [],
    },
  },
  // 23. 获取单个 Recipe
  {
    name: 'autosnippet_get_recipe',
    description: '按 ID 获取单个 Recipe 详细信息。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  // 24. 合规报告
  {
    name: 'autosnippet_compliance_report',
    description: '获取合规评估报告，可按时间范围过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['all', 'daily', 'weekly', 'monthly'], default: 'all', description: '评估时间范围' },
      },
      required: [],
    },
  },
  // 25. 确认使用 Recipe
  {
    name: 'autosnippet_confirm_usage',
    description: '确认 Recipe 被采纳或应用，记录使用统计。',
    inputSchema: {
      type: 'object',
      properties: {
        recipeId: { type: 'string', description: 'Recipe ID' },
        usageType: { type: 'string', enum: ['adoption', 'application'], default: 'adoption', description: 'adoption=采纳, application=应用' },
        feedback: { type: 'string', description: '可选反馈' },
      },
      required: ['recipeId'],
    },
  },
  // 26. 列出结构性知识 (kind=fact)
  {
    name: 'autosnippet_list_facts',
    description: '列出知识库中的结构性知识（kind=fact，包括代码关联、继承、调用链、数据流等）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 20 },
        status: { type: 'string', description: '按状态过滤：active/draft/deprecated' },
        language: { type: 'string', description: '按语言过滤' },
        category: { type: 'string', description: '按分类过滤' },
      },
      required: [],
    },
  },
  // 27. Recipe 洞察 (只读聚合)
  {
    name: 'autosnippet_recipe_insights',
    description: '获取指定 Recipe 的质量洞察：质量分数、采纳/应用统计、关联关系摘要、约束条件概览。只读工具，不修改任何数据。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Recipe ID' },
      },
      required: ['id'],
    },
  },
  // 28. 全项目扫描（轻量探查：收集文件 + Guard 审计，不写数据库）
  {
    name: 'autosnippet_scan_project',
    description: '轻量项目探查：收集所有 SPM Target 的源文件列表 + 运行 Guard 规则审计。返回文件清单和 Guard 违规统计。Guard 审计结果会自动记录到 ViolationsStore（Dashboard Guard 页面可见）。' +
      '适用场景：了解项目结构、检查 Guard 状态、快速看一下有多少文件。' +
      '如果要做完整的知识库初始化（冷启动），请使用 autosnippet_bootstrap_knowledge。',
    inputSchema: {
      type: 'object',
      properties: {
        maxFiles: { type: 'number', default: 200, description: '最大文件数（避免超大项目卡死）' },
        includeContent: { type: 'boolean', default: false, description: '是否在结果中包含文件内容（用于 Agent 后续分析）' },
        contentMaxLines: { type: 'number', default: 100, description: '每个文件返回的最大行数（当 includeContent=true）' },
      },
      required: [],
    },
  },
  // 29. Guard 批量审计（多文件）
  {
    name: 'autosnippet_guard_audit_files',
    description: '对多个文件批量运行 Guard 规则审计。传入文件路径列表，返回每个文件的违反详情。结果会自动记录到 ViolationsStore（Dashboard Guard 页面可见）。',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件绝对路径' },
              content: { type: 'string', description: '文件内容（如不提供则从磁盘读取）' },
            },
            required: ['path'],
          },
          description: '待审计的文件列表',
        },
        scope: { type: 'string', enum: ['file', 'target', 'project'], default: 'project', description: '审计范围' },
      },
      required: ['files'],
    },
  },
  // 30. ① 结构补齐：候选字段完整性诊断（不使用内置 AI）
  {
    name: 'autosnippet_enrich_candidates',
    description:
      '① 结构补齐（诊断模式）— 检查候选的字段完整性，返回缺失清单供 Agent 自行补全。\n' +
      '检查两层：\n' +
      '  • Recipe 必填：category、trigger(@开头)、summary_cn、summary_en、headers\n' +
      '  • 语义字段：rationale、knowledgeType、complexity、scope、steps、constraints\n' +
      '不调用内置 AI，仅做诊断。建议在 autosnippet_bootstrap_refine（② 内容润色）之前调用。',
    inputSchema: {
      type: 'object',
      properties: {
        candidateIds: {
          type: 'array',
          items: { type: 'string' },
          description: '要诊断的候选 ID 列表（最多 20 条）',
        },
      },
      required: ['candidateIds'],
    },
  },
  // 31. 冷启动知识库初始化（自动创建 9 维度 Candidate）
  {
    name: 'autosnippet_bootstrap_knowledge',
    description:
      '项目冷启动：一键初始化知识库。覆盖 9 大知识维度（项目规范/代码模式/架构/最佳实践/调用链/数据流/Bug修复/项目特征/Agent注意事项）。\n' +
      '自动为每个维度创建 N 条 Candidate（PENDING 状态），每条单一职责，基于启发式规则从扫描文件中提取代表性代码。\n' +
      '返回 filesByTarget、dependencyGraph、bootstrapCandidates（创建结果）、analysisFramework。\n' +
      '建议后续步骤：① autosnippet_enrich_candidates 结构补齐 → ② autosnippet_bootstrap_refine 内容润色。',
    inputSchema: {
      type: 'object',
      properties: {
        maxFiles: { type: 'number', default: 500, description: '最大扫描文件数（防止超大项目超时）' },
        contentMaxLines: { type: 'number', default: 120, description: '每个文件返回的最大行数（过大可能超出 Token 限制）' },
        skipGuard: { type: 'boolean', default: false, description: '跳过 Guard 审计' },
      },
      required: [],
    },
  },
  // 32. ② 内容润色：Bootstrap 候选 AI 精炼（Phase 6）
  {
    name: 'autosnippet_bootstrap_refine',
    description:
      '② 内容润色 — 逐条精炼 Bootstrap 候选的内容质量。\n' +
      '改善 summary 描述、补充架构 insight 洞察、推断 relations 关联、调整 confidence 评分、丰富 tags。\n' +
      '建议流程：autosnippet_bootstrap_knowledge → autosnippet_enrich_candidates（① 结构补齐）→ 本工具（② 内容润色）。\n' +
      '需要 AI Provider 已配置。',
    inputSchema: {
      type: 'object',
      properties: {
        candidateIds: { type: 'array', items: { type: 'string' }, description: '指定候选 ID 列表（可选，默认全部 bootstrap 候选）' },
        userPrompt: { type: 'string', description: '用户自定义润色提示词，指导 AI 润色方向（如"侧重描述线程安全注意事项"）' },
        dryRun: { type: 'boolean', default: false, description: '仅预览 AI 润色结果，不写入数据库' },
      },
      required: [],
    },
  },
];
