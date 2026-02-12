/**
 * tools.js — ChatAgent 全部工具定义
 *
 * 33 个工具覆盖项目全部 AI 能力:
 *
 * ┌─── 查询类 (8) ─────────────────────────────────┐
 * │  1. search_recipes       搜索 Recipe            │
 * │  2. search_candidates    搜索候选项             │
 * │  3. get_recipe_detail    获取 Recipe 详情        │
 * │  4. get_project_stats    获取项目统计            │
 * │  5. search_knowledge     RAG 知识库搜索          │
 * │  6. get_related_recipes  知识图谱关联查询        │
 * │  7. list_guard_rules     列出 Guard 规则         │
 * │  8. get_recommendations  获取推荐 Recipe          │
 * └─────────────────────────────────────────────────┘
 * ┌─── AI 分析类 (5) ──────────────────────────────────┐
 * │  9. summarize_code              代码摘要           │
 * │ 10. extract_recipes             从源码提取 Recipe  │
 * │ 11. enrich_candidate            ① 结构补齐         │
 * │ 11b. refine_bootstrap_candidates ② 内容润色        │
 * │ 12. ai_translate                AI 翻译 (中→英)    │
 * └─────────────────────────────────────────────────────┘
 * ┌─── Guard 安全类 (3) ───────────────────────────────┐
 * │ 13. guard_check_code     Guard 规则代码检查       │
 * │ 14. query_violations     查询 Guard 违规记录      │
 * │ 15. generate_guard_rule  AI 生成 Guard 规则       │
 * └─────────────────────────────────────────────────────┘
 * ┌─── 生命周期操作类 (7) ─────────────────────────────┐
 * │ 16. submit_candidate     提交候选                │
 * │ 17. approve_candidate    批准候选                │
 * │ 18. reject_candidate     驳回候选                │
 * │ 19. publish_recipe       发布 Recipe              │
 * │ 20. deprecate_recipe     弃用 Recipe              │
 * │ 21. update_recipe        更新 Recipe 字段         │
 * │ 22. record_usage         记录 Recipe 使用         │
 * └─────────────────────────────────────────────────────┘
 * ┌─── 质量与反馈类 (3) ───────────────────────────────┐
 * │ 23. quality_score        Recipe 质量评分          │
 * │ 24. validate_candidate   候选校验                │
 * │ 25. get_feedback_stats   获取反馈统计            │
 * └─────────────────────────────────────────────────────┘
 * ┌─── 知识图谱类 (3) ─────────────────────────────────┐
 * │ 26. check_duplicate      候选查重                │
 * │ 27. discover_relations   知识图谱关系发现         │
 * │ 28. add_graph_edge       添加知识图谱关系         │
 * └─────────────────────────────────────────────────────┘
 * ┌─── 基础设施类 (3) ─────────────────────────────────┐
 * │ 29. graph_impact_analysis 影响范围分析            │
 * │ 30. rebuild_index         向量索引重建            │
 * │ 31. query_audit_log       审计日志查询            │
 * └─────────────────────────────────────────────────────┘
 * ┌─── Skills & Bootstrap (2) ─────────────────────────┐
 * │ 32. load_skill            加载 Agent Skill 文档   │
 * │ 33. bootstrap_knowledge   冷启动知识库初始化      │
 * └─────────────────────────────────────────────────────┘
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSimilarRecipes } from '../candidate/SimilarityService.js';
import Logger from '../../infrastructure/logging/Logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** skills/ 目录绝对路径 */
const SKILLS_DIR = path.resolve(__dirname, '../../../skills');

// ────────────────────────────────────────────────────────────
// 1. search_recipes
// ────────────────────────────────────────────────────────────
const searchRecipes = {
  name: 'search_recipes',
  description: '搜索知识库中的 Recipe（代码片段/最佳实践/架构模式）。支持关键词搜索和按分类/语言/类型筛选。',
  parameters: {
    type: 'object',
    properties: {
      keyword:       { type: 'string', description: '搜索关键词' },
      category:      { type: 'string', description: '分类过滤 (View/Service/Tool/Model/Network/Storage/UI/Utility)' },
      language:      { type: 'string', description: '编程语言过滤 (swift/objectivec/typescript 等)' },
      knowledgeType: { type: 'string', description: '知识类型过滤 (code-standard/code-pattern/architecture/best-practice 等)' },
      limit:         { type: 'number', description: '返回数量上限，默认 10' },
    },
  },
  handler: async (params, ctx) => {
    const recipeService = ctx.container.get('recipeService');
    const { keyword, category, language, knowledgeType, limit = 10 } = params;

    if (keyword) {
      return recipeService.searchRecipes(keyword, { page: 1, pageSize: limit });
    }

    const filters = {};
    if (category)      filters.category = category;
    if (language)      filters.language = language;
    if (knowledgeType) filters.knowledgeType = knowledgeType;

    return recipeService.listRecipes(filters, { page: 1, pageSize: limit });
  },
};

// ────────────────────────────────────────────────────────────
// 2. search_candidates
// ────────────────────────────────────────────────────────────
const searchCandidates = {
  name: 'search_candidates',
  description: '搜索或列出候选项（待审核的代码片段）。支持关键词搜索和按状态/语言/分类筛选。',
  parameters: {
    type: 'object',
    properties: {
      keyword:  { type: 'string', description: '搜索关键词' },
      status:   { type: 'string', description: '状态过滤 (pending/approved/rejected/applied)' },
      language: { type: 'string', description: '编程语言过滤' },
      category: { type: 'string', description: '分类过滤' },
      limit:    { type: 'number', description: '返回数量上限，默认 10' },
    },
  },
  handler: async (params, ctx) => {
    const candidateService = ctx.container.get('candidateService');
    const { keyword, status, language, category, limit = 10 } = params;

    if (keyword) {
      return candidateService.searchCandidates(keyword, { page: 1, pageSize: limit });
    }

    const filters = {};
    if (status)   filters.status = status;
    if (language) filters.language = language;
    if (category) filters.category = category;

    return candidateService.listCandidates(filters, { page: 1, pageSize: limit });
  },
};

// ────────────────────────────────────────────────────────────
// 3. get_recipe_detail
// ────────────────────────────────────────────────────────────
const getRecipeDetail = {
  name: 'get_recipe_detail',
  description: '获取单个 Recipe 的完整详情（代码、摘要、使用指南、关系等）。',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'Recipe ID' },
    },
    required: ['recipeId'],
  },
  handler: async (params, ctx) => {
    const recipeRepo = ctx.container.get('recipeRepository');
    const recipe = await recipeRepo.findById(params.recipeId);
    if (!recipe) return { error: `Recipe '${params.recipeId}' not found` };
    return recipe;
  },
};

// ────────────────────────────────────────────────────────────
// 4. get_project_stats
// ────────────────────────────────────────────────────────────
const getProjectStats = {
  name: 'get_project_stats',
  description: '获取项目知识库的整体统计：Recipe 数量/分类分布、候选项数量/状态分布、知识图谱节点/边数。',
  parameters: { type: 'object', properties: {} },
  handler: async (_params, ctx) => {
    const recipeService = ctx.container.get('recipeService');
    const candidateService = ctx.container.get('candidateService');

    const [recipeStats, candidateStats] = await Promise.all([
      recipeService.getRecipeStats(),
      candidateService.getCandidateStats(),
    ]);

    // 尝试获取知识图谱统计
    let graphStats = null;
    try {
      const kgService = ctx.container.get('knowledgeGraphService');
      graphStats = kgService.getStats();
    } catch { /* KG not available */ }

    return {
      recipes: recipeStats,
      candidates: candidateStats,
      knowledgeGraph: graphStats,
    };
  },
};

// ────────────────────────────────────────────────────────────
// 5. search_knowledge
// ────────────────────────────────────────────────────────────
const searchKnowledge = {
  name: 'search_knowledge',
  description: 'RAG 知识库语义搜索 — 结合向量检索和关键词检索，返回与查询最相关的知识片段。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询' },
      topK:  { type: 'number', description: '返回结果数，默认 5' },
    },
    required: ['query'],
  },
  handler: async (params, ctx) => {
    const { query, topK = 5 } = params;

    // 优先使用 SearchEngine（有 BM25 + 向量搜索）
    try {
      const searchEngine = ctx.container.get('searchEngine');
      const results = await searchEngine.search(query, { limit: topK });
      if (results && results.length > 0) {
        return { source: 'searchEngine', results: results.slice(0, topK) };
      }
    } catch { /* SearchEngine not available */ }

    // 降级: RetrievalFunnel + 全量候选
    try {
      const funnel = ctx.container.get('retrievalFunnel');
      const recipeRepo = ctx.container.get('recipeRepository');
      const allRecipes = await recipeRepo.findAll?.() || [];

      // 规范化为 funnel 输入格式
      const candidates = allRecipes.map(r => ({
        id: r.id,
        title: r.title,
        content: r.content || r.code || '',
        description: r.description || r.summary_cn || '',
        language: r.language,
        category: r.category,
        trigger: r.trigger || '',
      }));

      if (candidates.length > 0) {
        const results = await funnel.execute(query, candidates, {});
        return { source: 'retrievalFunnel', results: results.slice(0, topK) };
      }
    } catch { /* RetrievalFunnel not available */ }

    return { source: 'none', results: [], message: 'No search engine available' };
  },
};

// ────────────────────────────────────────────────────────────
// 6. get_related_recipes
// ────────────────────────────────────────────────────────────
const getRelatedRecipes = {
  name: 'get_related_recipes',
  description: '通过知识图谱查询某个 Recipe 的关联 Recipe（requires/extends/enforces 等关系）。',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'Recipe ID' },
      relation: { type: 'string', description: '关系类型过滤 (requires/extends/enforces/depends_on/inherits/implements/calls/prerequisite)，不传则返回全部关系' },
    },
    required: ['recipeId'],
  },
  handler: async (params, ctx) => {
    const kgService = ctx.container.get('knowledgeGraphService');
    const { recipeId, relation } = params;

    if (relation) {
      const edges = kgService.getRelated(recipeId, 'recipe', relation);
      return { recipeId, relation, edges };
    }

    const edges = kgService.getEdges(recipeId, 'recipe', 'both');
    return { recipeId, ...edges };
  },
};

// ────────────────────────────────────────────────────────────
// 7. summarize_code
// ────────────────────────────────────────────────────────────
const summarizeCode = {
  name: 'summarize_code',
  description: 'AI 代码摘要 — 分析代码片段并生成结构化摘要（包含功能描述、关键 API、使用建议）。',
  parameters: {
    type: 'object',
    properties: {
      code:     { type: 'string', description: '代码内容' },
      language: { type: 'string', description: '编程语言' },
    },
    required: ['code'],
  },
  handler: async (params, ctx) => {
    if (!ctx.aiProvider) return { error: 'AI provider not available' };
    return ctx.aiProvider.summarize(params.code, params.language);
  },
};

// ────────────────────────────────────────────────────────────
// 8. extract_recipes
// ────────────────────────────────────────────────────────────
const extractRecipes = {
  name: 'extract_recipes',
  description: '从源码文件中批量提取可复用的 Recipe 结构（代码标准、设计模式、最佳实践）。支持自动 provider fallback。',
  parameters: {
    type: 'object',
    properties: {
      targetName: { type: 'string', description: 'SPM Target / 模块名称' },
      files:      { type: 'array',  description: '文件数组 [{name, content}]' },
    },
    required: ['targetName', 'files'],
  },
  handler: async (params, ctx) => {
    if (!ctx.aiProvider) return { error: 'AI provider not available' };
    const { targetName, files } = params;

    // 首选：使用当前 aiProvider
    try {
      const recipes = await ctx.aiProvider.extractRecipes(targetName, files);
      return { targetName, extracted: Array.isArray(recipes) ? recipes.length : 0, recipes: Array.isArray(recipes) ? recipes : [] };
    } catch (primaryErr) {
      // 尝试 fallback（如果 AiFactory 可用）
      try {
        const aiFactory = ctx.container?.singletons?._aiFactory;
        if (aiFactory?.isGeoOrProviderError?.(primaryErr)) {
          const currentProvider = (process.env.ASD_AI_PROVIDER || 'google').toLowerCase();
          const fallbacks = aiFactory.getAvailableFallbacks(currentProvider);
          for (const fbName of fallbacks) {
            try {
              const fbProvider = aiFactory.createProvider({ provider: fbName });
              const recipes = await fbProvider.extractRecipes(targetName, files);
              return { targetName, extracted: Array.isArray(recipes) ? recipes.length : 0, recipes: Array.isArray(recipes) ? recipes : [], fallbackUsed: fbName };
            } catch { /* next fallback */ }
          }
        }
      } catch { /* AiFactory not available, rethrow original */ }
      throw primaryErr;
    }
  },
};

// ────────────────────────────────────────────────────────────
// 9. enrich_candidate
// ────────────────────────────────────────────────────────────
const enrichCandidate = {
  name: 'enrich_candidate',
  description: '① 结构补齐 — 自动填充缺失的结构性语义字段（rationale/knowledgeType/complexity/scope/steps/constraints）。批量处理，只填空不覆盖。建议在 refine_bootstrap_candidates 之前执行。',
  parameters: {
    type: 'object',
    properties: {
      candidateIds: { type: 'array', description: '候选 ID 列表 (最多 20 个)' },
    },
    required: ['candidateIds'],
  },
  handler: async (params, ctx) => {
    if (!ctx.aiProvider) return { error: 'AI provider not available' };
    const candidateService = ctx.container.get('candidateService');
    return candidateService.enrichCandidates(
      params.candidateIds,
      ctx.aiProvider,
      { userId: 'agent' },
    );
  },
};

// ────────────────────────────────────────────────────────────
// 9b. refine_bootstrap_candidates (Phase 6)
// ────────────────────────────────────────────────────────────
const refineBootstrapCandidates = {
  name: 'refine_bootstrap_candidates',
  description: '② 内容润色 — 逐条精炼 Bootstrap 候选的内容质量：改善 summary、补充架构 insight、推断 relations 关联、调整 confidence、丰富 tags。建议在 enrich_candidate 之后执行。',
  parameters: {
    type: 'object',
    properties: {
      candidateIds: { type: 'array', description: '指定候选 ID 列表（可选，默认全部 bootstrap 候选）' },
      userPrompt: { type: 'string', description: '用户自定义润色提示词，指导 AI 润色方向（如“侧重描述线程安全注意事项”）' },
      dryRun: { type: 'boolean', description: '仅预览 AI 润色结果，不写入数据库' },
    },
  },
  handler: async (params, ctx) => {
    if (!ctx.aiProvider) return { error: 'AI provider not available' };
    const candidateService = ctx.container.get('candidateService');
    return candidateService.refineBootstrapCandidates(
      ctx.aiProvider,
      { candidateIds: params.candidateIds, userPrompt: params.userPrompt, dryRun: params.dryRun },
      { userId: 'agent' },
    );
  },
};

// ────────────────────────────────────────────────────────────
// 10. check_duplicate
// ────────────────────────────────────────────────────────────
const checkDuplicate = {
  name: 'check_duplicate',
  description: '候选查重 — 检测候选代码是否与已有 Recipe 重复（基于标题/摘要/代码的 Jaccard 相似度）。',
  parameters: {
    type: 'object',
    properties: {
      candidate:   { type: 'object', description: '候选对象 { title, summary, code, usageGuide }' },
      candidateId: { type: 'string', description: '或提供候选 ID，从数据库读取' },
      projectRoot: { type: 'string', description: '项目根目录（可选，默认当前项目）' },
      threshold:   { type: 'number', description: '相似度阈值，默认 0.5' },
    },
  },
  handler: async (params, ctx) => {
    let cand = params.candidate;
    const projectRoot = params.projectRoot || ctx.projectRoot;
    const threshold = params.threshold ?? 0.5;

    // 如果提供 candidateId，从数据库读取候选信息
    if (!cand && params.candidateId) {
      try {
        const candidateRepo = ctx.container.get('candidateRepository');
        const found = await candidateRepo.findById(params.candidateId);
        if (found) {
          const meta = found.metadata || {};
          cand = {
            title: meta.title || '',
            summary: meta.summary_cn || meta.summary || '',
            code: found.code || '',
            usageGuide: meta.usageGuide_cn || meta.usageGuide || '',
          };
        }
      } catch { /* ignore */ }
    }

    if (!cand) return { similar: [], message: 'No candidate provided' };

    const similar = findSimilarRecipes(projectRoot, cand, {
      threshold,
      topK: 10,
    });

    return {
      similar,
      hasDuplicate: similar.some(s => s.similarity >= 0.7),
      highestSimilarity: similar.length > 0 ? similar[0].similarity : 0,
    };
  },
};

// ────────────────────────────────────────────────────────────
// 11. discover_relations
// ────────────────────────────────────────────────────────────
const discoverRelations = {
  name: 'discover_relations',
  description: 'AI 知识图谱关系发现 — 分析 Recipe 对之间的潜在关系（requires/extends/enforces/calls 等），并自动写入知识图谱。',
  parameters: {
    type: 'object',
    properties: {
      recipePairs: {
        type: 'array',
        description: 'Recipe 对数组 [{ a: {id, title, category, code}, b: {id, title, category, code} }]',
      },
      dryRun: { type: 'boolean', description: '仅分析不写入，默认 false' },
    },
    required: ['recipePairs'],
  },
  handler: async (params, ctx) => {
    if (!ctx.aiProvider) return { error: 'AI provider not available' };

    const { recipePairs, dryRun = false } = params;
    if (!recipePairs || recipePairs.length === 0) return { relations: [] };

    // 构建 LLM prompt
    const pairsText = recipePairs.map((p, i) => `
--- Pair #${i + 1} ---
Recipe A [${p.a.id}]: ${p.a.title} (${p.a.category}/${p.a.language || ''})
${p.a.code ? `Code: ${p.a.code.substring(0, 300)}` : ''}

Recipe B [${p.b.id}]: ${p.b.title} (${p.b.category}/${p.b.language || ''})
${p.b.code ? `Code: ${p.b.code.substring(0, 300)}` : ''}`).join('\n');

    const prompt = `# Role
You are a Software Architect analyzing relationships between code recipes (knowledge units).

# Goal
For each Recipe pair below, determine if there is a meaningful relationship.

# Relationship Types
- requires: A needs B to function
- extends: A builds upon / enriches B
- enforces: A enforces rules defined in B
- depends_on: A depends on B
- inherits: A inherits from B (class/protocol)
- implements: A implements interface/protocol defined in B
- calls: A calls API defined in B
- prerequisite: B must be learned/applied before A
- none: No meaningful relationship

# Output
Return a JSON array. For each pair with a relationship (skip "none"):
{ "index": 0, "from_id": "...", "to_id": "...", "relation": "requires", "confidence": 0.85, "reason": "A uses the network client defined in B" }

Return ONLY a JSON array. No markdown, no extra text. Return [] if no relationships found.

# Recipe Pairs
${pairsText}`;

    const response = await ctx.aiProvider.chat(prompt, { temperature: 0.2 });
    const parsed = ctx.aiProvider.extractJSON(response, '[', ']');
    const relations = Array.isArray(parsed) ? parsed : [];

    // 写入知识图谱（除非 dryRun）
    if (!dryRun && relations.length > 0) {
      try {
        const kgService = ctx.container.get('knowledgeGraphService');
        for (const rel of relations) {
          if (rel.from_id && rel.to_id && rel.relation && rel.relation !== 'none') {
            kgService.addEdge(
              rel.from_id, 'recipe',
              rel.to_id, 'recipe',
              rel.relation,
              { confidence: rel.confidence || 0.5, reason: rel.reason || '', source: 'ai-discovery' },
            );
          }
        }
      } catch { /* KG not available */ }
    }

    return {
      analyzed: recipePairs.length,
      relations: relations.filter(r => r.relation !== 'none'),
      written: dryRun ? 0 : relations.filter(r => r.relation !== 'none').length,
    };
  },
};

// ────────────────────────────────────────────────────────────
// 12. add_graph_edge
// ────────────────────────────────────────────────────────────
const addGraphEdge = {
  name: 'add_graph_edge',
  description: '手动添加知识图谱关系边（从 A 到 B 的关系）。',
  parameters: {
    type: 'object',
    properties: {
      fromId:   { type: 'string', description: '源节点 ID' },
      fromType: { type: 'string', description: '源节点类型 (recipe/candidate)' },
      toId:     { type: 'string', description: '目标节点 ID' },
      toType:   { type: 'string', description: '目标节点类型 (recipe/candidate)' },
      relation: { type: 'string', description: '关系类型 (requires/extends/enforces/depends_on/inherits/implements/calls/prerequisite)' },
      weight:   { type: 'number', description: '权重 0-1，默认 1.0' },
    },
    required: ['fromId', 'fromType', 'toId', 'toType', 'relation'],
  },
  handler: async (params, ctx) => {
    const kgService = ctx.container.get('knowledgeGraphService');
    return kgService.addEdge(
      params.fromId, params.fromType,
      params.toId, params.toType,
      params.relation,
      { weight: params.weight || 1.0, source: 'manual' },
    );
  },
};

// ════════════════════════════════════════════════════════════
//  NEW TOOLS (13-31)
// ════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────
// 7b. list_guard_rules
// ────────────────────────────────────────────────────────────
const listGuardRules = {
  name: 'list_guard_rules',
  description: '列出所有 Guard 规则（boundary-constraint 类型的 Recipe）。支持按语言/状态过滤。',
  parameters: {
    type: 'object',
    properties: {
      language: { type: 'string', description: '按语言过滤 (swift/objc 等)' },
      includeBuiltIn: { type: 'boolean', description: '是否包含内置规则，默认 true' },
      limit: { type: 'number', description: '返回数量上限，默认 50' },
    },
  },
  handler: async (params, ctx) => {
    const { language, includeBuiltIn = true, limit = 50 } = params;
    const results = [];

    // 数据库自定义规则
    try {
      const guardService = ctx.container.get('guardService');
      const dbRules = await guardService.listRules({}, { page: 1, pageSize: limit });
      results.push(...(dbRules.data || dbRules.items || []));
    } catch { /* not available */ }

    // 内置规则
    if (includeBuiltIn) {
      try {
        const guardCheckEngine = ctx.container.get('guardCheckEngine');
        const builtIn = guardCheckEngine.getRules(language || null)
          .filter(r => r.source === 'built-in');
        results.push(...builtIn);
      } catch { /* not available */ }
    }

    return { total: results.length, rules: results.slice(0, limit) };
  },
};

// ────────────────────────────────────────────────────────────
// 8b. get_recommendations
// ────────────────────────────────────────────────────────────
const getRecommendations = {
  name: 'get_recommendations',
  description: '获取推荐的 Recipe 列表（基于使用频率和质量排序）。',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: '返回数量，默认 10' },
    },
  },
  handler: async (params, ctx) => {
    const recipeService = ctx.container.get('recipeService');
    return recipeService.getRecommendations(params.limit || 10);
  },
};

// ────────────────────────────────────────────────────────────
// 12. ai_translate
// ────────────────────────────────────────────────────────────
const aiTranslate = {
  name: 'ai_translate',
  description: 'AI 翻译 — 将中文 summary/usageGuide 翻译为英文。',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '中文摘要' },
      usageGuide: { type: 'string', description: '中文使用指南' },
    },
  },
  handler: async (params, ctx) => {
    if (!ctx.aiProvider) return { error: 'AI provider not available' };
    const { summary, usageGuide } = params;
    if (!summary && !usageGuide) return { summary_en: '', usageGuide_en: '' };

    const systemPrompt = 'You are a technical translator. Translate from Chinese to English. Keep technical terms unchanged. Return ONLY valid JSON: { "summary_en": "...", "usageGuide_en": "..." }.';
    const parts = [];
    if (summary) parts.push(`summary: ${summary}`);
    if (usageGuide) parts.push(`usageGuide: ${usageGuide}`);

    const raw = await ctx.aiProvider.chat(parts.join('\n'), { systemPrompt, temperature: 0.2 });
    const parsed = ctx.aiProvider.extractJSON(raw, '{', '}');
    return parsed || { summary_en: summary || '', usageGuide_en: usageGuide || '' };
  },
};

// ────────────────────────────────────────────────────────────
// 13. guard_check_code
// ────────────────────────────────────────────────────────────
const guardCheckCode = {
  name: 'guard_check_code',
  description: '对代码运行 Guard 规则检查，返回违规列表（支持内置规则 + 数据库自定义规则）。',
  parameters: {
    type: 'object',
    properties: {
      code:     { type: 'string', description: '待检查的源代码' },
      language: { type: 'string', description: '编程语言 (swift/objc/javascript 等)' },
      scope:    { type: 'string', description: '检查范围 (file/target/project)，默认 file' },
    },
    required: ['code'],
  },
  handler: async (params, ctx) => {
    const { code, language, scope = 'file' } = params;

    // 优先用 GuardCheckEngine（内置 + DB 规则）
    try {
      const engine = ctx.container.get('guardCheckEngine');
      const violations = engine.checkCode(code, language || 'unknown', { scope });
      return { violationCount: violations.length, violations };
    } catch { /* not available */ }

    // 降级到 GuardService.checkCode（仅 DB 规则）
    try {
      const guardService = ctx.container.get('guardService');
      const matches = await guardService.checkCode(code, { language });
      return { violationCount: matches.length, violations: matches };
    } catch (err) {
      return { error: err.message };
    }
  },
};

// ────────────────────────────────────────────────────────────
// 14. query_violations
// ────────────────────────────────────────────────────────────
const queryViolations = {
  name: 'query_violations',
  description: '查询 Guard 违规历史记录和统计。',
  parameters: {
    type: 'object',
    properties: {
      file:  { type: 'string', description: '按文件路径过滤' },
      limit: { type: 'number', description: '返回数量，默认 20' },
      statsOnly: { type: 'boolean', description: '仅返回统计数据，默认 false' },
    },
  },
  handler: async (params, ctx) => {
    const { file, limit = 20, statsOnly = false } = params;
    const store = ctx.container.get('violationsStore');

    if (statsOnly) {
      return store.getStats();
    }

    if (file) {
      return { runs: store.getRunsByFile(file) };
    }

    return store.list({}, { page: 1, limit });
  },
};

// ────────────────────────────────────────────────────────────
// 15. generate_guard_rule
// ────────────────────────────────────────────────────────────
const generateGuardRule = {
  name: 'generate_guard_rule',
  description: 'AI 生成 Guard 规则 — 描述你想阻止的代码模式，AI 自动生成正则表达式和规则定义。',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: '规则描述（例如 "禁止在主线程使用同步网络请求"）' },
      language:    { type: 'string', description: '目标语言 (swift/objc 等)' },
      severity:    { type: 'string', description: '严重程度 (error/warning/info)，默认 warning' },
      autoCreate:  { type: 'boolean', description: '是否自动创建到数据库，默认 false' },
    },
    required: ['description'],
  },
  handler: async (params, ctx) => {
    if (!ctx.aiProvider) return { error: 'AI provider not available' };
    const { description, language = 'swift', severity = 'warning', autoCreate = false } = params;

    const prompt = `Generate a Guard rule for this requirement:
Description: ${description}
Language: ${language}
Severity: ${severity}

Return ONLY valid JSON:
{
  "name": "rule-name-kebab-case",
  "description": "One-line description in English",
  "description_cn": "一行中文描述",
  "pattern": "regex pattern for matching the problematic code",
  "languages": ["${language}"],
  "severity": "${severity}",
  "testCases": {
    "shouldMatch": ["code example that should trigger"],
    "shouldNotMatch": ["code example that should NOT trigger"]
  }
}`;

    const raw = await ctx.aiProvider.chat(prompt, { temperature: 0.2 });
    const rule = ctx.aiProvider.extractJSON(raw, '{', '}');
    if (!rule) return { error: 'Failed to parse AI response' };

    // 验证正则表达式
    try {
      new RegExp(rule.pattern);
    } catch (e) {
      return { error: `Invalid regex pattern: ${e.message}`, rule };
    }

    // 自动创建
    if (autoCreate && rule.name && rule.pattern) {
      try {
        const guardService = ctx.container.get('guardService');
        const created = await guardService.createRule({
          name: rule.name,
          description: rule.description || description,
          pattern: rule.pattern,
          languages: rule.languages || [language],
          severity: rule.severity || severity,
        }, { userId: 'agent' });
        return { rule, created: true, recipeId: created.id };
      } catch (err) {
        return { rule, created: false, error: err.message };
      }
    }

    return { rule, created: false };
  },
};

// ────────────────────────────────────────────────────────────
// 16. submit_candidate
// ────────────────────────────────────────────────────────────
const submitCandidate = {
  name: 'submit_candidate',
  description: '提交新的代码候选项到知识库审核队列。',
  parameters: {
    type: 'object',
    properties: {
      code:     { type: 'string', description: '代码内容' },
      language: { type: 'string', description: '编程语言' },
      category: { type: 'string', description: '分类 (View/Service/Tool/Model 等)' },
      source:   { type: 'string', description: '来源 (manual/agent/mcp)，默认 agent' },
      reasoning: { type: 'object', description: '推理依据 { whyStandard, sources, confidence }' },
      metadata:  { type: 'object', description: '元数据 { title, summary, ... }' },
    },
    required: ['code', 'language', 'category'],
  },
  handler: async (params, ctx) => {
    const candidateService = ctx.container.get('candidateService');
    // 统一走 createFromToolParams，与 MCP / Bootstrap 路径一致
    const item = {
      code: params.code,
      language: params.language,
      category: params.category,
      ...params.metadata,          // 展开 metadata 到扁平字段
      reasoning: params.reasoning || { whyStandard: 'Submitted via ChatAgent', sources: ['agent'], confidence: 0.7 },
    };
    return candidateService.createFromToolParams(item, params.source || 'agent', {}, { userId: 'agent' });
  },
};

// ────────────────────────────────────────────────────────────
// 17. approve_candidate
// ────────────────────────────────────────────────────────────
const approveCandidate = {
  name: 'approve_candidate',
  description: '批准候选项（PENDING → APPROVED）。',
  parameters: {
    type: 'object',
    properties: {
      candidateId: { type: 'string', description: '候选 ID' },
    },
    required: ['candidateId'],
  },
  handler: async (params, ctx) => {
    const candidateService = ctx.container.get('candidateService');
    return candidateService.approveCandidate(params.candidateId, { userId: 'agent' });
  },
};

// ────────────────────────────────────────────────────────────
// 18. reject_candidate
// ────────────────────────────────────────────────────────────
const rejectCandidate = {
  name: 'reject_candidate',
  description: '驳回候选项并填写驳回理由。',
  parameters: {
    type: 'object',
    properties: {
      candidateId: { type: 'string', description: '候选 ID' },
      reason:      { type: 'string', description: '驳回理由' },
    },
    required: ['candidateId', 'reason'],
  },
  handler: async (params, ctx) => {
    const candidateService = ctx.container.get('candidateService');
    return candidateService.rejectCandidate(params.candidateId, params.reason, { userId: 'agent' });
  },
};

// ────────────────────────────────────────────────────────────
// 19. publish_recipe
// ────────────────────────────────────────────────────────────
const publishRecipe = {
  name: 'publish_recipe',
  description: '发布 Recipe（DRAFT → ACTIVE）。',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'Recipe ID' },
    },
    required: ['recipeId'],
  },
  handler: async (params, ctx) => {
    const recipeService = ctx.container.get('recipeService');
    return recipeService.publishRecipe(params.recipeId, { userId: 'agent' });
  },
};

// ────────────────────────────────────────────────────────────
// 20. deprecate_recipe
// ────────────────────────────────────────────────────────────
const deprecateRecipe = {
  name: 'deprecate_recipe',
  description: '弃用 Recipe 并填写弃用原因。',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'Recipe ID' },
      reason:   { type: 'string', description: '弃用原因' },
    },
    required: ['recipeId', 'reason'],
  },
  handler: async (params, ctx) => {
    const recipeService = ctx.container.get('recipeService');
    return recipeService.deprecateRecipe(params.recipeId, params.reason, { userId: 'agent' });
  },
};

// ────────────────────────────────────────────────────────────
// 21. update_recipe
// ────────────────────────────────────────────────────────────
const updateRecipe = {
  name: 'update_recipe',
  description: '更新 Recipe 的指定字段（title/description/content/category/tags 等）。',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'Recipe ID' },
      updates:  { type: 'object', description: '要更新的字段和值' },
    },
    required: ['recipeId', 'updates'],
  },
  handler: async (params, ctx) => {
    const recipeService = ctx.container.get('recipeService');
    return recipeService.updateRecipe(params.recipeId, params.updates, { userId: 'agent' });
  },
};

// ────────────────────────────────────────────────────────────
// 22. record_usage
// ────────────────────────────────────────────────────────────
const recordUsage = {
  name: 'record_usage',
  description: '记录 Recipe 的使用（adoption 被采纳 / application 被应用）。',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'Recipe ID' },
      type:     { type: 'string', description: 'adoption 或 application，默认 adoption' },
    },
    required: ['recipeId'],
  },
  handler: async (params, ctx) => {
    const recipeService = ctx.container.get('recipeService');
    const type = params.type || 'adoption';
    await recipeService.incrementUsage(params.recipeId, type);
    return { success: true, recipeId: params.recipeId, type };
  },
};

// ────────────────────────────────────────────────────────────
// 23. quality_score
// ────────────────────────────────────────────────────────────
const qualityScore = {
  name: 'quality_score',
  description: 'Recipe 质量评分 — 5 维度综合评估（完整性/格式/代码质量/元数据/互动），返回分数和等级(A-F)。',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'Recipe ID（从数据库读取后评分）' },
      recipe:   { type: 'object', description: '或直接提供 Recipe 对象 { title, trigger, code, language, ... }' },
    },
  },
  handler: async (params, ctx) => {
    const qualityScorer = ctx.container.get('qualityScorer');
    let recipe = params.recipe;

    if (!recipe && params.recipeId) {
      const recipeRepo = ctx.container.get('recipeRepository');
      recipe = await recipeRepo.findById(params.recipeId);
      if (!recipe) return { error: `Recipe '${params.recipeId}' not found` };
    }
    if (!recipe) return { error: 'Provide recipeId or recipe object' };

    return qualityScorer.score(recipe);
  },
};

// ────────────────────────────────────────────────────────────
// 24. validate_candidate
// ────────────────────────────────────────────────────────────
const validateCandidate = {
  name: 'validate_candidate',
  description: '候选校验 — 检查候选是否满足提交要求（必填字段/格式/质量），返回 errors 和 warnings。',
  parameters: {
    type: 'object',
    properties: {
      candidate: { type: 'object', description: '候选对象 { title, trigger, category, language, code, reasoning, ... }' },
    },
    required: ['candidate'],
  },
  handler: async (params, ctx) => {
    const validator = ctx.container.get('recipeCandidateValidator');
    return validator.validate(params.candidate);
  },
};

// ────────────────────────────────────────────────────────────
// 25. get_feedback_stats
// ────────────────────────────────────────────────────────────
const getFeedbackStats = {
  name: 'get_feedback_stats',
  description: '获取用户反馈统计 — 全局交互事件统计 + 热门 Recipe + 指定 Recipe 的详细反馈。',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: '查询指定 Recipe 的反馈（可选）' },
      topN:     { type: 'number', description: '热门 Recipe 数量，默认 10' },
    },
  },
  handler: async (params, ctx) => {
    const feedbackCollector = ctx.container.get('feedbackCollector');
    const result = {};

    result.global = feedbackCollector.getGlobalStats();
    result.topRecipes = feedbackCollector.getTopRecipes(params.topN || 10);

    if (params.recipeId) {
      result.recipeStats = feedbackCollector.getRecipeStats(params.recipeId);
    }

    return result;
  },
};

// ────────────────────────────────────────────────────────────
// 29. graph_impact_analysis
// ────────────────────────────────────────────────────────────
const graphImpactAnalysis = {
  name: 'graph_impact_analysis',
  description: '知识图谱影响范围分析 — 查找修改某个 Recipe 后可能受影响的所有下游依赖。',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'Recipe ID' },
      maxDepth: { type: 'number', description: '最大深度，默认 3' },
    },
    required: ['recipeId'],
  },
  handler: async (params, ctx) => {
    const kgService = ctx.container.get('knowledgeGraphService');
    const impacted = kgService.getImpactAnalysis(params.recipeId, 'recipe', params.maxDepth || 3);
    return { recipeId: params.recipeId, impactedCount: impacted.length, impacted };
  },
};

// ────────────────────────────────────────────────────────────
// 30. rebuild_index
// ────────────────────────────────────────────────────────────
const rebuildIndex = {
  name: 'rebuild_index',
  description: '向量索引重建 — 重新扫描 Recipe 文件并更新向量索引（用于索引过期或新增大量 Recipe 后）。',
  parameters: {
    type: 'object',
    properties: {
      force: { type: 'boolean', description: '强制重建（跳过增量检测），默认 false' },
      dryRun: { type: 'boolean', description: '仅预览不实际写入，默认 false' },
    },
  },
  handler: async (params, ctx) => {
    const pipeline = ctx.container.get('indexingPipeline');
    return pipeline.run({ force: params.force || false, dryRun: params.dryRun || false });
  },
};

// ────────────────────────────────────────────────────────────
// 31. query_audit_log
// ────────────────────────────────────────────────────────────
const queryAuditLog = {
  name: 'query_audit_log',
  description: '审计日志查询 — 查看系统操作历史（谁在什么时间做了什么操作）。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: '按操作类型过滤 (create_candidate/approve_candidate/create_guard_rule 等)' },
      actor:  { type: 'string', description: '按操作者过滤' },
      limit:  { type: 'number', description: '返回数量，默认 20' },
    },
  },
  handler: async (params, ctx) => {
    const auditLogger = ctx.container.get('auditLogger');
    const { action, actor, limit = 20 } = params;

    if (actor) return auditLogger.getByActor(actor, limit);
    if (action) return auditLogger.getByAction(action, limit);
    return auditLogger.getStats();
  },
};

// ────────────────────────────────────────────────────────────
// 32. load_skill — 按需加载 Agent Skill 文档
// ────────────────────────────────────────────────────────────
const loadSkill = {
  name: 'load_skill',
  description: '加载指定的 Agent Skill 文档，获取领域操作指南和最佳实践参考。可用于冷启动指南 (autosnippet-coldstart)、语言参考 (autosnippet-reference-swift/objc/jsts) 等。',
  parameters: {
    type: 'object',
    properties: {
      skillName: { type: 'string', description: 'Skill 目录名（如 autosnippet-coldstart, autosnippet-reference-swift 等）' },
    },
    required: ['skillName'],
  },
  handler: async (params) => {
    const skillPath = path.join(SKILLS_DIR, params.skillName, 'SKILL.md');
    try {
      const content = fs.readFileSync(skillPath, 'utf8');
      return { skillName: params.skillName, content };
    } catch {
      const available = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      return { error: `Skill "${params.skillName}" not found`, availableSkills: available };
    }
  },
};

// ────────────────────────────────────────────────────────────
// 33. bootstrap_knowledge — 冷启动知识库初始化
// ────────────────────────────────────────────────────────────
const bootstrapKnowledgeTool = {
  name: 'bootstrap_knowledge',
  description: '冷启动知识库初始化（纯启发式，不使用 AI）: SPM Target 扫描 → 依赖图谱 → Guard 审计 → 9 维度 Candidate 自动创建。支持 Skill 增强维度定义。产出为初稿候选，后续由 DAG pipeline 自动编排 AI 增强（enrich → refine）。',
  parameters: {
    type: 'object',
    properties: {
      maxFiles: { type: 'number', description: '最大扫描文件数，默认 500' },
      skipGuard: { type: 'boolean', description: '是否跳过 Guard 审计，默认 false' },
      contentMaxLines: { type: 'number', description: '每文件读取最大行数，默认 120' },
      loadSkills: { type: 'boolean', description: '是否加载 Skills 增强维度定义（推荐开启），默认 true' },
    },
  },
  handler: async (params, ctx) => {
    const { bootstrapKnowledge } = await import('../../external/mcp/handlers/bootstrap.js');
    const logger = Logger.getInstance();
    const result = await bootstrapKnowledge(
      { container: ctx.container, logger },
      {
        maxFiles: params.maxFiles || 500,
        skipGuard: params.skipGuard || false,
        contentMaxLines: params.contentMaxLines || 120,
        loadSkills: params.loadSkills ?? true,
      },
    );
    // bootstrapKnowledge 返回 envelope JSON string，解析提取 data
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    return parsed?.data || parsed;
  },
};

// ────────────────────────────────────────────────────────────
// 导出全部工具
// ────────────────────────────────────────────────────────────

export const ALL_TOOLS = [
  // 查询类 (8)
  searchRecipes,
  searchCandidates,
  getRecipeDetail,
  getProjectStats,
  searchKnowledge,
  getRelatedRecipes,
  listGuardRules,
  getRecommendations,
  // AI 分析类 (5)
  summarizeCode,
  extractRecipes,
  enrichCandidate,
  refineBootstrapCandidates,
  aiTranslate,
  // Guard 安全类 (3)
  guardCheckCode,
  queryViolations,
  generateGuardRule,
  // 生命周期操作类 (7)
  submitCandidate,
  approveCandidate,
  rejectCandidate,
  publishRecipe,
  deprecateRecipe,
  updateRecipe,
  recordUsage,
  // 质量与反馈类 (3)
  qualityScore,
  validateCandidate,
  getFeedbackStats,
  // 知识图谱类 (3)
  checkDuplicate,
  discoverRelations,
  addGraphEdge,
  // 基础设施类 (3)
  graphImpactAnalysis,
  rebuildIndex,
  queryAuditLog,
  // Skills & Bootstrap (2)
  loadSkill,
  bootstrapKnowledgeTool,
];

export default ALL_TOOLS;
