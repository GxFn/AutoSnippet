/**
 * ChatAgent — 项目内唯一 AI 执行中心 (ReAct + DAG Pipeline)
 *
 * 设计原则: 项目内所有 AI 调用都走 ChatAgent + tool 体系。
 * bootstrapKnowledge() 等共享 handler 只做纯启发式，不直接调 AI。
 *
 * 三种调用模式:
 * - Dashboard Chat: execute(prompt, history) → ReAct 循环 → 自动调用工具 → 返回最终回答
 * - 程序化调用: executeTool(toolName, params) → 直接执行指定工具
 * - DAG 管线: runTask(taskName, params) → TaskPipeline 编排多工具协作（支持依赖、并行、条件跳过）
 *
 *   冷启动只是 DAG 管线的一个实例（bootstrap_full_pipeline），
 *   同样的机制可用于任何多步骤 AI 工作流。
 *
 * 与 MCP 外部 Agent 的分工:
 *   - ChatAgent: 项目内 AI（Dashboard、HTTP API），所有 AI 推理都经过 tool
 *   - MCP: 为外部 Agent（Cursor/Claude）暴露工具，外部 Agent 自带 AI 能力
 *   - 共享: handlers/bootstrap.js 等底层 handler 被两者复用（纯数据处理，无 AI）
 *
 * ReAct 模式:
 *   Thought → Action(tool_name, params) → Observation → ... → Answer
 *   最多 MAX_ITERATIONS 轮，防止无限循环
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Logger from '../../infrastructure/logging/Logger.js';
import { TaskPipeline } from './TaskPipeline.js';
import { Memory } from './Memory.js';
import { ConversationStore } from './ConversationStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SKILLS_DIR = path.resolve(PROJECT_ROOT, 'skills');
const SOUL_PATH = path.resolve(PROJECT_ROOT, 'SOUL.md');
const MAX_ITERATIONS = 6;

export class ChatAgent {
  #toolRegistry;
  #aiProvider;
  #container;
  #logger;
  /** @type {Map<string, TaskPipeline>} */
  #pipelines = new Map();
  /** @type {string} 缓存的项目概况（每次 execute 刷新一次） */
  #projectBriefingCache = '';
  /** @type {Memory|null} 跨对话轻量记忆 */
  #memory = null;
  /** @type {ConversationStore|null} 对话持久化 */
  #conversations = null;
  /** @type {string|null} 当前 execute 调用的 source — 'user' | 'system' */
  #currentSource = null;

  /**
   * @param {object} opts
   * @param {import('./ToolRegistry.js').ToolRegistry} opts.toolRegistry
   * @param {import('../../external/ai/AiProvider.js').AiProvider} opts.aiProvider
   * @param {import('../../injection/ServiceContainer.js').ServiceContainer} opts.container
   */
  constructor({ toolRegistry, aiProvider, container }) {
    this.#toolRegistry = toolRegistry;
    this.#aiProvider = aiProvider;
    this.#container = container;
    this.#logger = Logger.getInstance();

    /** 是否有 AI Provider（只读） */
    this.hasAI = !!aiProvider;

    // 初始化跨对话记忆 + 对话持久化
    try {
      const projectRoot = container?.singletons?._projectRoot || process.cwd();
      this.#memory = new Memory(projectRoot);
      this.#conversations = new ConversationStore(projectRoot);
    } catch { /* Memory/ConversationStore init failed, degrade silently */ }

    // 注册内置 DAG 管线
    this.#registerBuiltinPipelines();
  }

  // ─── 公共 API ─────────────────────────────────────────

  /**
   * 交互式对话（Dashboard Chat 入口）
   * 自动带 ReAct 循环: LLM 可决定调用工具或直接回答
   *
   * @param {string} prompt — 用户消息
   * @param {object} opts
   * @param {Array}  opts.history — 对话历史 [{role, content}]
   * @param {string} [opts.conversationId] — 对话 ID（启用持久化时）
   * @param {'user'|'system'} [opts.source='user'] — 调用来源（影响 Memory 隔离）
   * @returns {Promise<{reply: string, toolCalls: Array, hasContext: boolean, conversationId?: string}>}
   */
  async execute(prompt, { history = [], conversationId, source = 'user' } = {}) {
    this.#currentSource = source;
    const execStartTime = Date.now();
    const promptPreview = prompt.length > 80 ? prompt.substring(0, 80) + '…' : prompt;
    this.#logger.info(`[ChatAgent] ▶ execute — source=${source}, prompt="${promptPreview}", historyLen=${history.length}${conversationId ? ', convId=' + conversationId.substring(0, 8) : ''}`);

    // 对话持久化: 如果传了 conversationId，从 ConversationStore 加载历史
    let effectiveHistory = history;
    if (conversationId && this.#conversations) {
      effectiveHistory = this.#conversations.load(conversationId);
      this.#logger.info(`[ChatAgent] loaded ${effectiveHistory.length} messages from conversation store`);
      this.#conversations.append(conversationId, { role: 'user', content: prompt });
    }

    // 每次对话刷新项目概况（不是每轮 ReAct）
    this.#projectBriefingCache = await this.#buildProjectBriefing();

    const toolSchemas = this.#toolRegistry.getToolSchemas();
    const systemPrompt = this.#buildSystemPrompt(toolSchemas);

    // 首次 LLM 调用
    const messages = [
      ...effectiveHistory,
      { role: 'user', content: prompt },
    ];

    const toolCalls = [];
    let iterations = 0;
    let currentPrompt = prompt;

    let consecutiveAiErrors = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const iterStartTime = Date.now();

      let response;
      try {
        this.#logger.info(`[ChatAgent] 🔄 iteration ${iterations}/${MAX_ITERATIONS} — calling AI (${messages.length} messages)`);
        response = await this.#aiProvider.chat(currentPrompt, {
          history: messages.slice(0, -1), // 不含最新 user prompt
          systemPrompt,
        });
        const aiDuration = Date.now() - iterStartTime;
        const responsePreview = (response || '').substring(0, 120).replace(/\n/g, '↵');
        this.#logger.info(`[ChatAgent] ✓ AI responded in ${aiDuration}ms (${(response || '').length} chars) — "${responsePreview}…"`);
        consecutiveAiErrors = 0;
      } catch (aiErr) {
        consecutiveAiErrors++;
        this.#logger.warn(`[ChatAgent] AI call failed (attempt ${consecutiveAiErrors}): ${aiErr.message}`);

        // 连续 2 次失败则降级返回错误提示
        if (consecutiveAiErrors >= 2) {
          const errorReply = `抱歉，AI 服务暂时不可用（${aiErr.message}）。请稍后重试，或检查 API 配置。`;
          if (conversationId && this.#conversations) {
            this.#conversations.append(conversationId, { role: 'assistant', content: errorReply });
          }
          return { reply: errorReply, toolCalls, hasContext: toolCalls.length > 0, conversationId };
        }
        // 首次失败：等待后重试本轮
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // 尝试解析 Action 块
      const action = this.#parseAction(response);

      if (!action) {
        // 没有 Action → 最终回答
        const reply = this.#cleanFinalAnswer(response);
        const totalDuration = Date.now() - execStartTime;
        this.#logger.info(`[ChatAgent] ✅ final answer — ${reply.length} chars, ${iterations} iterations, ${toolCalls.length} tool calls, ${totalDuration}ms total`);
        this.#extractMemory(prompt, reply);

        // 持久化 assistant 回复
        if (conversationId && this.#conversations) {
          this.#conversations.append(conversationId, { role: 'assistant', content: reply });
          // 消息过多时自动压缩
          this.#autoSummarize(conversationId).catch(() => {});
        }

        return { reply, toolCalls, hasContext: toolCalls.length > 0, conversationId };
      }

      // 执行工具
      this.#logger.info(`[ChatAgent] 🔧 tool call: ${action.tool}(${JSON.stringify(action.params).substring(0, 100)})`, {
        iteration: iterations,
      });

      let toolResult;
      const toolStartTime = Date.now();
      try {
        toolResult = await this.#toolRegistry.execute(
          action.tool,
          action.params,
          this.#getToolContext(),
        );
        const toolDuration = Date.now() - toolStartTime;
        const resultSize = typeof toolResult === 'string' ? toolResult.length : JSON.stringify(toolResult).length;
        this.#logger.info(`[ChatAgent] 🔧 tool done: ${action.tool} → ${resultSize} chars in ${toolDuration}ms`);
      } catch (toolErr) {
        this.#logger.warn(`[ChatAgent] 🔧 tool FAILED: ${action.tool} — ${toolErr.message} (${Date.now() - toolStartTime}ms)`);
        // 将错误反馈给 LLM，让它尝试其他方法
        toolResult = `Error: tool "${action.tool}" failed — ${toolErr.message}. Try a different approach or provide your answer based on available information.`;
      }

      toolCalls.push({
        tool: action.tool,
        params: action.params,
        result: this.#summarizeResult(toolResult),
      });

      // 将工具结果注入为下一轮 prompt
      const observation = typeof toolResult === 'string'
        ? toolResult
        : JSON.stringify(toolResult, null, 2);

      currentPrompt = `Observation from tool "${action.tool}":\n${this.#truncate(observation, 4000)}\n\nBased on the above observation, continue reasoning about the user's question: "${prompt}".\nIf you have enough information, provide your final answer directly (without Action block). Otherwise, call another tool.`;

      // 追加到消息历史中以保持上下文
      messages.push({ role: 'assistant', content: response });
      messages.push({ role: 'user', content: currentPrompt });

      // ── Context Window 自动压缩（Cline AutoCondense 模式）──
      // 每轮 ReAct 后检测消息总 token，超过预算时压缩中段消息
      this.#condenseIfNeeded(messages);
    }

    // 达到最大迭代次数，要求 LLM 总结
    const summaryPrompt = `You have used ${iterations} tool calls. Summarize what you found and answer the user's original question: "${prompt}"`;
    let finalResponse;
    try {
      finalResponse = await this.#aiProvider.chat(summaryPrompt, {
        history: messages,
        systemPrompt: '直接回答用户问题，不要再调用工具。',
      });
    } catch (err) {
      this.#logger.warn(`[ChatAgent] Final summary AI call failed: ${err.message}`);
      // 降级：用工具调用结果拼一个简单回复
      finalResponse = `根据 ${toolCalls.length} 次工具调用的结果，以下是收集到的信息：\n\n` +
        toolCalls.map(tc => `• ${tc.tool}: ${typeof tc.result === 'string' ? tc.result.substring(0, 200) : JSON.stringify(tc.result).substring(0, 200)}`).join('\n') +
        '\n\n（注：AI 总结服务暂时不可用，上述为原始工具输出摘要）';
    }

    const finalReply = this.#cleanFinalAnswer(finalResponse);
    this.#extractMemory(prompt, finalReply);

    // 持久化 assistant 回复
    if (conversationId && this.#conversations) {
      this.#conversations.append(conversationId, { role: 'assistant', content: finalReply });
      this.#autoSummarize(conversationId).catch(() => {});
    }

    return {
      reply: finalReply,
      toolCalls,
      hasContext: toolCalls.length > 0,
      conversationId,
    };
  }

  /**
   * 程序化直接调用指定工具（跳过 ReAct 循环）
   * 用于: 候选提交时自动查重、定时任务等
   *
   * @param {string} toolName
   * @param {object} params
   * @returns {Promise<any>}
   */
  async executeTool(toolName, params = {}) {
    return this.#toolRegistry.execute(toolName, params, this.#getToolContext());
  }

  // ─── 对话管理 API ──────────────────────────────────────

  /**
   * 创建新对话（用于 Dashboard 前端）
   * @param {object} [opts]
   * @param {'user'|'system'} [opts.category='user']
   * @param {string} [opts.title]
   * @returns {string} conversationId
   */
  createConversation({ category = 'user', title = '' } = {}) {
    if (!this.#conversations) return null;
    return this.#conversations.create({ category, title });
  }

  /**
   * 获取对话列表
   * @param {object} [opts]
   * @param {'user'|'system'} [opts.category]
   * @param {number} [opts.limit=20]
   * @returns {Array}
   */
  getConversations({ category, limit = 20 } = {}) {
    if (!this.#conversations) return [];
    return this.#conversations.list({ category, limit });
  }

  /**
   * 获取 ConversationStore 实例（供外部使用，如 HTTP 路由）
   * @returns {ConversationStore|null}
   */
  getConversationStore() {
    return this.#conversations;
  }

  /**
   * 预定义任务流
   * 将常见多步骤操作封装为一个任务名。
   * 优先查找 DAG 管线（TaskPipeline），其次使用硬编码任务方法。
   */
  async runTask(taskName, params = {}) {
    // DAG 管线优先
    if (this.#pipelines.has(taskName)) {
      return this.runPipeline(taskName, params);
    }
    // 降级到硬编码任务（复杂交互逻辑无法用 DAG 表达的场景）
    switch (taskName) {
      case 'check_and_submit': return this.#taskCheckAndSubmit(params);
      case 'discover_all_relations': return this.#taskDiscoverAllRelations(params);
      case 'full_enrich': return this.#taskFullEnrich(params);
      case 'quality_audit': return this.#taskQualityAudit(params);
      case 'guard_full_scan': return this.#taskGuardFullScan(params);
      default: throw new Error(`Unknown task: ${taskName}`);
    }
  }

  /**
   * 注册自定义 DAG 管线
   *
   * @param {TaskPipeline} pipeline — TaskPipeline 实例
   */
  registerPipeline(pipeline) {
    if (!(pipeline instanceof TaskPipeline)) {
      throw new Error('Expected TaskPipeline instance');
    }
    this.#pipelines.set(pipeline.id, pipeline);
    this.#logger.info(`Pipeline registered: ${pipeline.id} (${pipeline.size} steps)`);
  }

  /**
   * 执行 DAG 管线
   *
   * @param {string} pipelineId — 管线 ID
   * @param {object} [inputs={}] — 管线初始输入
   * @returns {Promise<import('./TaskPipeline.js').PipelineResult>}
   */
  async runPipeline(pipelineId, inputs = {}) {
    const pipeline = this.#pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline '${pipelineId}' not found`);
    const executor = (toolName, params) => this.executeTool(toolName, params);
    return pipeline.execute(executor, inputs);
  }

  /**
   * 获取已注册的管线列表
   */
  getPipelines() {
    return [...this.#pipelines.values()].map(p => p.describe());
  }

  /**
   * 获取 Agent 能力清单（供 MCP / API 描述）
   */
  getCapabilities() {
    return {
      tools: this.#toolRegistry.getToolSchemas(),
      tasks: [
        { name: 'check_and_submit', description: '提交候选前自动查重 + 质量预评' },
        { name: 'discover_all_relations', description: '批量发现 Recipe 之间的知识图谱关系' },
        { name: 'full_enrich', description: '批量 AI 语义补全候选字段' },
        { name: 'quality_audit', description: '批量质量审计全部 Recipe，标记低分项' },
        { name: 'guard_full_scan', description: '用全部 Guard 规则扫描指定代码，生成完整报告' },
        { name: 'bootstrap_full_pipeline', description: '冷启动全流程 DAG: bootstrap(纯启发式) → enrich(AI结构补齐) + loadSkill(并行) → refine(AI内容润色)' },
      ],
      pipelines: this.getPipelines(),
    };
  }

  // ─── 预定义任务 ────────────────────────────────────────

  /**
   * 任务: 提交前查重 + 质量预评
   * 1. check_duplicate → 若发现相似 ≥ 0.7 则建议合并
   * 2. 顺便返回质量评估建议
   */
  async #taskCheckAndSubmit({ candidate, projectRoot }) {
    // Step 1: 查重
    const duplicates = await this.executeTool('check_duplicate', {
      candidate,
      projectRoot,
      threshold: 0.5,
    });

    // Step 2: 如果有高相似度，使用 AI 分析是否真正重复
    const highSim = (duplicates.similar || []).filter(d => d.similarity >= 0.7);
    let aiVerdict = null;
    if (highSim.length > 0 && this.#aiProvider) {
      const verdictPrompt = `以下新候选代码与已有 Recipe 高度相似，请判断是否真正重复。

新候选:
- Title: ${candidate.title || '(未命名)'}
- Code: ${(candidate.code || '').substring(0, 1000)}

相似 Recipe:
${highSim.map(s => `- ${s.title} (相似度: ${s.similarity})`).join('\n')}

请回答: DUPLICATE（真正重复）/ SIMILAR（相似但不同，建议保留并标注关系）/ UNIQUE（误判，可放心提交）
只回答一个词。`;
      try {
        const raw = await this.#aiProvider.chat(verdictPrompt, { temperature: 0, maxTokens: 20 });
        aiVerdict = (raw || '').trim().toUpperCase().split(/\s/)[0];
      } catch { /* ignore */ }
    }

    return {
      duplicates: duplicates.similar || [],
      highSimilarity: highSim,
      aiVerdict,
      recommendation: highSim.length === 0
        ? 'safe_to_submit'
        : aiVerdict === 'DUPLICATE' ? 'block_duplicate' : 'review_suggested',
    };
  }

  /**
   * 任务: 批量发现 Recipe 间的知识图谱关系
   * 遍历所有 Recipe，两两分析可能的关系
   */
  async #taskDiscoverAllRelations({ batchSize = 20 } = {}) {
    const ctx = this.#getToolContext();
    const recipeService = ctx.container.get('recipeService');
    if (!recipeService) throw new Error('RecipeService 不可用');

    if (!ctx.aiProvider) throw new Error('AI Provider 未配置，请先设置 API Key');

    // 获取所有 recipe
    const { items = [], data = [] } = await recipeService.listRecipes({}, { page: 1, pageSize: 500 });
    const recipes = items.length > 0 ? items : data;
    if (recipes.length < 2) return { discovered: 0, totalPairs: 0, message: `只有 ${recipes.length} 条 Recipe，至少需要 2 条` };

    // 按 batch 分组分析
    const pairs = [];
    for (let i = 0; i < recipes.length; i++) {
      for (let j = i + 1; j < recipes.length; j++) {
        pairs.push([recipes[i], recipes[j]]);
      }
    }

    let discovered = 0;
    const results = [];
    let batchErrors = 0;

    // 分批处理，单批失败不终止整体
    for (let b = 0; b < pairs.length; b += batchSize) {
      const batch = pairs.slice(b, b + batchSize);
      try {
        const result = await this.executeTool('discover_relations', {
          recipePairs: batch.map(([a, b]) => ({
            a: { id: a.id, title: a.title, category: a.category, language: a.language, code: String(a.content || a.code || '').substring(0, 500) },
            b: { id: b.id, title: b.title, category: b.category, language: b.language, code: String(b.content || b.code || '').substring(0, 500) },
          })),
        });

        if (result.error) {
          batchErrors++;
          this.#logger.warn(`[DiscoverRelations] Batch ${Math.floor(b / batchSize) + 1} error: ${result.error}`);
          continue;
        }
        if (result.relations) {
          discovered += result.relations.length;
          results.push(...result.relations);
        }
      } catch (err) {
        batchErrors++;
        this.#logger.warn(`[DiscoverRelations] Batch ${Math.floor(b / batchSize) + 1} threw: ${err.message}`);
      }
    }

    return {
      discovered,
      totalPairs: pairs.length,
      totalBatches: Math.ceil(pairs.length / batchSize),
      batchErrors,
      relations: results,
    };
  }

  /**
   * 任务: 批量 AI 补全候选语义字段
   */
  async #taskFullEnrich({ status = 'pending', maxCount = 50 } = {}) {
    const ctx = this.#getToolContext();
    const candidateService = ctx.container.get('candidateService');

    const { items = [], data = [] } = await candidateService.listCandidates(
      { status }, { page: 1, pageSize: maxCount }
    );
    const candidates = items.length > 0 ? items : data;
    if (candidates.length === 0) return { enriched: 0, message: 'No candidates to enrich' };

    // 筛选缺失语义字段的候选
    const needEnrich = candidates.filter(c => {
      const m = c.metadata || {};
      return !m.rationale || !m.knowledgeType || !m.complexity;
    });

    if (needEnrich.length === 0) return { enriched: 0, message: 'All candidates already enriched' };

    const result = await this.executeTool('enrich_candidate', {
      candidateIds: needEnrich.map(c => c.id).slice(0, 20),
    });

    return result;
  }

  /**
   * 任务: 批量质量审计全部 Recipe
   * 对活跃 Recipe 逐个评分，返回低于阈值的列表
   */
  async #taskQualityAudit({ threshold = 0.6, maxCount = 100 } = {}) {
    const ctx = this.#getToolContext();
    const recipeService = ctx.container.get('recipeService');

    const { items = [], data = [] } = await recipeService.listRecipes(
      { status: 'active' }, { page: 1, pageSize: maxCount }
    );
    const recipes = items.length > 0 ? items : data;
    if (recipes.length === 0) return { total: 0, lowQuality: [], message: 'No active recipes' };

    const lowQuality = [];
    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };

    for (const recipe of recipes) {
      const scoreResult = await this.executeTool('quality_score', { recipe });
      if (scoreResult.grade) gradeDistribution[scoreResult.grade] = (gradeDistribution[scoreResult.grade] || 0) + 1;
      if (scoreResult.score < threshold) {
        lowQuality.push({
          id: recipe.id,
          title: recipe.title,
          score: scoreResult.score,
          grade: scoreResult.grade,
          dimensions: scoreResult.dimensions,
        });
      }
    }

    lowQuality.sort((a, b) => a.score - b.score);

    return {
      total: recipes.length,
      threshold,
      gradeDistribution,
      lowQualityCount: lowQuality.length,
      lowQuality,
    };
  }

  /**
   * 任务: Guard 完整扫描
   * 对代码运行全部 Guard 规则 + 生成修复建议
   */
  async #taskGuardFullScan({ code, language, filePath } = {}) {
    if (!code) return { error: 'code is required' };

    // Step 1: 静态检查
    const checkResult = await this.executeTool('guard_check_code', {
      code, language: language || 'unknown', scope: 'project',
    });

    // Step 2: 如果有违规且 AI 可用，生成修复建议
    let suggestions = null;
    if (checkResult.violationCount > 0 && this.#aiProvider) {
      try {
        const violationSummary = (checkResult.violations || [])
          .slice(0, 5)
          .map(v => `- [${v.severity}] ${v.message || v.ruleName} (line ${v.line || v.matches?.[0]?.line || '?'})`)
          .join('\n');

        const prompt = `以下代码存在 Guard 规则违规。请为每个违规提供修复建议。

违规列表:
${violationSummary}

代码片段:
\`\`\`${language || ''}
${code.substring(0, 3000)}
\`\`\`

请用 JSON 数组格式返回建议: [{"violation": "...", "suggestion": "...", "fixExample": "..."}]`;

        const raw = await this.#aiProvider.chat(prompt, { temperature: 0.3 });
        suggestions = this.#aiProvider.extractJSON(raw, '[', ']') || [];
      } catch { /* AI suggestions optional */ }
    }

    return {
      filePath: filePath || '(inline)',
      language,
      violationCount: checkResult.violationCount,
      violations: checkResult.violations,
      suggestions,
    };
  }

  // ─── 内置 DAG 管线注册 ─────────────────────────────────

  /**
   * 注册内置 DAG 管线
   *
   * 设计原则: 项目内 AI 都走 ChatAgent + tool，DAG 编排 AI 步骤。
   * bootstrapKnowledge() 只做启发式 Phase 1-5，不调 AI。
   * AI 增强步骤由 ChatAgent DAG 编排:
   *
   * bootstrap_full_pipeline:
   *   Phase 0: bootstrap（SPM 扫描 + Skill 增强维度 + 候选创建，纯启发式）
   *   Phase 1: enrich（AI 结构补齐，依赖 bootstrap 产出的候选 ID）
   *   Phase 1: loadSkill（并行加载语言参考 Skill，用于润色提示）
   *   Phase 2: refine（AI 内容润色，依赖 enrich + loadSkill）
   */
  #registerBuiltinPipelines() {
    const hasAI = !!this.#aiProvider;

    // ── bootstrap_full_pipeline (DAG) ──────────────────────
    this.registerPipeline(new TaskPipeline('bootstrap_full_pipeline', [
      {
        name: 'bootstrap',
        tool: 'bootstrap_knowledge',
        params: {
          maxFiles: (ctx) => ctx._inputs.maxFiles || 500,
          skipGuard: (ctx) => ctx._inputs.skipGuard || false,
          contentMaxLines: (ctx) => ctx._inputs.contentMaxLines || 120,
          loadSkills: true,
        },
      },
      {
        name: 'enrich',
        tool: 'enrich_candidate',
        dependsOn: ['bootstrap'],
        params: {
          candidateIds: (ctx) => {
            const bc = ctx._results.bootstrap?.bootstrapCandidates;
            return bc?.ids || bc?.candidateIds || [];
          },
        },
        when: (ctx) => {
          const ids = ctx._results.bootstrap?.bootstrapCandidates?.ids
            || ctx._results.bootstrap?.bootstrapCandidates?.candidateIds;
          return Array.isArray(ids) && ids.length > 0;
        },
        errorStrategy: 'continue',
      },
      {
        name: 'loadSkill',
        tool: 'load_skill',
        dependsOn: ['bootstrap'],
        params: {
          skillName: (ctx) => {
            const loaded = ctx._results.bootstrap?.skillsLoaded || [];
            return loaded.find(s => s.startsWith('autosnippet-reference-')) || 'autosnippet-coldstart';
          },
        },
        when: (ctx) => {
          const autoRefine = ctx._inputs.autoRefine;
          return autoRefine !== false && hasAI;
        },
        errorStrategy: 'continue',
      },
      {
        name: 'refine',
        tool: 'refine_bootstrap_candidates',
        dependsOn: ['enrich', 'loadSkill'],
        params: {
          userPrompt: (ctx) => {
            const parts = [];

            // Skill 业界标准参考
            const skillContent = ctx._results.loadSkill?.content;
            if (skillContent) {
              parts.push(`请参考以下业界最佳实践标准润色候选，确保 summary 精准、tags 丰富、confidence 合理:\n${skillContent.substring(0, 3000)}`);
            }

            // AST 代码结构分析 — 帮助 AI 理解继承体系和设计模式
            const astCtx = ctx._results.bootstrap?.astContext;
            if (astCtx) {
              parts.push(`\n# 项目代码结构分析 (Tree-sitter AST)\n以下是项目的 AST 分析结果，请在润色时参考类继承关系、设计模式和代码质量指标:\n${astCtx.substring(0, 2000)}`);
            }

            return parts.length > 0 ? parts.join('\n\n') : ctx._inputs.refinePrompt;
          },
        },
        when: (ctx) => {
          const autoRefine = ctx._inputs.autoRefine;
          const created = ctx._results.bootstrap?.bootstrapCandidates?.created || 0;
          return autoRefine !== false && created > 0 && hasAI;
        },
        errorStrategy: 'continue',
      },
    ]));
  }

  // ─── ReAct 内部方法 ────────────────────────────────────

  /**
   * 构建系统提示词（含工具描述 + Skills 感知）
   *
   * 工具注入策略（Lazy Tool Schema — 类似 Cline .clinerules 按需加载）:
   *   - 首屏只注入工具名 + 一行描述（compact list）
   *   - 系统提示词中告知 LLM 可通过 get_tool_details 获取完整参数
   *   - 少量核心工具（search_knowledge, submit_with_check, analyze_code,
   *     bootstrap_knowledge, load_skill, suggest_skills）直接展开完整 schema
   *
   * 效果: 39 个工具的 prompt 从 ~5000 tokens 降到 ~1500 tokens
   */
  #buildSystemPrompt(toolSchemas) {
    // 核心工具 — 使用最频繁，直接展示完整 schema
    const coreTools = new Set([
      'search_knowledge', 'submit_with_check', 'analyze_code',
      'bootstrap_knowledge', 'load_skill', 'suggest_skills',
      'create_skill', 'knowledge_overview', 'get_tool_details',
    ]);

    const compactDescriptions = [];
    const detailedDescriptions = [];

    for (const t of toolSchemas) {
      if (coreTools.has(t.name)) {
        const paramsDesc = Object.entries(t.parameters.properties || {})
          .map(([k, v]) => `    - ${k} (${v.type}): ${v.description || ''}`)
          .join('\n');
        detailedDescriptions.push(`- **${t.name}**: ${t.description}\n  Parameters:\n${paramsDesc || '    (none)'}`);
      } else {
        compactDescriptions.push(`- ${t.name}: ${t.description}`);
      }
    }

    const toolDescriptions = `### 核心工具（完整参数）\n\n${detailedDescriptions.join('\n\n')}\n\n### 其他工具（调用 get_tool_details 获取参数详情）\n\n${compactDescriptions.join('\n')}`;

    // Skills 清单 — 让 LLM 知道有哪些领域知识可加载
    const skillList = this.#listAvailableSkills();
    const skillSection = skillList.length > 0
      ? `\n## 可用 Skills\n通过 load_skill 工具按需加载领域知识文档，获取操作指南和最佳实践参考。\n\n| Skill | 说明 |\n|---|---|\n${skillList.map(s => `| ${s.name} | ${s.summary || '-'} |`).join('\n')}\n\n**场景 → Skill 推荐**：\n- 冷启动、初始化 → autosnippet-coldstart\n- 深度项目分析 → autosnippet-analysis\n- 候选生成 → autosnippet-candidates + autosnippet-create\n- 代码规范审计 → autosnippet-guard\n- Snippet 概念解释 → autosnippet-concepts\n- 生命周期管理 → autosnippet-lifecycle\n- Swift/ObjC/JS·TS 语言参考 → autosnippet-reference-{swift,objc,jsts}\n- 项目结构分析 → autosnippet-structure\n- 不确定该用哪个 → autosnippet-intent\n`
      : '';

    // SOUL — AI 人格注入（如果 SOUL.md 存在）
    let soulSection = '';
    try {
      if (fs.existsSync(SOUL_PATH)) {
        soulSection = '\n' + fs.readFileSync(SOUL_PATH, 'utf-8').trim() + '\n';
      }
    } catch { /* SOUL.md not available */ }

    return `${soulSection}
你是 AutoSnippet 项目的统一 AI 中心。项目内所有 AI 推理和分析都通过你执行。
你拥有 ${toolSchemas.length} 个工具覆盖知识库管理全链路：搜索、提交、审核、质量评估、Guard 检查、知识图谱、冷启动等。
${this.#projectBriefingCache}${this.#memory?.toPromptSection({ source: this.#currentSource === 'system' ? undefined : 'user' }) || ''}
可用工具:

${toolDescriptions}
${skillSection}
## 使用规则
1. 当用户的问题需要查询数据时，使用工具获取信息后再回答。
2. 调用工具时，使用以下格式（必须严格遵循）:

\`\`\`action
{"tool": "tool_name", "params": {"key": "value"}}
\`\`\`

3. 每次只调用一个工具。
4. 如果不需要工具就能回答，直接回答，不要输出 action 块。
5. 回答时使用用户的语言（中文/英文）。
6. 回答要简洁、有依据（引用工具返回的数据）。
7. 当涉及以下领域问题时，**必须**先 load_skill 加载对应 Skill，再执行操作：
   - 冷启动/初始化 → load_skill("autosnippet-coldstart")
   - 深度分析/扫描 → load_skill("autosnippet-analysis")
   - 候选创建/提交 → load_skill("autosnippet-candidates")
   - 代码规范/Guard → load_skill("autosnippet-guard")
   - 不确定做什么 → load_skill("autosnippet-intent")
8. 你可以组合多个工具完成复杂任务（如：查重 → 提交 → 质量评分 → 知识图谱关联）。
9. 当工具返回 _meta.confidence = "none" 时，告知用户无匹配并建议下一步，不要凭空编造。当 _meta.confidence = "low" 时，明确标注结果不确定性。
10. 优先使用组合工具（analyze_code, knowledge_overview, submit_with_check）减少调用轮次。
11. 当你发现用户在重复解释编码规范、操作约定或项目特有模式时，主动调用 suggest_skills 检查是否需要创建 Skill。如果有高优先级建议，向用户说明并在确认后调用 create_skill 创建。
12. 当对话中出现值得长期记忆的信息（用户偏好、项目规范、关键决策、技术栈事实），在回复中嵌入记忆标签：\`[MEMORY:type] 内容 [/MEMORY]\`，type 可选 preference/decision/context。这些标签会被自动提取并持久化，不会显示给用户。`;
  }

  /**
   * 从 LLM 响应中解析 Action 块
   * 格式: ```action\n{"tool":"...", "params":{...}}\n```
   */
  #parseAction(response) {
    if (!response) return null;

    // 尝试匹配 ```action ... ``` 代码块
    const blockMatch = response.match(/```action\s*\n?([\s\S]*?)```/);
    if (blockMatch) {
      try {
        const parsed = JSON.parse(blockMatch[1].trim());
        if (parsed.tool && this.#toolRegistry.has(parsed.tool)) {
          return { tool: parsed.tool, params: parsed.params || {} };
        }
      } catch { /* parse failed */ }
    }

    // 降级: 尝试匹配 JSON-like 结构 {"tool": "...", "params": {...}}
    const jsonMatch = response.match(/\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"params"\s*:\s*(\{[\s\S]*?\})\s*\}/);
    if (jsonMatch) {
      try {
        const tool = jsonMatch[1];
        const params = JSON.parse(jsonMatch[2]);
        if (this.#toolRegistry.has(tool)) {
          return { tool, params };
        }
      } catch { /* parse failed */ }
    }

    return null;
  }

  /**
   * 清理最终回答（去除 Thought/preamble + MEMORY 标签）
   */
  #cleanFinalAnswer(response) {
    if (!response) return '';
    return response
      .replace(/^(Final Answer|最终回答|Answer)\s*[:：]\s*/i, '')
      .replace(/\[MEMORY:\w+\]\s*[\s\S]*?\s*\[\/MEMORY\]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 获取工具执行上下文
   */
  #getToolContext() {
    return {
      container: this.#container,
      aiProvider: this.#aiProvider,
      projectRoot: this.#container?.singletons?._projectRoot || process.cwd(),
      logger: this.#logger,
      source: this.#currentSource,
    };
  }

  /**
   * 列出可用的 Skills 及其摘要（用于系统提示词）
   * 加载顺序: 内置 skills/ → 项目级 .autosnippet/skills/（同名覆盖）
   * @returns {{ name: string, summary: string }[]}
   */
  #listAvailableSkills() {
    const skillMap = new Map();

    // 1. 内置 Skills
    this.#loadSkillsFromDir(SKILLS_DIR, skillMap);

    // 2. 项目级 Skills（覆盖同名内置 Skill）
    const projectSkillsDir = path.resolve(PROJECT_ROOT, '.autosnippet', 'skills');
    this.#loadSkillsFromDir(projectSkillsDir, skillMap);

    return Array.from(skillMap.values());
  }

  /**
   * 从目录加载 Skills 到 Map
   */
  #loadSkillsFromDir(dir, skillMap) {
    try {
      const dirs = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      for (const name of dirs) {
        const skillPath = path.join(dir, name, 'SKILL.md');
        let summary = '';
        try {
          const raw = fs.readFileSync(skillPath, 'utf-8');
          const fmMatch = raw.match(/^---[\s\S]*?description:\s*["']?(.+?)["']?\s*$/m);
          if (fmMatch) {
            summary = fmMatch[1];
          } else {
            const lines = raw.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
                summary = trimmed.length > 80 ? trimmed.substring(0, 80) + '...' : trimmed;
                break;
              }
            }
          }
        } catch { /* SKILL.md not found */ }
        skillMap.set(name, { name, summary });
      }
    } catch { /* directory not found */ }
  }

  /**
   * 构建项目概况注入到系统提示词（每次 execute 刷新一次）
   * 单次 SQL 聚合 < 5ms，静默降级
   */
  async #buildProjectBriefing() {
    try {
      const db = this.#container?.get('database');
      if (!db) return '';
      // knowledge_type → kind 映射:
      //   rule: code-standard, code-style, best-practice, boundary-constraint
      //   pattern: code-pattern, architecture, solution
      //   fact: code-relation, inheritance, call-chain, data-flow, module-dependency
      const stats = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM recipes) as recipeCount,
          (SELECT COUNT(*) FROM recipes WHERE knowledge_type IN ('code-standard','code-style','best-practice','boundary-constraint')) as ruleCount,
          (SELECT COUNT(*) FROM recipes WHERE knowledge_type IN ('code-pattern','architecture','solution')) as patternCount,
          (SELECT COUNT(*) FROM recipes WHERE knowledge_type IN ('code-relation','inheritance','call-chain','data-flow','module-dependency')) as factCount,
          (SELECT COUNT(*) FROM recipes WHERE knowledge_type = 'boundary-constraint') as guardRuleCount,
          (SELECT COUNT(*) FROM candidates WHERE status='pending') as pendingCandidates,
          (SELECT COUNT(*) FROM candidates) as totalCandidates
      `).get();
      if (!stats || stats.recipeCount === 0) {
        return '\n## 项目状态\n⚠️ 知识库为空。建议先执行冷启动（bootstrap_knowledge）。\n';
      }
      let section = `\n## 项目状态\n- 知识库: ${stats.recipeCount} 条 Recipe（${stats.ruleCount || 0} rule / ${stats.patternCount || 0} pattern / ${stats.factCount || 0} fact）\n- Guard 规则: ${stats.guardRuleCount || 0} 条\n- 候选: ${stats.pendingCandidates} 条待审 / ${stats.totalCandidates} 条总计\n`;
      if (stats.pendingCandidates > 10) {
        section += `\n⚠️ 有 ${stats.pendingCandidates} 条候选积压，建议执行批量审核。\n`;
      }
      return section;
    } catch {
      return ''; // DB 不可用时静默降级
    }
  }

  /**
   * 从对话中提取值得记忆的信息写入 Memory
   *
   * 双层策略:
   *   1. 规则快速匹配（零延迟，覆盖明确的中英文模式）
   *   2. AI 驱动提取（异步后台，从 reply 中提取 [MEMORY] 标签）
   *
   * source 隔离: 标记 memory 来源，避免系统分析污染用户记忆
   */
  #extractMemory(prompt, reply) {
    if (!this.#memory) return;
    const source = this.#currentSource || 'user';

    try {
      // ── 层 1: 规则快速匹配（中文 + 英文） ──
      const prefPatterns = [
        /我们(项目|团队)?(不用|不使用|禁止|避免|偏好|习惯|规范是)/,
        /以后(都|请|要)/,
        /记住/,
        /we\s+(don'?t|never|always|prefer|avoid)\s+use/i,
        /remember\s+(to|that)/i,
        /our\s+(convention|standard|rule)\s+is/i,
      ];
      if (prefPatterns.some(p => p.test(prompt))) {
        this.#memory.append({
          type: 'preference',
          content: prompt.substring(0, 200),
          source,
          ttl: 30,
        });
      }

      const decisionPatterns = [
        /决定(了|用|采用|使用)/,
        /(确认|同意|通过)(了|这个方案|审核)/,
        /就(这样|这么)(做|定|办)/,
        /let'?s\s+(go\s+with|use|adopt)/i,
        /approved|confirmed|decided/i,
      ];
      if (decisionPatterns.some(p => p.test(prompt))) {
        this.#memory.append({
          type: 'decision',
          content: prompt.substring(0, 200),
          source,
          ttl: 60,
        });
      }

      // ── 层 2: 从 AI reply 中提取 [MEMORY] 标签 ──
      // AI 可在回复中嵌入: [MEMORY:preference] 内容 [/MEMORY]
      if (reply) {
        const memoryTagRegex = /\[MEMORY:(\w+)\]\s*([\s\S]*?)\s*\[\/MEMORY\]/g;
        let match;
        while ((match = memoryTagRegex.exec(reply)) !== null) {
          const type = match[1]; // preference | decision | context
          const content = match[2].trim();
          if (content && ['preference', 'decision', 'context'].includes(type)) {
            this.#memory.append({
              type,
              content: content.substring(0, 200),
              source,
              ttl: type === 'context' ? 90 : type === 'decision' ? 60 : 30,
            });
          }
        }
      }
    } catch { /* memory write failure is non-critical */ }
  }

  /**
   * 自动压缩过长的对话（异步后台执行）
   * 当对话消息数超过 12 条时触发 AI 摘要压缩
   */
  async #autoSummarize(conversationId) {
    if (!this.#conversations || !this.#aiProvider) return;
    try {
      const messages = this.#conversations.load(conversationId, { tokenBudget: Infinity });
      if (messages.length >= 12) {
        await this.#conversations.summarize(conversationId, {
          aiProvider: this.#aiProvider,
        });
      }
    } catch {
      // 摘要失败不影响主流程
    }
  }

  /**
   * 事件驱动入口（P2 预留接口）
   * @param {{ type: string, payload: object, source?: string }} event
   */
  async executeEvent(event) {
    const { type, payload } = event;
    const prompt = this.#eventToPrompt(type, payload);
    return this.execute(prompt, { history: [], source: 'system' });
  }

  #eventToPrompt(type, payload) {
    switch (type) {
      case 'file_saved':
        return `文件 ${payload.filePath} 刚被保存，变更了 ${payload.changedLines} 行。请分析是否有值得提取为 Recipe 的代码模式。如果有，说明原因；没有就说"无需操作"。`;
      case 'candidate_backlog':
        return `当前有 ${payload.count} 条候选积压（最早 ${payload.oldest}）。请按质量分类：哪些值得审核、哪些可以直接拒绝、哪些需要补充信息。`;
      case 'scheduled_health':
        return `请执行知识库健康检查：Recipe 覆盖率、过时标记、Guard 规则有效性。给出简要报告。`;
      default:
        return `事件: ${type}\n${JSON.stringify(payload)}`;
    }
  }

  /**
   * Context Window 自动压缩（受 Cline AutoCondense 启发）
   *
   * 在 ReAct 循环中实时检测消息总 token 数。
   * 当超过 TOKEN_BUDGET 时，保留:
   *   - 首条消息（可能是 system / 用户首问）
   *   - 最后 4 条消息（当前推理上下文）
   * 中间消息压缩为一条摘要。
   *
   * 策略: 非阻塞、纯规则（不调 AI），避免 ReAct 循环内引入额外 AI 调用。
   */
  #condenseIfNeeded(messages, tokenBudget = 10000) {
    const estimateTokens = (text) => Math.ceil((text || '').length / 3.5);

    let totalTokens = 0;
    for (const m of messages) totalTokens += estimateTokens(m.content);

    if (totalTokens <= tokenBudget || messages.length <= 6) return;

    // 保留首条 + 最后 4 条，压缩中间
    const keepTail = 4;
    const first = messages[0];
    const tail = messages.slice(-keepTail);
    const middle = messages.slice(1, -keepTail);

    if (middle.length === 0) return;

    // 生成摘要
    const toolCallSummary = middle
      .filter(m => m.role === 'user' && m.content.startsWith('Observation from tool'))
      .map(m => {
        const toolMatch = m.content.match(/Observation from tool "([^"]+)"/);
        return toolMatch ? toolMatch[1] : null;
      })
      .filter(Boolean);

    const condensed = {
      role: 'system',
      content: `[上下文压缩] 省略了 ${middle.length} 条中间消息（含工具调用: ${toolCallSummary.join(', ') || '无'}）。请基于最近的 observation 继续推理。`,
    };

    // 原地修改数组
    messages.length = 0;
    messages.push(first, condensed, ...tail);

    this.#logger.debug(`[ChatAgent] condensed ${middle.length} messages (${totalTokens} → ~${estimateTokens(first.content) + estimateTokens(condensed.content) + tail.reduce((s, m) => s + estimateTokens(m.content), 0)} tokens)`);
  }

  /**
   * 截断长文本
   */
  #truncate(text, maxLen = 4000) {
    if (!text || text.length <= maxLen) return text;
    return text.substring(0, maxLen) + `\n...(truncated, ${text.length - maxLen} chars omitted)`;
  }

  /**
   * 精简工具结果（避免过长的 observation）
   */
  #summarizeResult(result) {
    if (!result) return null;
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    if (str.length <= 500) return result;
    // 返回截断版
    if (typeof result === 'object') {
      if (Array.isArray(result)) {
        return { _summary: `Array with ${result.length} items`, first3: result.slice(0, 3) };
      }
      // 保留 key 结构
      const keys = Object.keys(result);
      const summary = {};
      for (const k of keys) {
        const v = result[k];
        if (typeof v === 'string' && v.length > 200) {
          summary[k] = v.substring(0, 200) + '...';
        } else if (Array.isArray(v)) {
          summary[k] = { _count: v.length, first2: v.slice(0, 2) };
        } else {
          summary[k] = v;
        }
      }
      return summary;
    }
    return str.substring(0, 500);
  }
}

export default ChatAgent;
