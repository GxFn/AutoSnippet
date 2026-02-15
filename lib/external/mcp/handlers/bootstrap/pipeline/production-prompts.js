/**
 * pipeline/production-prompts.js — ChatAgent 维度生产 Prompt (v9)
 *
 * v9 核心改进 (基于业界最佳实践研究):
 *   - prompt 精简: 移除冗余的工作流步骤（由 PhaseRouter 状态机管理）
 *   - 查询后置: 长文档(信号)前置，行动指令后置（Anthropic 最佳实践 +30%）
 *   - 质量红线精简: 从 8 条 → 4 条核心规则
 *   - 工具格式说明移除: 原生函数调用不需要文本格式示例
 *   - 候选格式示例精简: 只保留一个简洁示例
 *   - 首条 prompt 预算: 信号/样本/前序digest 均有 token 上限，防止首条 prompt 超标
 *   - 信号数量限制: MAX_SIGNALS_PER_PROMPT=15，溢出信号以简要列表引导 Agent-Pull
 *
 * @module pipeline/production-prompts
 */

// ─── 输入侧 token 预算常量 ──────────────────────────────
const PROMPT_LIMITS = {
  /** 每维度最多嵌入的详细信号数 */
  maxSignals: 15,
  /** 每个信号最多嵌入的代码样本数 */
  maxSamplesPerSignal: 2,
  /** 每个代码样本最大行数 */
  maxSampleLines: 20,
  /** previousDimensions section 最大字符数 */
  maxDigestChars: 3000,
  /** existingCandidates section 最大条数 */
  maxExistingCandidates: 30,
  /** 首条 prompt 粗估 token 上限 (chars/3 ≈ tokens) */
  promptCharBudget: 60_000, // ~20K tokens
};

/**
 * 构建维度生产的完整 Prompt
 *
 * @param {object} dim — 维度定义 { id, label, guide, skillWorthy, dualOutput, ... }
 * @param {Array<Signal>} signals — 本维度的信号数组
 * @param {DimensionContextSnapshot} context — 跨维度上下文快照
 * @param {object} [opts] — 可选配置
 * @param {boolean} [opts.isRecalculation=false] — 是否为重算
 * @param {Array} [opts.existingCandidates] — 重算时已有的候选
 * @param {object} [opts.budget] — 预算配置 { maxIterations, searchBudget, maxSubmits }
 * @returns {string} 完整 prompt 文本
 */
export function buildDimensionProductionPrompt(dim, signals, context, opts = {}) {
  const { isRecalculation = false, existingCandidates = [], budget } = opts;
  const parts = [];

  // ── Section 1: 角色定义 ──
  parts.push(`# Role
你是项目 **${context.project.projectName || 'unknown'}** 的代码知识策展人。
你的任务是分析维度 "${dim.label}" 的扫描信号，产出精确、有价值的代码知识候选。`);

  // ── Section 2: 项目上下文 ──
  parts.push(buildProjectContextSection(context.project));

  // ── Section 3: 已分析维度 ──
  if (Object.keys(context.previousDimensions).length > 0) {
    parts.push(buildPreviousDimensionsSection(context.previousDimensions));
  }

  // ── Section 4: 已提交候选 ──
  if (context.existingCandidates.length > 0) {
    parts.push(buildExistingCandidatesSection(context.existingCandidates));
  }

  // ── Section 5: 当前维度定义（含输出类型标注）──
  const outputType = (dim.skillWorthy && !dim.dualOutput) ? 'skill'
    : (dim.skillWorthy && dim.dualOutput) ? 'dual'
    : 'candidate';
  const outputTypeDesc = {
    candidate: '📋 Candidate-Only — 你必须通过 submit_candidate 提交候选，不生成 Skill',
    skill: '🎯 Skill-Only — 你**不能**提交候选，只需在最终回复中提供 dimensionDigest JSON',
    dual: '⚡ Dual — 既需要 submit_candidate 提交候选，又需要产出 dimensionDigest 用于 Skill 生成',
  }[outputType];

  const knowledgeTypes = (dim.knowledgeTypes || []).join(', ') || '不限';
  const knowledgeTypeHint = outputType === 'skill'
    ? '' // skill-only 维度不提交候选，无需 knowledgeType 约束
    : `\n允许的知识类型 (knowledgeType): ${knowledgeTypes}\n> submit_candidate 的 knowledgeType 参数必须是上述值之一，否则会被系统拒绝。`;

  parts.push(`# 当前维度: ${dim.label} (${dim.id})
${dim.guide}

## 输出类型: ${outputType.toUpperCase()}
${outputTypeDesc}${knowledgeTypeHint}`);

  // ── Section 6: 扫描信号 ──
  parts.push(buildSignalsSection(signals));

  // ── Section 7: 工作流指令 ──
  if (dim.skillWorthy && !dim.dualOutput) {
    // skillWorthy 维度不需要创建 Candidate，只需产出 digest
    parts.push(buildSkillOnlyWorkflowSection(dim));
  } else {
    parts.push(buildCandidateWorkflowSection(dim, isRecalculation, budget));
  }

  // ── Section 8: 重算上下文 (如有) ──
  if (isRecalculation && existingCandidates.length > 0) {
    parts.push(buildRecalculationSection(existingCandidates));
  }

  // ── Section 9: 质量红线 ──
  parts.push(QUALITY_GUARDRAILS);

  return parts.join('\n\n');
}

// ─── 子 Section 构建器 ──────────────────────────────────

function buildProjectContextSection(project) {
  const lines = [
    '# 项目上下文',
    `- 项目名: ${project.projectName}`,
    `- 主语言: ${project.primaryLang}`,
    `- 文件数: ${project.fileCount}`,
    `- 模块数: ${project.targetCount}`,
  ];

  if (project.modules?.length) {
    lines.push(`- 模块列表: ${project.modules.slice(0, 15).join(', ')}${project.modules.length > 15 ? ` ... (共 ${project.modules.length} 个)` : ''}`);
  }

  if (project.astMetrics) {
    const m = project.astMetrics;
    lines.push(`- AST 指标: ${m.totalMethods || '?'} 方法, 平均 ${m.avgMethodsPerClass || '?'} 方法/类, 最大嵌套 ${m.maxNestingDepth || '?'} 层`);
    if (m.complexMethods) lines.push(`  - 复杂方法: ${m.complexMethods} 个`);
    if (m.longMethods) lines.push(`  - 超长方法: ${m.longMethods} 个`);
  }

  if (project.guardSummary) {
    const g = project.guardSummary;
    lines.push(`- Guard 审计: ${g.totalViolations || 0} 违规 (${g.errors || 0} errors, ${g.warnings || 0} warnings)`);
  }

  return lines.join('\n');
}

function buildPreviousDimensionsSection(previousDimensions) {
  const lines = ['# 已分析维度 (你的前序同事已完成)', ''];
  let charCount = 0;
  const entries = Object.entries(previousDimensions);

  for (const [dimId, digest] of entries) {
    // P4: 前序 digest 总量不超过预算
    if (charCount > PROMPT_LIMITS.maxDigestChars) {
      lines.push(`... 以及 ${entries.length - lines.filter(l => l.startsWith('## ')).length} 个更早维度的结果 (已省略)`);
      break;
    }

    const block = [];
    block.push(`## ${dimId}`);
    block.push(`- 摘要: ${digest.summary || '(无)'}`);
    block.push(`- 产出: ${digest.candidateCount || 0} 条候选`);
    if (digest.keyFindings?.length) {
      block.push(`- 关键发现:`);
      for (const finding of digest.keyFindings.slice(0, 3)) {
        block.push(`  - ${finding}`);
      }
    }
    if (digest.crossRefs && Object.keys(digest.crossRefs).length > 0) {
      block.push(`- 对其他维度的建议:`);
      for (const [targetDim, suggestion] of Object.entries(digest.crossRefs)) {
        block.push(`  - → ${targetDim}: ${suggestion}`);
      }
    }
    if (digest.gaps?.length) {
      block.push(`- 未覆盖的缺口: ${digest.gaps.slice(0, 3).join('; ')}`);
    }
    block.push('');

    const blockStr = block.join('\n');
    charCount += blockStr.length;
    lines.push(blockStr);
  }
  return lines.join('\n');
}

function buildExistingCandidatesSection(candidates) {
  if (candidates.length === 0) return '';
  const capped = candidates.slice(0, PROMPT_LIMITS.maxExistingCandidates);
  const lines = ['# 已提交候选 (避免重复)', ''];
  for (const c of capped) {
    lines.push(`- [${c.dimId}] ${c.title}${c.subTopic ? ' (' + c.subTopic + ')' : ''}`);
  }
  if (candidates.length > capped.length) {
    lines.push(`... 以及 ${candidates.length - capped.length} 条更早候选 (已省略)`);
  }
  return lines.join('\n');
}

function buildSignalsSection(signals) {
  // ── P1: 按 matchCount 降序排序，取前 N 条详细展示 ──
  const sorted = [...signals].sort((a, b) => (b.evidence?.matchCount || 0) - (a.evidence?.matchCount || 0));
  const detailed = sorted.slice(0, PROMPT_LIMITS.maxSignals);
  const overflow = sorted.slice(PROMPT_LIMITS.maxSignals);

  const lines = [`# 扫描信号 (${signals.length} 条${overflow.length ? `，详细展示前 ${detailed.length} 条` : ''})`, ''];

  for (let i = 0; i < detailed.length; i++) {
    const s = detailed[i];
    lines.push(`## Signal ${i + 1}: ${s.subTopic}`);
    lines.push(`- 匹配文件数: ${s.evidence.matchCount}`);
    if (s.evidence.topFiles?.length) {
      lines.push(`- 主要文件: ${s.evidence.topFiles.slice(0, 3).join(', ')}`);
    }

    // 写法分布
    if (s.evidence.distribution?.length) {
      lines.push(`- 写法分布 (${s.evidence.distribution.length} 种):`);
      for (const d of s.evidence.distribution) {
        const bpTag = d.boilerplate ? ' [boilerplate]' : '';
        lines.push(`  - ${d.label}: ${d.fileCount} 个文件 (${d.pct}%)${bpTag}`);
      }
    }

    // ── P0+P3: 代码样本 — 受 maxSamplesPerSignal 和 maxSampleLines 限制 ──
    if (s.evidence.samples?.length) {
      const cappedSamples = s.evidence.samples.slice(0, PROMPT_LIMITS.maxSamplesPerSignal);
      lines.push(`- 代码样本 (${cappedSamples.length}/${s.evidence.samples.length} 个):`);
      for (let j = 0; j < cappedSamples.length; j++) {
        const sample = cappedSamples[j];
        const loc = sample.file ? ` (${sample.file}:${sample.line})` : '';
        lines.push(`  ▶ 样本 ${j + 1}${loc} [写法: ${sample.variant || 'default'}]:`);
        lines.push('```');
        // 截断样本代码行数
        const codeLines = (sample.code || '').split('\n');
        if (codeLines.length > PROMPT_LIMITS.maxSampleLines) {
          lines.push(codeLines.slice(0, PROMPT_LIMITS.maxSampleLines).join('\n'));
          lines.push(`// ... (${codeLines.length - PROMPT_LIMITS.maxSampleLines} more lines, use read_project_file to see full)`);
        } else {
          lines.push(sample.code);
        }
        lines.push('```');
      }
    }

    // 宏观维度指标
    if (s.evidence.metrics && Object.keys(s.evidence.metrics).length > 0) {
      const m = s.evidence.metrics;
      const entries = Object.entries(m).filter(([k]) => !k.startsWith('_'));
      if (entries.length > 0) {
        lines.push('- 关键指标:');
        for (const [k, v] of entries) {
          lines.push(`  - ${k}: ${v}`);
        }
      }
      if (m._preferred) lines.push(`- 首选: ${m._preferred}`);
    }

    // 搜索建议
    if (s.evidence.searchHints?.length) {
      lines.push(`- 💡 建议搜索: 用 search_project_code 搜索 ${s.evidence.searchHints.map(h => `"${h}"`).join(' 或 ')} 获取更多项目示例`);
    }

    // 启发式提示
    if (s.heuristicHints?.length) {
      lines.push(`- 启发式提示:`);
      for (const hint of s.heuristicHints) {
        lines.push(`  - ${hint}`);
      }
    }

    // 关联
    if (s.relatedSignals?.length) {
      lines.push(`- 可能关联: ${s.relatedSignals.join(', ')}`);
    }

    lines.push('');
  }

  // ── P1: 溢出信号简要列表 — 引导 Agent-Pull ──
  if (overflow.length > 0) {
    lines.push(`## 其他信号 (${overflow.length} 条，可用 search_project_code 按需探索)`);
    for (const s of overflow) {
      const hints = s.evidence.searchHints?.length
        ? ` → 搜索: ${s.evidence.searchHints.slice(0, 2).map(h => `"${h}"`).join(', ')}`
        : '';
      lines.push(`- ${s.subTopic} (${s.evidence.matchCount} 文件)${hints}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildCandidateWorkflowSection(dim, isRecalculation, budget) {
  const maxSubmits = budget?.maxSubmits ?? 6;
  return `# 工作指令

> 系统会自动管理你的探索→提交→总结流程，你只需专注分析和产出。
> 最多提交 ${maxSubmits} 条候选。集中搜索后批量提交，避免搜一个提一个。
${isRecalculation ? '> ⚠️ 重算模式: 审视已有候选后决定增/删/改\n' : ''}
## 分析要求
- 丢弃假阳性(注释/字符串误匹配)、证据不足(<2文件)、过于通用(任何项目都有)
- 多条信号描述同一概念时合并为一条
- 样本不够时用 search_project_code / read_project_file 补充真实代码

## submit_candidate 参数
- **code**: 「项目特写」风格 Markdown — 描述与代码交织，标题用"— 项目特写"后缀，
  使用项目真实类名/前缀，读完即知本项目中该怎么写
- **title**: "[Bootstrap] ${dim.id}/子主题"
- **summary**: ≤80字，引用真实类名和数字
- **language**: 按项目实际语言
- **category**: View/Service/Tool/Model/Network/Storage/UI/Utility
- **knowledgeType**: ${(dim.knowledgeTypes || []).join(' | ')}
- **tags**: 含 "bootstrap", "${dim.id}"
- **source**: "bootstrap"
- **reasoning**: { whyStandard, sources: ["文件..."], confidence: 0.3~0.9 }

## 完成标志
提交完所有候选后，在最终回复中输出:
\`\`\`json
{
  "dimensionDigest": {
    "summary": "整体分析总结(100-200字)",
    "candidateCount": N,
    "candidateTitles": ["标题列表"],
    "keyFindings": ["关键发现"],
    "crossRefs": { "dim-id": "建议" },
    "gaps": ["未覆盖缺口"]
  }
}
\`\`\``;
}

function buildSkillOnlyWorkflowSection(dim) {
  return `# 工作指令

> Skill-Only 模式: 不提交候选，只需分析信号并产出详尽的维度摘要。
> 你可以用 search_project_code / read_project_file 补充信号中不够充分的部分。

在最终回复中输出:
\`\`\`json
{
  "dimensionDigest": {
    "summary": "整体分析总结(200-400字,尽可能详尽)",
    "candidateCount": 0,
    "keyFindings": ["关键发现"],
    "crossRefs": { "dim-id": "建议" },
    "gaps": ["未覆盖缺口"]
  }
}
\`\`\`

你的分析将影响后续维度的 ChatAgent，请尽可能详尽和精确。`;
}

function buildRecalculationSection(existingCandidates) {
  const lines = [
    '# 重算模式: 已有候选',
    '',
    '以下是上次生成的候选,你需要审视后决定:',
    '- **KEEP**: 质量足够,不需要修改',
    '- **UPDATE**: 需要更新 → 先 delete_candidate 再 submit_candidate',
    '- **DELETE**: 不再有价值 → 调用 delete_candidate',
    '- 也可以 **ADD** 全新候选 → 调用 submit_candidate',
    '',
  ];

  for (const c of existingCandidates) {
    lines.push(`- ${c.title || '(无标题)'}: ${c.summary || c.subTopic || ''}`);
  }

  return lines.join('\n');
}

// ─── 质量红线 ──────────────────────────────────────────

const QUALITY_GUARDRAILS = `# 质量红线

1. **代码必须真实** — 来自信号样本或工具查询结果，不可编造
2. **引用具体名字和数字** — 禁止「本模块」「该文件」等泛化措辞
3. **质量优先于数量** — 证据不足宁可不提交，confidence 分布应合理
4. **项目特写风格** — 描述与代码交织，读完即知在本项目中该怎么写`;

/**
 * 构建 ChatAgent 系统级 prompt (区别于维度用户 prompt)
 *
 * @param {Array} availableTools — 可用工具 schemas
 * @returns {string}
 */
export function buildBootstrapSystemPrompt(availableTools) {
  // v9: 此函数仅保留向后兼容，实际 system prompt 由 ChatAgent.#buildNativeToolSystemPrompt 生成
  return `你是代码知识策展 AI。分析项目代码并产出结构化知识候选。

# 可用工具
${availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

# 规则
- 通过 submit_candidate 工具提交候选，code 字段用「项目特写」风格
- 完成后在回复中输出 dimensionDigest JSON
- 代码必须真实，引用具体类名和数字
- 质量优先于数量，证据不足宁可不提交`;
}
