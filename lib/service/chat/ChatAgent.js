/**
 * ChatAgent — 统一 AI Agent (ReAct 循环)
 *
 * 设计: 单 Agent + ToolRegistry 覆盖项目全部 AI 能力
 * - Dashboard Chat: execute(prompt, history) → ReAct 循环 → 自动调用工具 → 返回最终回答
 * - 程序化调用: executeTool(toolName, params) → 直接执行指定工具
 * - 批量任务: runTask(taskName, params) → 预定义任务流（查重 / 关系发现等）
 *
 * ReAct 模式:
 *   Thought → Action(tool_name, params) → Observation → ... → Answer
 *   最多 MAX_ITERATIONS 轮，防止无限循环
 */

import Logger from '../../infrastructure/logging/Logger.js';

const MAX_ITERATIONS = 6;

export class ChatAgent {
  #toolRegistry;
  #aiProvider;
  #container;
  #logger;

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
  }

  // ─── 公共 API ─────────────────────────────────────────

  /**
   * 交互式对话（Dashboard Chat 入口）
   * 自动带 ReAct 循环: LLM 可决定调用工具或直接回答
   *
   * @param {string} prompt — 用户消息
   * @param {object} opts
   * @param {Array}  opts.history — 对话历史 [{role, content}]
   * @returns {Promise<{reply: string, toolCalls: Array, hasContext: boolean}>}
   */
  async execute(prompt, { history = [] } = {}) {
    const toolSchemas = this.#toolRegistry.getToolSchemas();
    const systemPrompt = this.#buildSystemPrompt(toolSchemas);

    // 首次 LLM 调用
    const messages = [
      ...history,
      { role: 'user', content: prompt },
    ];

    const toolCalls = [];
    let iterations = 0;
    let currentPrompt = prompt;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await this.#aiProvider.chat(currentPrompt, {
        history: messages.slice(0, -1), // 不含最新 user prompt
        systemPrompt,
      });

      // 尝试解析 Action 块
      const action = this.#parseAction(response);

      if (!action) {
        // 没有 Action → 最终回答
        return {
          reply: this.#cleanFinalAnswer(response),
          toolCalls,
          hasContext: toolCalls.length > 0,
        };
      }

      // 执行工具
      this.#logger.info('ChatAgent tool call', {
        tool: action.tool,
        iteration: iterations,
      });

      const toolResult = await this.#toolRegistry.execute(
        action.tool,
        action.params,
        this.#getToolContext(),
      );

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
    }

    // 达到最大迭代次数，要求 LLM 总结
    const summaryPrompt = `You have used ${iterations} tool calls. Summarize what you found and answer the user's original question: "${prompt}"`;
    const finalResponse = await this.#aiProvider.chat(summaryPrompt, {
      history: messages,
      systemPrompt: '直接回答用户问题，不要再调用工具。',
    });

    return {
      reply: this.#cleanFinalAnswer(finalResponse),
      toolCalls,
      hasContext: toolCalls.length > 0,
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

  /**
   * 预定义任务流
   * 将常见多步骤操作封装为一个任务名
   */
  async runTask(taskName, params = {}) {
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
      ],
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

    // 获取所有 recipe
    const { items = [], data = [] } = await recipeService.listRecipes({}, { page: 1, pageSize: 500 });
    const recipes = items.length > 0 ? items : data;
    if (recipes.length < 2) return { discovered: 0, message: 'Need at least 2 recipes' };

    // 按 batch 分组分析
    const pairs = [];
    for (let i = 0; i < recipes.length; i++) {
      for (let j = i + 1; j < recipes.length; j++) {
        pairs.push([recipes[i], recipes[j]]);
      }
    }

    let discovered = 0;
    const results = [];

    // 分批处理
    for (let b = 0; b < pairs.length; b += batchSize) {
      const batch = pairs.slice(b, b + batchSize);
      const result = await this.executeTool('discover_relations', {
        recipePairs: batch.map(([a, b]) => ({
          a: { id: a.id, title: a.title, category: a.category, language: a.language, code: (a.content || a.code || '').substring(0, 500) },
          b: { id: b.id, title: b.title, category: b.category, language: b.language, code: (b.content || b.code || '').substring(0, 500) },
        })),
      });

      if (result.relations) {
        discovered += result.relations.length;
        results.push(...result.relations);
      }
    }

    return { discovered, totalPairs: pairs.length, relations: results };
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

  // ─── ReAct 内部方法 ────────────────────────────────────

  /**
   * 构建系统提示词（含工具描述）
   */
  #buildSystemPrompt(toolSchemas) {
    const toolDescriptions = toolSchemas.map(t => {
      const paramsDesc = Object.entries(t.parameters.properties || {})
        .map(([k, v]) => `    - ${k} (${v.type}): ${v.description || ''}`)
        .join('\n');
      return `- **${t.name}**: ${t.description}\n  Parameters:\n${paramsDesc || '    (none)'}`;
    }).join('\n\n');

    return `你是 AutoSnippet 项目的 AI 助手。你可以调用以下工具来获取信息或执行操作:

${toolDescriptions}

## 使用规则
1. 当用户的问题需要查询数据时，使用工具获取信息后再回答。
2. 调用工具时，使用以下格式（必须严格遵循）:

\`\`\`action
{"tool": "tool_name", "params": {"key": "value"}}
\`\`\`

3. 每次只调用一个工具。
4. 如果不需要工具就能回答，直接回答，不要输出 action 块。
5. 回答时使用用户的语言（中文/英文）。
6. 回答要简洁、有依据（引用工具返回的数据）。`;
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
   * 清理最终回答（去除 Thought/preamble）
   */
  #cleanFinalAnswer(response) {
    if (!response) return '';
    // 去除 "Final Answer:" 前缀
    return response
      .replace(/^(Final Answer|最终回答|Answer)\s*[:：]\s*/i, '')
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
    };
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
