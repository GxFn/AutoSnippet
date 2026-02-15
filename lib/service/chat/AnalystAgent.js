/**
 * AnalystAgent.js — v3.0 分析者 Agent
 *
 * 职责:
 * - 使用 AST 工具 + 文件搜索工具自由探索代码库
 * - 输出自然语言分析结果 (无格式约束)
 * - 不提交候选、不关心格式
 *
 * 设计哲学:
 * "给 AI 一个任务描述和一套好工具，让它像资深工程师一样自由探索代码库。"
 *
 * @module AnalystAgent
 */

import { buildAnalysisReport, analysisQualityGate, buildRetryPrompt } from './HandoffProtocol.js';
import Logger from '../../infrastructure/logging/Logger.js';

// ──────────────────────────────────────────────────────────────────
// System Prompt — Analyst 专用 (~100 tokens)
// ──────────────────────────────────────────────────────────────────

const ANALYST_SYSTEM_PROMPT = `你是一位高级软件架构师，正在深度分析一个真实项目。

## 工具使用优先级
1. **结构化查询优先** — get_project_overview → get_class_hierarchy → get_class_info
   这些工具返回精确的类继承、协议实现、方法签名信息，比文本搜索更高效。
2. **文本搜索补充** — search_project_code 用于查找特定模式/关键字
3. **文件阅读验证** — read_project_file 用于确认具体实现细节

> ⚠️ 避免反复调用 search_project_code 搜索不同关键词。
> 如果需要了解类结构，直接用 get_class_info 查询。

输出你的分析发现，包括具体的文件路径和代码位置。
不需要任何特定格式，用自然语言描述你的理解即可。
尽可能多地使用工具来获取准确信息，不要猜测。`;

// ──────────────────────────────────────────────────────────────────
// Analyst 可用工具白名单 — 只做探索，不做提交
// ──────────────────────────────────────────────────────────────────

const ANALYST_TOOLS = [
  // AST 结构化分析
  'get_project_overview',
  'get_class_hierarchy',
  'get_class_info',
  'get_protocol_info',
  'get_method_overrides',
  'get_category_map',
  // 文件访问
  'search_project_code',
  'read_project_file',
  'list_project_structure',
  'get_file_summary',
  'semantic_search_code',
  // 前序上下文 (可选)
  'get_previous_analysis',
];

// ──────────────────────────────────────────────────────────────────
// Analyst 预算 — 自由探索，不需要 PhaseRouter
// ──────────────────────────────────────────────────────────────────

const ANALYST_BUDGET = {
  maxIterations: 12,      // was 20 — 多数维度 5-9 轮完成
  searchBudget: 10,       // was 15 — 探索为主，精简预算
  searchBudgetGrace: 6,   // was 10
  maxSubmits: 0,          // Analyst 不提交候选
  softSubmitLimit: 0,
  idleRoundsToExit: 2,    // was 3 — 减少空转
};

// ──────────────────────────────────────────────────────────────────
// 维度 Prompt 模板
// ──────────────────────────────────────────────────────────────────

/**
 * 构建 Analyst Prompt
 * @param {object} dimConfig — 维度配置 { id, label, guide, focusAreas }
 * @param {object} projectInfo — { name, lang, fileCount }
 * @param {object} [dimensionContext] — DimensionContext 实例 (跨维度上下文)
 * @returns {string}
 */
function buildAnalystPrompt(dimConfig, projectInfo, dimensionContext) {
  const parts = [];

  // §1 任务描述
  parts.push(`分析项目 ${projectInfo.name} (${projectInfo.lang}, ${projectInfo.fileCount} 个文件) 的 ${dimConfig.label}。`);

  // §2 维度指引
  if (dimConfig.guide) {
    parts.push(dimConfig.guide);
  }

  // §3 探索焦点
  if (dimConfig.focusAreas?.length > 0) {
    parts.push(`重点关注:\n${dimConfig.focusAreas.map(f => `- ${f}`).join('\n')}`);
  }

  // §4 输出要求
  const outputType = dimConfig.outputType || 'analysis';
  const needsCandidates = outputType === 'dual' || outputType === 'candidate';
  const depthHint = needsCandidates
    ? '你的分析将被转化为知识候选，请确保每个发现都有足够的代码证据和文件引用。目标: 发现 3-5 个独立的知识点。'
    : '';

  parts.push(`请将分析组织成结构化段落，包含:
1. 在哪些文件/类中发现 (写出具体文件路径)
2. 具体的实现方式和代码特征
3. 为什么选择这种方式（设计意图）
4. 统计数据 (如数量、占比)

每个关键发现用编号列表呈现，引用 3 个以上具体文件。
${depthHint}
重要: 务必使用 read_project_file 阅读代码确认，不要假设文件存在。引用的每个文件路径都必须是你亲眼看到的。`);

  // §5 前序上下文提示
  parts.push('可以调用 get_previous_analysis 获取前序维度的分析结果，避免重复分析。');

  // §6 前序维度分析摘要 (Tier 2+ 才有)
  if (dimensionContext) {
    const snapshot = dimensionContext.buildContextForDimension(dimConfig.id);
    const prevDims = Object.entries(snapshot.previousDimensions);
    if (prevDims.length > 0) {
      parts.push(`## 前序维度分析摘要（避免重复探索）`);
      for (const [dimId, digest] of prevDims) {
        parts.push(`### ${dimId}\n${digest.summary || '(无摘要)'}`);
        if (digest.keyFindings?.length > 0) {
          parts.push(`关键发现: ${digest.keyFindings.join('; ')}`);
        }
        if (digest.crossRefs?.[dimConfig.id]) {
          parts.push(`💡 对本维度的建议: ${digest.crossRefs[dimConfig.id]}`);
        }
      }
    }
  }

  return parts.join('\n\n');
}

// ──────────────────────────────────────────────────────────────────
// AnalystAgent 类
// ──────────────────────────────────────────────────────────────────

export class AnalystAgent {
  /** @type {import('./ChatAgent.js').ChatAgent} */
  #chatAgent;

  /** @type {import('../../core/ast/ProjectGraph.js').default} */
  #projectGraph;

  /** @type {import('../../infrastructure/logging/Logger.js').default} */
  #logger;

  /** @type {number} Gate 最大重试次数 */
  #maxRetries;

  /**
   * @param {object} chatAgent — ChatAgent 实例
   * @param {object} [projectGraph] — ProjectGraph 实例
   * @param {object} [options]
   * @param {number} [options.maxRetries=1] — Gate 失败最大重试次数
   */
  constructor(chatAgent, projectGraph = null, options = {}) {
    this.#chatAgent = chatAgent;
    this.#projectGraph = projectGraph;
    this.#logger = Logger.getInstance();
    this.#maxRetries = options.maxRetries ?? 1;
  }

  /**
   * 分析指定维度
   *
   * @param {object} dimConfig — 维度配置 { id, label, guide, focusAreas }
   * @param {object} projectInfo — { name, lang, fileCount }
   * @param {object} [options]
   * @param {string} [options.sessionId] — Bootstrap session ID
   * @param {object} [options.dimensionContext] — DimensionContext 实例
   * @returns {Promise<import('./HandoffProtocol.js').AnalysisReport>}
   */
  async analyze(dimConfig, projectInfo, options = {}) {
    const dimId = dimConfig.id;
    const prompt = buildAnalystPrompt(dimConfig, projectInfo, options.dimensionContext);

    this.#logger.info(`[AnalystAgent] ▶ analyzing dimension "${dimId}" — prompt ${prompt.length} chars`);

    let retries = 0;
    let lastReport = null;

    while (retries <= this.#maxRetries) {
      const execPrompt = retries === 0
        ? prompt
        : prompt + '\n\n' + buildRetryPrompt(lastReport?._gateReason || 'Analysis too short');

      try {
        const result = await this.#chatAgent.execute(execPrompt, {
          source: 'system',
          conversationId: options.sessionId ? `analyst-${options.sessionId}-${dimId}` : undefined,
          budget: ANALYST_BUDGET,
          systemPromptOverride: ANALYST_SYSTEM_PROMPT,
          allowedTools: ANALYST_TOOLS,
          disablePhaseRouter: true,
          temperature: 0.4,
          dimensionMeta: {
            id: dimId,
            outputType: 'analysis',
            allowedKnowledgeTypes: dimConfig.allowedKnowledgeTypes || [],
          },
        });

        // 构建 AnalysisReport
        const report = buildAnalysisReport(result, dimId, this.#projectGraph);

        // 质量门控 — 传入 outputType 以调整门槛
        const gate = analysisQualityGate(report, { outputType: dimConfig.outputType || 'analysis' });
        if (gate.pass) {
          this.#logger.info(`[AnalystAgent] ✅ dimension "${dimId}" — ${report.analysisText.length} chars, ${report.referencedFiles.length} files referenced, ${report.metadata.toolCallCount} tool calls`);
          return report;
        }

        this.#logger.warn(`[AnalystAgent] ⚠ Gate failed for "${dimId}": ${gate.reason} (action=${gate.action})`);

        if (gate.action === 'degrade') {
          // 直接降级 — 不重试
          report._gateResult = gate;
          return report;
        }

        // retry
        lastReport = report;
        lastReport._gateReason = gate.reason;
        retries++;
      } catch (err) {
        this.#logger.error(`[AnalystAgent] ❌ dimension "${dimId}" error: ${err.message}`);
        // 返回空 report
        return buildAnalysisReport({ reply: '', toolCalls: [] }, dimId, this.#projectGraph);
      }
    }

    // 重试耗尽 — 返回最后一次结果
    this.#logger.warn(`[AnalystAgent] Retries exhausted for "${dimId}" — returning last report`);
    return lastReport || buildAnalysisReport({ reply: '', toolCalls: [] }, dimId, this.#projectGraph);
  }
}

export default AnalystAgent;
