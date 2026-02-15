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
import { ContextWindow, PhaseRouter, limitToolResult } from './ContextWindow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SKILLS_DIR = path.resolve(PROJECT_ROOT, 'skills');
const SOUL_PATH = path.resolve(PROJECT_ROOT, 'SOUL.md');
const MAX_ITERATIONS = 6;
/** 系统调用 (如 bootstrap) 允许更多迭代,因为每维度需要多次 submit_candidate */
const MAX_ITERATIONS_SYSTEM = 30;
/** 原生函数调用模式下，已提交 ≥ MIN_SUBMITS_FOR_EARLY_EXIT 个候选后，连续 N 轮无新提交则提前退出 */
const MIN_SUBMITS_FOR_EARLY_EXIT = 1;
const IDLE_ROUNDS_TO_EXIT = 2;
/** 单个维度最多提交候选数量 — 超过后跳过提交返回提醒 */
const MAX_SUBMITS_PER_DIMENSION = 6;
/** 提交达到软上限后注入收尾提示的阈值 */
const SOFT_SUBMIT_LIMIT = 4;
/** 连续搜索/阅读轮次预算 — 超过后注入提交提示并切 auto */
const SEARCH_BUDGET = 8;
/** 搜索预算耗尽后，额外容忍的轮次 — 再未提交则强制退出 */
const SEARCH_BUDGET_GRACE = 4;

/** 默认预算配置 — 可通过 execute() 的 opts.budget 覆盖 */
const DEFAULT_BUDGET = Object.freeze({
  maxIterations: MAX_ITERATIONS_SYSTEM,
  searchBudget: SEARCH_BUDGET,
  searchBudgetGrace: SEARCH_BUDGET_GRACE,
  maxSubmits: MAX_SUBMITS_PER_DIMENSION,
  softSubmitLimit: SOFT_SUBMIT_LIMIT,
  idleRoundsToExit: IDLE_ROUNDS_TO_EXIT,
});

/**
 * 系统调用续跑提示 — 当 AI 输出纯文本计划而未执行工具调用时注入
 * 告诉 AI 不要只写文字描述,而要实际调用工具
 */
const SYSTEM_CONTINUATION_PROMPT = `你的分析计划很好。但你需要 **实际执行工具调用** 来完成任务,而不是只写文字描述。

请现在开始执行:
1. 用 \`search_project_code\` 搜索项目代码获取真实示例
2. 用 \`read_project_file\` 查看完整文件内容
3. 对每个值得保留的信号,用 \`submit_candidate\` 提交候选

⚡ 推荐使用 batch_actions 一次提交多条候选:
\`\`\`batch_actions
[
  {"tool": "submit_candidate", "params": {"title": "[Bootstrap] xxx/子主题", "code": "# 标题 — 项目特写\\n\\n> 摘要...\\n\\n描述和代码交织...", "language": "objectivec", "category": "Service", "summary": "...", "tags": ["bootstrap"], "source": "bootstrap", "reasoning": {"whyStandard": "...", "sources": ["file1"], "confidence": 0.7}}},
  {"tool": "submit_candidate", "params": {"title": "...", "code": "...", ...}}
]
\`\`\`

请立即开始执行,不要再输出分析文字。`;

/**
 * 系统调用提交提示 — 当 AI 做了工具调用(search/read)、写了分析文本,但没调 submit_candidate 时注入
 * 引导 AI 将已有分析转化为实际的 submit_candidate 调用
 */
const SYSTEM_SUBMIT_PROMPT = `你的分析很好，已经获取了足够的项目信息。但你还没有调用 \`submit_candidate\` 提交任何候选。

**你的分析不能只停留在文字描述层面** — 必须通过工具调用将分析结果持久化。

请根据你刚才的分析,立即使用 batch_actions 提交候选:

\`\`\`batch_actions
[
  {"tool": "submit_candidate", "params": {
    "title": "[Bootstrap] 维度/子主题",
    "code": "# 标题 — 项目特写\\n\\n> 本项目使用 XX 模式, N 个文件采用此写法\\n\\n描述...\\n\\n\`\`\`objc\\n// 真实代码示例\\n\`\`\`\\n\\n要点说明...",
    "language": "objectivec",
    "category": "Tool",
    "summary": "≤80字精准摘要,引用真实类名和数字",
    "tags": ["bootstrap", "维度id"],
    "source": "bootstrap",
    "reasoning": {"whyStandard": "为什么值得保留", "sources": ["真实文件名"], "confidence": 0.7}
  }},
  {"tool": "submit_candidate", "params": {...}}
]
\`\`\`

将你上面分析出的每个有价值的发现都转化为一条 submit_candidate 调用。code 字段写「项目特写」风格: 描述和代码交织,用项目真实类名和代码。`;

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
  /** @type {Array|null} 内存文件缓存（bootstrap 场景注入，search_project_code/read_project_file 优先使用） */
  #fileCache = null;
  /** @type {Set<string>} 跨维度已提交候选标题（bootstrap 全局去重） */
  #globalSubmittedTitles = new Set();

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

    /**
     * 是否有真实（非 Mock）AI Provider
     * MockProvider 不具备实际推理能力，bootstrap 编排时应视为 AI 不可用
     */
    this.hasRealAI = !!aiProvider && aiProvider.name !== 'mock';

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
   * 注入内存文件缓存（bootstrap 场景: allFiles 已在内存中，避免重复磁盘读取）
   * 调用后 search_project_code / read_project_file 优先从缓存查找
   * @param {Array|null} files — [{ relativePath, content, name }]
   */
  setFileCache(files) {
    this.#fileCache = files;
  }

  /**
   * 重置跨维度全局提交标题（新 bootstrap session 开始时调用）
   */
  resetGlobalSubmittedTitles() {
    this.#globalSubmittedTitles.clear();
  }

  /**
   * 交互式对话（Dashboard Chat 入口）
   * 自动带 ReAct 循环: LLM 可决定调用工具或直接回答
   *
   * @param {string} prompt — 用户消息
   * @param {object} opts
   * @param {Array}  opts.history — 对话历史 [{role, content}]
   * @param {string} [opts.conversationId] — 对话 ID（启用持久化时）
   * @param {'user'|'system'} [opts.source='user'] — 调用来源（影响 Memory 隔离）
   * @param {object} [opts.dimensionMeta] — Bootstrap 维度元数据 { id, outputType, allowedKnowledgeTypes }
   * @returns {Promise<{reply: string, toolCalls: Array, hasContext: boolean, conversationId?: string}>}
   */
  async execute(prompt, { history = [], conversationId, source = 'user', budget: budgetOverrides, dimensionId, dimensionMeta } = {}) {
    this.#currentSource = source;
    const execStartTime = Date.now();
    const promptPreview = prompt.length > 80 ? prompt.substring(0, 80) + '…' : prompt;
    this.#logger.info(`[ChatAgent] ▶ execute — source=${source}${dimensionMeta?.id ? ', dim=' + dimensionMeta.id + '(' + dimensionMeta.outputType + ')' : (dimensionId ? ', dim=' + dimensionId : '')}, prompt="${promptPreview}", historyLen=${history.length}${conversationId ? ', convId=' + conversationId.substring(0, 8) : ''}`);

    // 合并预算配置: 默认值 + 外部覆盖
    const budget = budgetOverrides
      ? { ...DEFAULT_BUDGET, ...budgetOverrides }
      : { ...DEFAULT_BUDGET };

    // 对话持久化: 如果传了 conversationId，从 ConversationStore 加载历史
    let effectiveHistory = history;
    if (conversationId && this.#conversations) {
      effectiveHistory = this.#conversations.load(conversationId);
      this.#logger.info(`[ChatAgent] loaded ${effectiveHistory.length} messages from conversation store`);
      this.#conversations.append(conversationId, { role: 'user', content: prompt });
    }

    // 每次对话刷新项目概况（不是每轮 ReAct）
    this.#projectBriefingCache = await this.#buildProjectBriefing();

    // ── 双模路由: 原生函数调用 vs 文本解析 ──
    // 支持原生函数调用的 Provider (如 Gemini) 走结构化路径，
    // 其他 Provider 走传统文本 ReAct 解析路径
    let result;
    if (this.#aiProvider.supportsNativeToolCalling) {
      this.#logger.info(`[ChatAgent] ✨ using NATIVE tool calling mode (${this.#aiProvider.name})`);
      result = await this.#executeWithNativeTools(prompt, {
        effectiveHistory, conversationId, source, execStartTime, budget, dimensionMeta,
      });
    } else {
      this.#logger.info(`[ChatAgent] 📝 using TEXT parsing mode (${this.#aiProvider.name})`);
      result = await this.#executeWithTextParsing(prompt, {
        effectiveHistory, conversationId, source, execStartTime,
      });
    }

    // 持久化 assistant 回复
    if (conversationId && this.#conversations) {
      this.#conversations.append(conversationId, { role: 'assistant', content: result.reply });
      this.#autoSummarize(conversationId).catch(err => {
        this.#logger.debug('[ChatAgent] autoSummarize failed', { conversationId, error: err.message });
      });
    }

    this.#extractMemory(prompt, result.reply);

    return { ...result, conversationId };
  }

  // ─── Native Tool Calling ReAct 循环 ──────────────────────

  /**
   * 原生结构化函数调用 ReAct 循环 (v9 — 三层架构重构)
   *
   * 基于业界最佳实践:
   *   - OpenAI Compaction: 阈值触发自动压缩，保留关键上下文
   *   - LangChain trim_messages: 按 token 原子轮次裁剪
   *   - Anthropic: 长文档前置，查询后置
   *   - Gemini: functionResponse 必须紧跟 functionCall
   *
   * 三层架构:
   *   1. ContextWindow — 消息生命周期 + 三级递进压缩
   *   2. PhaseRouter — 阶段状态机 (EXPLORE→PRODUCE→SUMMARIZE)
   *   3. ToolResultLimiter — 工具结果入口压缩 (动态配额)
   *
   * @param {string} prompt
   * @param {object} opts
   * @returns {Promise<{reply: string, toolCalls: Array, hasContext: boolean}>}
   */
  async #executeWithNativeTools(prompt, { effectiveHistory, conversationId, source, execStartTime, budget = DEFAULT_BUDGET, dimensionMeta }) {
    const isSystem = source === 'system';
    const isSkillOnly = dimensionMeta?.outputType === 'skill';
    const temperature = isSystem ? 0.3 : 0.7;

    // ── Layer 1: ContextWindow ──
    // messages[0] = prompt（不可压缩），历史消息在前面
    const ctx = new ContextWindow(isSystem ? 24000 : 16000);
    for (const h of effectiveHistory) {
      if (h.role === 'assistant') {
        ctx.appendAssistantText(h.content);
      } else {
        ctx.appendUserMessage(h.content);
      }
    }
    // prompt 作为最终 user message（Anthropic 最佳实践: 查询放在所有上下文之后）
    ctx.appendUserMessage(prompt);

    // ── P5: Pre-check — 首条 prompt 过大时预警 ──
    const initialUsage = ctx.getTokenUsageRatio();
    if (initialUsage > 0.7) {
      this.#logger.warn(`[ChatAgent] ⚠ initial prompt already at ${(initialUsage * 100).toFixed(0)}% of token budget (${ctx.estimateTokens()}/${ctx.tokenBudget})`);
      if (initialUsage > 0.9 && isSystem) {
        // 仅 1 条消息时 compactIfNeeded 无法压缩（需 >4 条），
        // 依赖 P0/P1 信号限制来控制 prompt 大小
        this.#logger.warn(`[ChatAgent] ⚠ prompt exceeds 90% budget — P0/P1 signal limiting should have prevented this. Check PROMPT_LIMITS config.`);
      }
    }

    // ── Layer 2: PhaseRouter (仅 system 源使用) ──
    const phaseRouter = isSystem ? new PhaseRouter(budget, isSkillOnly) : null;

    // ── 系统提示词 ──
    const baseSystemPrompt = this.#buildNativeToolSystemPrompt(budget);

    // Bootstrap 场景限制可用工具集
    const bootstrapTools = isSystem ? [
      'search_project_code', 'read_project_file',
      'submit_candidate', 'submit_with_check',
    ] : null;
    const toolSchemas = this.#toolRegistry.getToolSchemas(bootstrapTools);

    const toolCalls = [];
    const maxIter = isSystem ? budget.maxIterations : MAX_ITERATIONS;
    let consecutiveAiErrors = 0;
    let consecutiveEmptyResponses = 0;
    const submittedTitles = new Set(this.#globalSubmittedTitles);

    // ── 主循环 ──
    while (true) {
      // PhaseRouter tick + 退出检查
      if (phaseRouter) {
        phaseRouter.tick();
        if (phaseRouter.shouldExit()) {
          this.#logger.info(`[ChatAgent] PhaseRouter exit: phase=${phaseRouter.phase}, iter=${phaseRouter.totalIterations}, submits=${phaseRouter.totalSubmits}`);
          break;
        }
      } else if (ctx.length > maxIter * 2 + 2) {
        // 用户对话模式: 简单的消息数限制
        break;
      }

      const iterStartTime = Date.now();
      const currentIter = phaseRouter?.totalIterations || (ctx.length - 1);

      // ── 动态 toolChoice (由 PhaseRouter 决定) ──
      let currentChoice;
      if (phaseRouter) {
        currentChoice = phaseRouter.getToolChoice();
      } else {
        currentChoice = 'auto';
      }

      // ── 压缩检查 (每次 AI 调用前) ──
      const compactResult = ctx.compactIfNeeded();
      if (compactResult.level > 0) {
        this.#logger.info(`[ChatAgent] context compacted: L${compactResult.level}, removed ${compactResult.removed} items`);
      }

      // ── 构建 systemPrompt (含阶段提示) ──
      let systemPrompt = baseSystemPrompt;
      if (phaseRouter) {
        const hint = phaseRouter.getPhaseHint();
        if (hint) {
          systemPrompt += `\n\n## 当前状态\n${hint}`;
        }
      }

      // ── AI 调用 ──
      let aiResult;
      try {
        const messages = ctx.toMessages();
        this.#logger.info(`[ChatAgent] 🔄 iteration ${currentIter}/${maxIter} — phase=${phaseRouter?.phase || 'user'}, ${messages.length} msgs, toolChoice=${currentChoice}, tokens~${ctx.estimateTokens()}`);

        aiResult = await this.#aiProvider.chatWithTools(prompt, {
          messages,
          toolSchemas,
          toolChoice: currentChoice,
          systemPrompt,
          temperature,
          maxTokens: 8192,
        });

        const aiDuration = Date.now() - iterStartTime;
        if (aiResult.functionCalls?.length > 0) {
          this.#logger.info(`[ChatAgent] ✓ AI returned ${aiResult.functionCalls.length} function calls in ${aiDuration}ms: [${aiResult.functionCalls.map(fc => fc.name).join(', ')}]`);
        } else {
          const textPreview = (aiResult.text || '').substring(0, 120).replace(/\n/g, '↵');
          this.#logger.info(`[ChatAgent] ✓ AI returned text in ${aiDuration}ms (${(aiResult.text || '').length} chars) — "${textPreview}…"`);
        }
        consecutiveAiErrors = 0;
      } catch (aiErr) {
        consecutiveAiErrors++;
        this.#logger.warn(`[ChatAgent] AI call failed (attempt ${consecutiveAiErrors}): ${aiErr.message}`);

        if (consecutiveAiErrors >= 2) {
          if (isSystem) {
            this.#logger.warn(`[ChatAgent] 🛑 2 consecutive AI errors — resetting context, breaking to summary`);
            ctx.resetToPromptOnly();
            break;
          }
          return {
            reply: `抱歉，AI 服务暂时不可用（${aiErr.message}）。请稍后重试，或检查 API 配置。`,
            toolCalls,
            hasContext: toolCalls.length > 0,
          };
        }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // ── 处理 functionCalls ──
      if (aiResult.functionCalls && aiResult.functionCalls.length > 0) {
        // 限制单次工具调用数量（防上下文溢出）
        const MAX_TOOL_CALLS_PER_ITER = 8;
        let activeCalls = aiResult.functionCalls;
        if (activeCalls.length > MAX_TOOL_CALLS_PER_ITER) {
          this.#logger.warn(`[ChatAgent] ⚠ ${activeCalls.length} tool calls, capping to ${MAX_TOOL_CALLS_PER_ITER}`);
          activeCalls = activeCalls.slice(0, MAX_TOOL_CALLS_PER_ITER);
        }

        // ContextWindow: 原子追加 assistant + tool results
        ctx.appendAssistantWithToolCalls(aiResult.text || null, activeCalls);

        let roundSubmitCount = 0;

        for (const fc of activeCalls) {
          const toolStartTime = Date.now();
          this.#logger.info(`[ChatAgent] 🔧 ${fc.name}(${JSON.stringify(fc.args).substring(0, 100)})`);

          let toolResult;
          try {
            toolResult = await this.#toolRegistry.execute(
              fc.name,
              fc.args,
              this.#getToolContext({ _sessionToolCalls: toolCalls, _dimensionMeta: dimensionMeta }),
            );
            const toolDuration = Date.now() - toolStartTime;
            const resultSize = typeof toolResult === 'string' ? toolResult.length : JSON.stringify(toolResult).length;
            this.#logger.info(`[ChatAgent] 🔧 done: ${fc.name} → ${resultSize} chars in ${toolDuration}ms`);
          } catch (toolErr) {
            this.#logger.warn(`[ChatAgent] 🔧 FAILED: ${fc.name} — ${toolErr.message}`);
            toolResult = { error: `tool "${fc.name}" failed: ${toolErr.message}` };
          }

          // 记录到全局 toolCalls
          const summarized = this.#summarizeResult(toolResult);
          toolCalls.push({ tool: fc.name, params: fc.args, result: summarized });

          // ── Layer 3: ToolResultLimiter — 动态配额压缩 ──
          const quota = ctx.getToolResultQuota();
          let resultStr = limitToolResult(fc.name, toolResult, quota);

          // ── 重复提交 / 维度范围校验 ──
          if (fc.name === 'submit_candidate' || fc.name === 'submit_with_check') {
            const title = fc.args?.title || fc.args?.category || '';
            const isRejected = typeof toolResult === 'object' && toolResult?.status === 'rejected';

            if (isRejected) {
              this.#logger.info(`[ChatAgent] 🚫 off-topic rejected: "${title}"`);
            } else if (submittedTitles.has(title)) {
              resultStr = `⚠ 重复提交: "${title}" 已存在。`;
              this.#logger.info(`[ChatAgent] 🔁 duplicate: "${title}"`);
            } else {
              submittedTitles.add(title);
              this.#globalSubmittedTitles.add(title);
              roundSubmitCount++;
            }
          }

          // ContextWindow: 追加 tool result（与 assistant 保持原子性）
          ctx.appendToolResult(fc.id, fc.name, resultStr);
        }

        // ── PhaseRouter 更新 ──
        if (phaseRouter) {
          phaseRouter.update({
            functionCalls: activeCalls,
            submitCount: roundSubmitCount,
            isTextOnly: false,
          });
        }

        continue;
      }

      // ── 文字回答 ──
      // 空响应重试（Gemini 偶发）
      if (!aiResult.text && isSystem && consecutiveEmptyResponses < 2) {
        consecutiveEmptyResponses++;
        this.#logger.warn(`[ChatAgent] ⚠ empty response from system source — retrying (${consecutiveEmptyResponses}/2)`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      // 收到非空响应时重置空响应计数器
      if (aiResult.text) {
        consecutiveEmptyResponses = 0;
      }

      // PhaseRouter: 文字回答触发阶段转换
      if (phaseRouter) {
        const transition = phaseRouter.update({
          functionCalls: null,
          submitCount: 0,
          isTextOnly: true,
        });

        // SUMMARIZE 阶段的文字回答 = 最终回答
        if (phaseRouter.phase === 'SUMMARIZE' || !transition.transitioned) {
          const reply = this.#cleanFinalAnswer(aiResult.text || '');
          const totalDuration = Date.now() - execStartTime;
          this.#logger.info(`[ChatAgent] ✅ final answer — ${reply.length} chars, ${phaseRouter.totalIterations} iters, ${toolCalls.length} tool calls, ${totalDuration}ms`);
          return { reply, toolCalls, hasContext: toolCalls.length > 0 };
        }

        // 其他阶段的文字回答 → 继续循环（PhaseRouter 已自动转换阶段）
        ctx.appendAssistantText(aiResult.text || '');
        continue;
      }

      // 用户对话: 文字回答即最终回答
      const reply = this.#cleanFinalAnswer(aiResult.text || '');
      const totalDuration = Date.now() - execStartTime;
      this.#logger.info(`[ChatAgent] ✅ final answer — ${reply.length} chars, ${toolCalls.length} tool calls, ${totalDuration}ms`);
      return { reply, toolCalls, hasContext: toolCalls.length > 0 };
    }

    // ── 循环退出: 产出 dimensionDigest 总结 ──
    return this.#produceForcedSummary({
      source, toolCalls, toolSchemas, ctx, phaseRouter, execStartTime,
    });
  }

  /**
   * 强制退出后的摘要生成 — 独立方法，避免主循环代码膨胀
   * @private
   */
  async #produceForcedSummary({ source, toolCalls, toolSchemas, ctx, phaseRouter, execStartTime }) {
    const iterations = phaseRouter?.totalIterations || 0;
    this.#logger.info(`[ChatAgent] ⚠ producing forced summary (${iterations} iters, ${toolCalls.length} calls)`);

    const candidateCount = toolCalls.filter(tc =>
      tc.tool === 'submit_candidate' || tc.tool === 'submit_with_check'
    ).length;

    let finalReply;
    try {
      const submitSummary = toolCalls
        .filter(tc => tc.tool === 'submit_candidate' || tc.tool === 'submit_with_check')
        .map((tc, i) => `${i + 1}. ${tc.params?.title || tc.params?.category || 'untitled'}`)
        .join('\n');

      const summaryPrompt = source === 'system'
        ? `你已完成 ${iterations} 轮工具调用（共 ${toolCalls.length} 次），提交了 ${candidateCount} 个候选。
${submitSummary ? `已提交候选:\n${submitSummary}\n` : ''}
**必须**输出 dimensionDigest JSON（用 \`\`\`json 包裹）：
\`\`\`json
{
  "dimensionDigest": {
    "summary": "本维度分析总结",
    "candidateCount": ${candidateCount},
    "keyFindings": ["发现1", "发现2"],
    "crossRefs": {},
    "gaps": ["未覆盖方面"]
  }
}
\`\`\``
        : `Completed ${iterations} iterations with ${toolCalls.length} tool calls. Please summarize.`;

      // 用空 messages 避免累积上下文导致 400
      const summaryResult = await this.#aiProvider.chatWithTools(
        summaryPrompt,
        {
          messages: [],
          toolSchemas,
          toolChoice: 'none',
          systemPrompt: '直接输出 dimensionDigest JSON 总结，不要调用工具。',
          temperature: 0.3,
          maxTokens: 8192,
        },
      );
      finalReply = this.#cleanFinalAnswer(summaryResult.text || '');
    } catch (err) {
      this.#logger.warn(`[ChatAgent] forced summary AI call failed: ${err.message}`);
      // 合成 digest 兜底
      const titles = toolCalls
        .filter(tc => tc.tool === 'submit_candidate' || tc.tool === 'submit_with_check')
        .map(tc => tc.params?.title || 'untitled');
      finalReply = `\`\`\`json
{
  "dimensionDigest": {
    "summary": "通过 ${toolCalls.length} 次工具调用分析了项目代码，提交了 ${candidateCount} 个候选。",
    "candidateCount": ${candidateCount},
    "keyFindings": ${JSON.stringify(titles.slice(0, 5))},
    "crossRefs": {},
    "gaps": ["AI 服务异常，部分分析未完成"]
  }
}
\`\`\``;
    }

    const totalDuration = Date.now() - execStartTime;
    this.#logger.info(`[ChatAgent] ✅ forced summary — ${finalReply.length} chars, ${totalDuration}ms total`);
    return { reply: finalReply, toolCalls, hasContext: toolCalls.length > 0 };
  }

  // ─── Text Parsing ReAct 循环 (legacy) ─────────────────

  /**
   * 文本解析 ReAct 循环 — 传统模式
   * 适用于不支持原生函数调用的 Provider (DeepSeek, OpenAI 兼容等)
   * AI 输出文本 → #parseActions() 正则解析 → 执行工具 → 循环
   */
  async #executeWithTextParsing(prompt, { effectiveHistory, conversationId, source, execStartTime }) {
    const toolSchemas = this.#toolRegistry.getToolSchemas();
    const systemPrompt = this.#buildSystemPrompt(toolSchemas);

    const messages = [
      ...effectiveHistory,
      { role: 'user', content: prompt },
    ];

    const toolCalls = [];
    let iterations = 0;
    let currentPrompt = prompt;
    let consecutiveAiErrors = 0;
    const maxIter = source === 'system' ? MAX_ITERATIONS_SYSTEM : MAX_ITERATIONS;

    while (iterations < maxIter) {
      iterations++;
      const iterStartTime = Date.now();

      let response;
      try {
        this.#logger.info(`[ChatAgent] 🔄 text iteration ${iterations}/${maxIter} — calling AI (${messages.length} messages)`);
        response = await this.#aiProvider.chat(currentPrompt, {
          history: messages.slice(0, -1),
          systemPrompt,
        });
        const aiDuration = Date.now() - iterStartTime;
        const responsePreview = (response || '').substring(0, 120).replace(/\n/g, '↵');
        this.#logger.info(`[ChatAgent] ✓ AI responded in ${aiDuration}ms (${(response || '').length} chars) — "${responsePreview}…"`);
        consecutiveAiErrors = 0;
      } catch (aiErr) {
        consecutiveAiErrors++;
        this.#logger.warn(`[ChatAgent] AI call failed (attempt ${consecutiveAiErrors}): ${aiErr.message}`);

        if (consecutiveAiErrors >= 2) {
          return {
            reply: `抱歉，AI 服务暂时不可用（${aiErr.message}）。请稍后重试，或检查 API 配置。`,
            toolCalls,
            hasContext: toolCalls.length > 0,
          };
        }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const actions = this.#parseActions(response);

      if (!actions) {
        // ── 系统调用自动续跑 ──
        const hasSubmits = toolCalls.some(tc => tc.tool === 'submit_candidate' || tc.tool === 'submit_with_check');
        if (source === 'system' && iterations < maxIter && !hasSubmits) {
          if (this.#looksLikeIncompleteStep(response)) {
            this.#logger.info(`[ChatAgent] 🔄 detected planning-only response at iteration ${iterations}, injecting continuation prompt`);
            messages.push({ role: 'assistant', content: response });
            currentPrompt = SYSTEM_CONTINUATION_PROMPT;
            messages.push({ role: 'user', content: currentPrompt });
            continue;
          }
          if (toolCalls.length > 0) {
            this.#logger.info(`[ChatAgent] 🔄 detected analysis-without-submission at iteration ${iterations} (${toolCalls.length} tool calls, 0 submits), injecting submission prompt`);
            messages.push({ role: 'assistant', content: response });
            currentPrompt = SYSTEM_SUBMIT_PROMPT;
            messages.push({ role: 'user', content: currentPrompt });
            continue;
          }
        }

        const reply = this.#cleanFinalAnswer(response);
        const totalDuration = Date.now() - execStartTime;
        this.#logger.info(`[ChatAgent] ✅ text final answer — ${reply.length} chars, ${iterations} iterations, ${toolCalls.length} tool calls, ${totalDuration}ms total`);

        return { reply, toolCalls, hasContext: toolCalls.length > 0 };
      }

      // 执行工具
      const isBatch = actions.length > 1;
      if (isBatch) {
        this.#logger.info(`[ChatAgent] 📦 batch tool call: ${actions.length} actions [${actions.map(a => a.tool).join(', ')}]`, { iteration: iterations });
      }

      const batchResults = [];
      for (const action of actions) {
        this.#logger.info(`[ChatAgent] 🔧 tool call: ${action.tool}(${JSON.stringify(action.params).substring(0, 100)})`, {
          iteration: iterations,
          batch: isBatch,
        });

        let toolResult;
        const toolStartTime = Date.now();
        try {
          toolResult = await this.#toolRegistry.execute(
            action.tool,
            action.params,
            this.#getToolContext({ _sessionToolCalls: toolCalls }),
          );
          const toolDuration = Date.now() - toolStartTime;
          const resultSize = typeof toolResult === 'string' ? toolResult.length : JSON.stringify(toolResult).length;
          this.#logger.info(`[ChatAgent] 🔧 tool done: ${action.tool} → ${resultSize} chars in ${toolDuration}ms`);
        } catch (toolErr) {
          this.#logger.warn(`[ChatAgent] 🔧 tool FAILED: ${action.tool} — ${toolErr.message} (${Date.now() - toolStartTime}ms)`);
          toolResult = `Error: tool "${action.tool}" failed — ${toolErr.message}. Try a different approach or provide your answer based on available information.`;
        }

        const summarized = this.#summarizeResult(toolResult);
        toolCalls.push({
          tool: action.tool,
          params: action.params,
          result: summarized,
        });
        batchResults.push({ tool: action.tool, result: toolResult });
      }

      // 将工具结果注入为下一轮 prompt
      let observation;
      if (batchResults.length === 1) {
        const r = batchResults[0];
        const obsText = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
        observation = `Observation from tool "${r.tool}":\n${this.#truncate(obsText, 4000)}`;
      } else {
        observation = `Batch observation (${batchResults.length} tools):\n` +
          batchResults.map((r, i) => {
            const obsText = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
            return `[${i + 1}] ${r.tool}: ${this.#truncate(obsText, 2000)}`;
          }).join('\n\n');
      }

      currentPrompt = `${observation}\n\nBased on the above observation, continue reasoning about the user's question: "${prompt}".\nIf you have enough information, provide your final answer directly (without Action block). Otherwise, call another tool.`;

      messages.push({ role: 'assistant', content: response });
      messages.push({ role: 'user', content: currentPrompt });

      this.#condenseIfNeeded(messages);
    }

    // 达到最大迭代次数
    const summaryPrompt = `You have used ${iterations} tool calls. Summarize what you found and answer the user's original question: "${prompt}"`;
    let finalResponse;
    try {
      finalResponse = await this.#aiProvider.chat(summaryPrompt, {
        history: messages,
        systemPrompt: '直接回答用户问题，不要再调用工具。',
      });
    } catch (err) {
      this.#logger.warn(`[ChatAgent] Final summary AI call failed: ${err.message}`);
      finalResponse = `根据 ${toolCalls.length} 次工具调用的结果，以下是收集到的信息：\n\n` +
        toolCalls.map(tc => `• ${tc.tool}: ${typeof tc.result === 'string' ? tc.result.substring(0, 200) : JSON.stringify(tc.result).substring(0, 200)}`).join('\n') +
        '\n\n（注：AI 总结服务暂时不可用，上述为原始工具输出摘要）';
    }

    const finalReply = this.#cleanFinalAnswer(finalResponse);
    return { reply: finalReply, toolCalls, hasContext: toolCalls.length > 0 };
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
   * v6 变更:
   *   - 移除旧的 4 步 DAG (bootstrap → enrich → loadSkill → refine)
   *   - 冷启动 AI 增强现在通过 orchestrator.js 中的 ChatAgent per-dimension production 完成
   *   - 保留简化版 bootstrap_full_pipeline: 只做 Phase 1-4 启发式
   *     (Phase 5 ChatAgent 生产由 orchestrator.js 管理,不再走 DAG 编排)
   */
  #registerBuiltinPipelines() {
    // ── bootstrap_full_pipeline (v6 简化版) ──────────────────
    // 只做启发式 Phase 1-5.5 (含 ChatAgent per-dimension production)
    // 不再需要 enrich/refine 后置步骤
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
    ]));
  }

  // ─── ReAct 内部方法 ────────────────────────────────────

  /**
   * 构建系统提示词（含工具描述 + Skills 感知）
   *
   * 工具注入策略（Lazy Tool Schema — 类似 Cline .clinerules 按需加载）:
   *   - 首屏只注入工具名 + 一行描述（compact list）
   *   - 系统提示词中告知 LLM 可通过 get_tool_details 获取完整参数
   *   - 少量核心工具（search_project_code, read_project_file, search_knowledge,
   *     submit_with_check, analyze_code, bootstrap_knowledge, load_skill,
   *     suggest_skills）直接展开完整 schema
   *
   * 效果: 44 个工具的 prompt 从 ~5000 tokens 降到 ~1500 tokens
   */
  #buildSystemPrompt(toolSchemas) {
    // 核心工具 — 使用最频繁，直接展示完整 schema
    const coreTools = new Set([
      'search_project_code', 'read_project_file',
      'search_knowledge', 'submit_candidate', 'submit_with_check', 'analyze_code',
      'bootstrap_knowledge', 'load_skill', 'suggest_skills',
      'create_skill', 'knowledge_overview', 'get_tool_details',
      'plan_task', 'review_my_output',
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

3. 当需要连续调用多个**同类工具**（如批量提交候选）时，可使用批量格式:

\`\`\`batch_actions
[
  {"tool": "submit_candidate", "params": {"title": "...", "code": "..."}},
  {"tool": "submit_candidate", "params": {"title": "...", "code": "..."}}
]
\`\`\`

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
   * 构建原生函数调用模式的系统提示词 (v9)
   *
   * v9 设计原则 (基于业界最佳实践):
   *   - 精简: bootstrap 模式不注入 SOUL.md 人格（节省 ~500 token）
   *   - 分层: 静态指令放 systemPrompt，动态上下文放 user prompt
   *   - 控制通过 PhaseRouter 状态机实现，不通过追加 user 消息
   *   - 工具描述已通过 functionDeclarations 传递，不重复
   */
  #buildNativeToolSystemPrompt(budget = DEFAULT_BUDGET) {
    // 用户对话模式: 完整提示词（含 SOUL、Memory、项目概况）
    if (this.#currentSource !== 'system') {
      let soulSection = '';
      try {
        if (fs.existsSync(SOUL_PATH)) {
          soulSection = '\n' + fs.readFileSync(SOUL_PATH, 'utf-8').trim() + '\n';
        }
      } catch { /* SOUL.md not available */ }

      return `${soulSection}
你是 AutoSnippet 项目的统一 AI 中心。项目内所有 AI 推理和分析都通过你执行。
${this.#projectBriefingCache}${this.#memory?.toPromptSection({ source: 'user' }) || ''}

## 使用规则
1. 当需要查询数据时，直接调用相应工具。
2. 工具参数严格按照工具声明中的 schema 传递。
3. 对于代码分析任务，先 search_project_code 搜索，再 read_project_file 读取。
4. 回答时使用用户的语言（中文/英文）。
5. 当工具返回错误时，尝试不同参数或方法。`;
    }

    // Bootstrap 系统模式: 精简提示词（~400 token）
    return `你是代码知识策展 AI。通过工具分析项目代码，产出结构化知识候选。
${this.#projectBriefingCache}

## 规则
1. 先搜索 (search_project_code) 再阅读 (read_project_file) 获取真实代码。
2. 对有价值的发现调用 submit_candidate 提交候选，code 字段用「项目特写」风格。
3. 完成后在回复中输出 dimensionDigest JSON。
4. 代码必须真实，引用具体类名和数字，不可编造。
5. 质量优先于数量，证据不足宁可不提交。
6. 一轮可调用多个工具，高效利用步数 (≤${budget.maxIterations} 轮)。`;
  }

  /**
   * 从 LLM 响应中解析 Action 块（单条）
   *
   * 兼容多家 AI 服务商的工具调用格式：
   *   1. ```action {"tool":"...", "params":{...}} ```          — 标准格式
   *   2. ```tool_code tool_name(key="value") ```               — Gemini 常用
   *   3. ```python / ```javascript 围栏内函数调用               — 各家偶发
   *   4. Action: tool_name / Action Input: {...}                — ReAct (GPT/DeepSeek)
   *   5. <tool_call>{"name":"...", "arguments":{...}}</tool_call>  — 训练遗留 XML
   *   6. ```json {"name":"...", "arguments":{...}} ```          — GPT function_call 文本化
   *   7. {"tool":"...", "params":{...}} 裸 JSON                — 通用降级
   *   8. response 末尾裸函数调用 tool_name(key="value")         — 通用降级
   */
  #parseAction(response) {
    if (!response) return null;

    // ── 1. 标准 ```action {...} ``` ──
    const blockMatch = response.match(/```action\s*\n?([\s\S]*?)```/);
    if (blockMatch) {
      const parsed = this.#tryParseToolJson(blockMatch[1].trim());
      if (parsed) return parsed;
    }

    // ── 2. ```tool_code fn(k=v) ``` (Gemini 常用) ──
    const toolCodeMatch = response.match(/```tool_code\s*\n?([\s\S]*?)```/);
    if (toolCodeMatch) {
      const parsed = this.#parseToolCodeBlock(toolCodeMatch[1].trim());
      if (parsed) return parsed;
    }

    // ── 3. ```python / ```javascript / ```js 围栏内函数调用 ──
    const langFenceMatch = response.match(/```(?:python|javascript|js|typescript|ts)\s*\n?([\s\S]*?)```/);
    if (langFenceMatch) {
      const inner = langFenceMatch[1].trim();
      const parsed = this.#parseToolCodeBlock(inner);
      if (parsed) return parsed;
      // JS 对象字面量: tool_name({key: "value"})
      const jsObjMatch = inner.match(/^(\w+)\(\s*(\{[\s\S]*\})\s*\)$/s);
      if (jsObjMatch) {
        const toolName = jsObjMatch[1];
        if (this.#toolRegistry.has(toolName)) {
          try {
            let params;
            try { params = JSON.parse(jsObjMatch[2]); } catch {
              const normalized = jsObjMatch[2]
                .replace(/,\s*([}\]])/g, '$1')
                .replace(/'/g, '"')
                .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
              params = JSON.parse(normalized);
            }
            return { tool: toolName, params };
          } catch { /* parse failed */ }
        }
      }
    }

    // ── 4. ReAct: Action: tool_name\nAction Input: {...} (GPT/DeepSeek) ──
    const reactMatch = response.match(/Action\s*:\s*(\w+)\s*\n+Action\s*Input\s*:\s*([\s\S]*?)(?:\n\s*(?:Thought|Observation|$))/i);
    if (reactMatch) {
      const toolName = reactMatch[1];
      if (this.#toolRegistry.has(toolName)) {
        try {
          return { tool: toolName, params: JSON.parse(reactMatch[2].trim()) };
        } catch {
          const parsed = this.#parseToolCodeBlock(`${toolName}(${reactMatch[2].trim()})`);
          if (parsed) return parsed;
        }
      }
    }
    // Action/Action Input 在末尾（无后续 Thought）
    const reactEndMatch = response.match(/Action\s*:\s*(\w+)\s*\n+Action\s*Input\s*:\s*(\{[\s\S]*\})\s*$/i);
    if (reactEndMatch) {
      const toolName = reactEndMatch[1];
      if (this.#toolRegistry.has(toolName)) {
        try { return { tool: toolName, params: JSON.parse(reactEndMatch[2].trim()) }; } catch { /* ignore */ }
      }
    }

    // ── 5. XML: <tool_call>...</tool_call> / <function_call>...</function_call> ──
    const xmlMatch = response.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
    if (xmlMatch) {
      const parsed = this.#tryParseToolJson(xmlMatch[1].trim());
      if (parsed) return parsed;
    }
    const fcMatch = response.match(/<function_call>\s*([\s\S]*?)\s*<\/function_call>/);
    if (fcMatch) {
      const parsed = this.#tryParseToolJson(fcMatch[1].trim());
      if (parsed) return parsed;
    }

    // ── 6. ```json {...} ``` 内的 function_call 格式 ──
    const jsonFenceMatch = response.match(/```json\s*\n?([\s\S]*?)```/);
    if (jsonFenceMatch) {
      const parsed = this.#tryParseToolJson(jsonFenceMatch[1].trim());
      if (parsed) return parsed;
    }

    // ── 7. 裸 JSON: {"tool":"..."} 或 {"name":"..."} ──
    const jsonMatch = response.match(/\{\s*"(?:tool|name|function)"\s*:\s*"([^"]+)"[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = this.#tryParseToolJson(jsonMatch[0]);
      if (parsed) return parsed;
    }

    // ── 8. 末尾裸函数调用: tool_name(key="value") ──
    const trailingFnMatch = response.match(/\b(\w+)\(([^)]*)\)\s*$/);
    if (trailingFnMatch) {
      const parsed = this.#parseToolCodeBlock(`${trailingFnMatch[1]}(${trailingFnMatch[2]})`);
      if (parsed) return parsed;
    }

    return null;
  }

  /**
   * 尝试从 JSON 文本解析工具调用
   * 兼容多种 key 命名:
   *   - {"tool": "x", "params": {...}}         — 标准格式
   *   - {"name": "x", "arguments": {...}}      — OpenAI function_call
   *   - {"function": "x", "parameters": {...}} — 变体
   *   - {"tool": "x", "input": {...}}          — Claude 变体
   */
  #tryParseToolJson(text) {
    if (!text) return null;
    try {
      const obj = JSON.parse(text);
      const toolName = obj.tool || obj.name || obj.function;
      if (!toolName || !this.#toolRegistry.has(toolName)) return null;
      const params = obj.params || obj.arguments || obj.parameters || obj.input || {};
      return { tool: toolName, params };
    } catch { return null; }
  }

  /**
   * 解析 tool_code 函数调用格式
   * 支持三种参数格式:
   *   1. key=value:  search_project_code(query="xxx", language="objc")
   *   2. JSON 对象:  read_project_file({"file_path": "Code/X.m"})
   *   3. 单字符串:   read_project_file("Code/X.m")
   */
  #parseToolCodeBlock(text) {
    if (!text) return null;
    const fnMatch = text.match(/^(\w+)\((.*)\)$/s);
    if (!fnMatch) return null;

    const toolName = fnMatch[1];
    if (!this.#toolRegistry.has(toolName)) return null;

    const argsStr = fnMatch[2].trim();
    if (!argsStr) return { tool: toolName, params: {} };

    // 尝试 1: key=value 格式 (Python 风格)
    const params = {};
    const argRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))/g;
    let m;
    while ((m = argRegex.exec(argsStr)) !== null) {
      params[m[1]] = m[2] ?? m[3] ?? m[4];
    }
    if (Object.keys(params).length > 0) return { tool: toolName, params };

    // 尝试 2: JSON 对象参数 — read_project_file({"file_path": "..."})
    if (argsStr.startsWith('{')) {
      try {
        const jsonParams = JSON.parse(argsStr);
        if (typeof jsonParams === 'object' && jsonParams !== null) {
          return { tool: toolName, params: jsonParams };
        }
      } catch { /* not valid JSON, fall through */ }
    }

    // 尝试 3: 单字符串参数 — read_project_file("Code/X.m") → 映射到首个 required 参数
    const strMatch = argsStr.match(/^["'](.+?)["']$/);
    if (strMatch) {
      const toolDef = this.#toolRegistry.getToolSchemas().find(t => t.name === toolName);
      const firstRequired = toolDef?.parameters?.required?.[0];
      if (firstRequired) {
        return { tool: toolName, params: { [firstRequired]: strMatch[1] } };
      }
    }

    return { tool: toolName, params };
  }

  /**
   * 从 LLM 响应中解析 Action 块（支持批量）
   *
   * 优先匹配:
   *   ```batch_actions [...]```
   * 降级匹配:
   *   - 多个 <tool_call> XML 标签
   *   - 多个 ReAct Action 块
   *   - 单条 #parseAction()
   *
   * @returns {Array<{tool:string, params:object}>|null}
   */
  #parseActions(response) {
    if (!response) return null;

    // 1. 优先尝试 ```batch_actions``` 块
    const batchMatch = response.match(/```batch_actions\s*\n?([\s\S]*?)```/);
    if (batchMatch) {
      try {
        const arr = JSON.parse(batchMatch[1].trim());
        if (Array.isArray(arr) && arr.length > 0) {
          const valid = arr.filter(a => a.tool && this.#toolRegistry.has(a.tool));
          if (valid.length > 0) {
            return valid.map(a => ({ tool: a.tool, params: a.params || {} }));
          }
        }
      } catch { /* batch parse failed, fall through */ }
    }

    // 2. 多个 <tool_call> XML 块 (DeepSeek/Qwen)
    const xmlMatches = [...response.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)];
    if (xmlMatches.length > 1) {
      const results = xmlMatches
        .map(m => this.#tryParseToolJson(m[1].trim()))
        .filter(Boolean);
      if (results.length > 0) return results;
    }

    // 3. 多个 ReAct Action 块
    const reactMatches = [...response.matchAll(/Action\s*:\s*(\w+)\s*\n+Action\s*Input\s*:\s*(\{[\s\S]*?\})/gi)];
    if (reactMatches.length > 1) {
      const results = reactMatches
        .map(m => {
          const toolName = m[1];
          if (!this.#toolRegistry.has(toolName)) return null;
          try { return { tool: toolName, params: JSON.parse(m[2].trim()) }; } catch { return null; }
        })
        .filter(Boolean);
      if (results.length > 0) return results;
    }

    // 4. 降级到单 action
    const single = this.#parseAction(response);
    return single ? [single] : null;
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
   * 检测 AI 回复是否为「未完成的中间步骤」— 输出分析/计划文本但未实际调用工具
   *
   * Gemini 常见行为: 收到 production prompt 后先输出一段纯文本的
   * "执行计划" 或 "信号审视" 而不包含任何 action/tool_code block,
   * 导致 #parseActions() 返回 null,被误判为 final answer。
   *
   * 检测策略: 回复包含计划/分析关键词 + 不包含 dimensionDigest JSON
   */
  #looksLikeIncompleteStep(response) {
    if (!response || response.length < 100) return false;

    // 如果已包含 dimensionDigest → 是真正的最终回答
    if (response.includes('"dimensionDigest"') || response.includes('dimensionDigest')) return false;

    // 计划/分析性关键词 (中文 Gemini 常用)
    const planningPatterns = [
      /制定执行计划/,
      /信号质量预判/,
      /执行计划/,
      /我将按照/,
      /开始分析/,
      /我将分析/,
      /接下来我将/,
      /我来分析/,
      /首先[，,]?\s*我/,
      /\*\*0\.\s*制定/,
      /\*\*Signal\s+\d+/,                     // 信号列表分析
      /质量[：:]\s*(高|中|低)/,                // 信号质量评估
      /保留[。；]|丢弃[。；]|跳过[。；]/,       // 信号去留判断
    ];

    const matchCount = planningPatterns.filter(p => p.test(response)).length;
    return matchCount >= 2; // 至少匹配 2 个模式才认为是计划性回复
  }

  /**
   * 获取工具执行上下文
   * @param {object} [extras] — 额外注入到上下文的字段（如 _sessionToolCalls）
   */
  #getToolContext(extras) {
    return {
      container: this.#container,
      aiProvider: this.#aiProvider,
      projectRoot: this.#container?.singletons?._projectRoot || process.cwd(),
      logger: this.#logger,
      source: this.#currentSource,
      fileCache: this.#fileCache || null,
      ...extras,
    };
  }

  /**
   * 列出可用的 Skills 及其摘要（用于系统提示词）
   * 加载顺序: 内置 skills/ → 项目级 AutoSnippet/skills/（同名覆盖）
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
