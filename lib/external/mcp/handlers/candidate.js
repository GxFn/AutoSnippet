/**
 * MCP Handlers — 候选提交 & 校验 & AI 补全
 * validateCandidate, checkDuplicate, submitSingle, submitBatch, submitDrafts, enrichCandidates
 * + 辅助: buildReasoning, _createCandidateItem
 */

import fs from 'node:fs';
import path from 'node:path';
import { envelope } from '../envelope.js';
import * as Paths from '../../../infrastructure/config/Paths.js';
import { checkRecipeReadiness } from '../../../shared/RecipeReadinessChecker.js';

// ─── 辅助方法 ──────────────────────────────────────────────

/**
 * 从工具参数构建 Reasoning 值对象数据。
 * Agent 必须提供 reasoning.whyStandard / sources / confidence。
 */
export function buildReasoning(obj) {
  const r = obj.reasoning;
  if (!r || !r.whyStandard) return {};
  return {
    whyStandard: r.whyStandard,
    sources: Array.isArray(r.sources) ? r.sources : [],
    confidence: typeof r.confidence === 'number' ? r.confidence : 0.7,
    qualitySignals: r.qualitySignals || {},
    alternatives: Array.isArray(r.alternatives) ? r.alternatives : [],
  };
}

/**
 * 统一创建候选的内部方法 — 委托到 CandidateService.createFromToolParams()
 * 保留此函数作为 MCP handler 层的快捷入口，保持向后兼容。
 */
async function _createCandidateItem(candidateService, item, source, extraMeta = {}) {
  return candidateService.createFromToolParams(item, source, extraMeta, { userId: 'external_agent' });
}

// ─── 限流检查 ──────────────────────────────────────────────

// Recipe-Ready 检查已提取到 lib/shared/RecipeReadinessChecker.js
// 旧私有函数 _checkRecipeReadiness 已移除，统一使用 checkRecipeReadiness

async function _checkRateLimit(toolName, clientId) {
  const { checkRecipeSave } = await import('../../../http/middleware/RateLimiter.js');
  const projectRoot = process.cwd();
  const limitCheck = checkRecipeSave(projectRoot, clientId || process.env.USER || 'mcp-client');
  if (!limitCheck.allowed) {
    return envelope({
      success: false,
      message: `提交过于频繁，请 ${limitCheck.retryAfter}s 后再试。`,
      errorCode: 'RATE_LIMIT',
      meta: { tool: toolName },
    });
  }
  return null; // passed
}

// ─── 校验 & 去重 ───────────────────────────────────────────

export async function validateCandidate(ctx, args) {
  const c = args.candidate || {};
  const errors = [];
  const warnings = [];
  const suggestions = [];

  // Layer 1: 核心必填
  if (!c.title?.trim()) errors.push('缺少 title');
  if (!c.code?.trim() && args.strict) errors.push('strict 模式下需要 code');
  if (!c.language) warnings.push('缺少 language');

  // Layer 2: 分类
  if (!c.category) warnings.push('缺少 category');
  if (!c.knowledgeType) warnings.push('缺少 knowledgeType（code-pattern/architecture/best-practice/...）');
  if (!c.complexity) suggestions.push({ field: 'complexity', value: 'intermediate' });

  // Layer 3: 描述文档
  if (!c.trigger?.trim()) warnings.push('缺少 trigger（建议 @ 开头）');
  if (c.trigger && !c.trigger.startsWith('@')) {
    suggestions.push({ field: 'trigger', value: `@${c.trigger.replace(/^@+/, '')}` });
  }
  if (!c.summary?.trim() && !c.description?.trim()) warnings.push('缺少 summary 或 description');
  if (!c.usageGuide?.trim()) warnings.push('缺少 usageGuide');

  // Layer 4: 结构化内容
  if (!c.rationale) warnings.push('缺少 rationale（设计原理）');
  if (!Array.isArray(c.headers) || c.headers.length === 0) warnings.push('缺少 headers（import 声明）');
  if (!c.steps && !c.codeChanges) suggestions.push({ field: 'steps', value: '[{title, description, code}]' });

  // Layer 5: 约束与关系
  if (!c.constraints) suggestions.push({ field: 'constraints', value: '{boundaries[], preconditions[], sideEffects[], guards[]}' });

  // Reasoning 推理依据
  if (!c.reasoning) {
    errors.push('缺少 reasoning（推理依据 — whyStandard + sources + confidence）');
  } else {
    if (!c.reasoning.whyStandard?.trim()) errors.push('reasoning.whyStandard 不能为空');
    if (!Array.isArray(c.reasoning.sources) || c.reasoning.sources.length === 0) errors.push('reasoning.sources 至少包含一项来源');
    if (typeof c.reasoning.confidence !== 'number' || c.reasoning.confidence < 0 || c.reasoning.confidence > 1) warnings.push('reasoning.confidence 应为 0-1 的数字');
  }

  const ok = errors.length === 0;
  return envelope({ success: ok, data: { ok, errors, warnings, suggestions }, meta: { tool: 'autosnippet_validate_candidate' } });
}

export async function checkDuplicate(ctx, args) {
  const { findSimilarRecipes } = await import('../../../service/candidate/SimilarityService.js');
  const projectRoot = process.env.ASD_PROJECT_DIR || process.cwd();
  const similar = findSimilarRecipes(projectRoot, args.candidate, {
    threshold: args.threshold ?? 0.7,
    topK: args.topK ?? 5,
  });
  return envelope({ success: true, data: { similar }, meta: { tool: 'autosnippet_check_duplicate' } });
}

// ─── 提交 ──────────────────────────────────────────────────

export async function submitSingle(ctx, args) {
  // 限流
  const blocked = await _checkRateLimit('autosnippet_submit_candidate', args.clientId);
  if (blocked) return blocked;

  const candidateService = ctx.container.get('candidateService');
  const result = await _createCandidateItem(
    candidateService, args, args.source || 'mcp',
  );

  // Recipe-Ready 诊断
  const readiness = checkRecipeReadiness(args);
  const data = { ...result };
  if (!readiness.ready) {
    data.recipeReadyHints = {
      ready: false,
      missingFields: readiness.missing,
      suggestions: readiness.suggestions,
      hint: '请补全以上字段后重新提交，或调用 autosnippet_enrich_candidates 进行完整性诊断',
    };
  }

  return envelope({ success: true, data, meta: { tool: 'autosnippet_submit_candidate' } });
}

export async function submitBatch(ctx, args) {
  if (!args.targetName || !Array.isArray(args.items) || args.items.length === 0) {
    throw new Error('需要 targetName 与 items（非空数组）');
  }

  // 限流
  const blocked = await _checkRateLimit('autosnippet_submit_candidates', args.clientId);
  if (blocked) return blocked;

  // 去重
  let items = args.items;
  if (args.deduplicate !== false) {
    const { aggregateCandidates } = await import('../../../service/candidate/CandidateAggregator.js');
    const result = aggregateCandidates(items);
    items = result.items;
  }

  // 逐条提交
  const candidateService = ctx.container.get('candidateService');
  const source = args.source || 'cursor-scan';
  let count = 0;
  const itemErrors = [];
  for (let i = 0; i < items.length; i++) {
    try {
      await _createCandidateItem(candidateService, items[i], source, { targetName: args.targetName });
      count++;
    } catch (err) {
      itemErrors.push({ index: i, title: items[i].title || '(untitled)', error: err.message });
    }
  }

  const data = { count, total: items.length, targetName: args.targetName };
  if (itemErrors.length > 0) data.errors = itemErrors;

  // Recipe-Ready 统计
  const notReady = items.filter(it => !checkRecipeReadiness(it).ready);
  if (notReady.length > 0) {
    // 汇总所有缺失字段（去重）
    const allMissing = [...new Set(notReady.flatMap(it => checkRecipeReadiness(it).missing))];
    data.recipeReadyHints = {
      notReadyCount: notReady.length,
      totalCount: items.length,
      commonMissingFields: allMissing,
      hint: `${notReady.length}/${items.length} 条候选缺少 Recipe 必要字段（${allMissing.join(', ')}），请补全后重新提交或调用 autosnippet_enrich_candidates 查漏`,
    };
  }

  return envelope({ success: true, data, message: `已提交 ${count}/${items.length} 条候选，请在 Dashboard Candidates 页审核。`, meta: { tool: 'autosnippet_submit_candidates' } });
}

export async function submitDrafts(ctx, args) {
  const { RecipeParser } = await import('../../../service/recipe/RecipeParser.js');

  const projectRoot = process.cwd();
  const parser = new RecipeParser();
  const paths = Array.isArray(args.filePaths) ? args.filePaths : [args.filePaths].filter(Boolean);
  if (paths.length === 0) throw new Error('filePaths 不能为空');

  // 限流
  const blocked = await _checkRateLimit('autosnippet_submit_draft_recipes', args.clientId);
  if (blocked) return blocked;

  const recipes = [];
  const parseErrors = [];
  const successFiles = [];

  for (const fp of paths) {
    try {
      const absPath = path.isAbsolute(fp) ? fp : path.join(projectRoot, fp);
      // 禁止操作知识库目录
      const kbDir = Paths.getKnowledgeBaseDirName(projectRoot);
      const rel = path.relative(projectRoot, absPath);
      if (rel.startsWith(kbDir + '/') || rel.startsWith(kbDir + path.sep)) {
        parseErrors.push(`🚫 ${fp} — 禁止操作知识库目录 ${kbDir}/`);
        continue;
      }
      if (!fs.existsSync(absPath)) { parseErrors.push(`❌ 文件不存在: ${fp}`); continue; }

      const content = fs.readFileSync(absPath, 'utf8');
      let parsed = [];
      if (parser.isCompleteRecipe(content)) {
        const r = parser.parse(content);
        if (r) parsed.push(r);
      } else {
        parsed = parser.parseAll(content).filter(Boolean);
      }
      if (parsed.length === 0 && parser.isIntroOnly(content)) {
        const r = parser.parse(content); // intro-only still parseable for frontmatter
        if (r) parsed.push(r);
      }

      // 校验
      const { RecipeCandidateValidator } = await import('../../../service/recipe/RecipeCandidateValidator.js');
      const validator = new RecipeCandidateValidator();
      const valid = [];
      for (const item of parsed) {
        const result = validator.validate(item);
        if (!result.errors || result.errors.length === 0) {
          valid.push(item);
        } else {
          parseErrors.push(`❌ ${path.basename(fp)}: ${result.errors.join('; ')}`);
        }
      }
      if (valid.length > 0) {
        recipes.push(...valid.map(r => ({ ...r, _sourceFile: absPath })));
        successFiles.push({ path: absPath, count: valid.length, name: path.basename(absPath) });
      }
    } catch (err) {
      parseErrors.push(`❌ ${path.basename(fp)}: ${err.message}`);
    }
  }

  if (recipes.length === 0) {
    return envelope({ success: false, message: `未能解析出有效 Recipe。${parseErrors.join('\n')}`, errorCode: 'PARSE_FAILED', meta: { tool: 'autosnippet_submit_draft_recipes' } });
  }

  // 逐条提交 — 使用 _createCandidateItem 统一路径
  const candidateService = ctx.container.get('candidateService');
  const source = args.source || 'copilot-draft';
  let count = 0;
  const submitErrors = [];
  for (const item of recipes) {
    try {
      // 将 RecipeParser 的字段映射到 candidate 通用字段
      const normalized = {
        code: item.code || '',
        language: item.language || '',
        category: item.category || 'general',
        title: item.title || '',
        summary: item.summary || item.summary_cn || '',
        summary_cn: item.summary_cn || item.summary || '',
        summary_en: item.summary_en || '',
        description: item.description || item.summary_en || '',
        trigger: item.trigger || '',
        usageGuide: item.usageGuide || item.usageGuide_cn || '',
        usageGuide_cn: item.usageGuide_cn || item.usageGuide || '',
        usageGuide_en: item.usageGuide_en || '',
        headers: item.headers || [],
        rationale: item.rationale || '',
        knowledgeType: item.knowledgeType || 'code-pattern',
        tags: item.tags || [],
        sourceFile: item._sourceFile || '',
        // 草稿不含 reasoning — _createCandidateItem 会自动生成默认值
      };
      await _createCandidateItem(candidateService, normalized, source, { targetName: args.targetName || '_draft' });
      count++;
    } catch (err) {
      submitErrors.push({ title: item.title || '(untitled)', error: err.message });
    }
  }

  // 删除成功文件
  const deleted = [];
  if (args.deleteAfterSubmit && count > 0) {
    for (const f of successFiles) {
      try { fs.unlinkSync(f.path); deleted.push(f.name); } catch { /* ignore */ }
    }
  }

  let msg = `已提交 ${count}/${recipes.length} 条 Recipe 候选（target: ${args.targetName || '_draft'}）。`;
  if (deleted.length > 0) msg += ` 已删除草稿: ${deleted.join(', ')}。`;
  if (parseErrors.length > 0) msg += `\n⚠️ 解析失败:\n${parseErrors.join('\n')}`;
  if (submitErrors.length > 0) msg += `\n⚠️ 提交失败:\n${submitErrors.map(e => `  ${e.title}: ${e.error}`).join('\n')}`;

  const data = { count, total: recipes.length, targetName: args.targetName || '_draft', deleted };
  if (submitErrors.length > 0) data.errors = submitErrors;
  return envelope({ success: true, data, message: msg, meta: { tool: 'autosnippet_submit_draft_recipes' } });
}

// ─── 语义字段缺失诊断（无 AI 依赖） ──────────────────────────

/**
 * enrichCandidates — 诊断候选的语义字段缺失情况
 *
 * 设计原则：MCP 调用方是外部 AI Agent，不需要项目内置 AI 补全。
 * 本工具仅做「字段完整性检查」，返回每个候选缺失了哪些语义字段，
 * Agent 据此自行补全后调用 submit_candidates 更新。
 */
export async function enrichCandidates(ctx, args) {
  const ids = args.candidateIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('candidateIds array is required and must not be empty');
  }
  if (ids.length > 20) {
    throw new Error('Max 20 candidates per enrichment call');
  }

  const candidateService = ctx.container.get('candidateService');
  if (!candidateService) throw new Error('CandidateService not available');

  const SEMANTIC_KEYS = ['rationale', 'knowledgeType', 'complexity', 'scope', 'steps', 'constraints'];
  // Recipe-Ready 必填字段（category/trigger/summary*/headers 等）
  const RECIPE_READY_KEYS = [
    { key: 'category', check: v => v && ['View','Service','Tool','Model','Network','Storage','UI','Utility'].includes(v), hint: 'category 必须为 8 标准值之一' },
    { key: 'trigger', check: v => v && v.startsWith('@'), hint: 'trigger 必须以 @ 开头' },
    { key: 'summary', check: v => !!v, hint: '中文摘要（summary / summary_cn）' },
    { key: 'summary_en', check: v => !!v, hint: '英文摘要' },
    { key: 'headers', check: v => Array.isArray(v) && v.length > 0, hint: '完整 import 语句数组' },
    { key: 'usageGuide', check: v => !!v, hint: '使用指南（Markdown ### 章节）' },
  ];

  const results = [];
  let needsEnrichment = 0;
  let needsRecipeFields = 0;
  for (const id of ids) {
    try {
      const candidate = await candidateService.candidateRepository.findById(id);
      if (!candidate) {
        results.push({ id, found: false, missingFields: [], recipeReadyMissing: [] });
        continue;
      }
      const meta = candidate.metadata || {};

      // 语义字段检查
      const missing = [];
      for (const key of SEMANTIC_KEYS) {
        const val = meta[key];
        if (val === undefined || val === null || val === '' ||
            (typeof val === 'string' && val.trim() === '') ||
            (Array.isArray(val) && val.length === 0) ||
            (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0)) {
          missing.push(key);
        }
      }

      // Recipe-Ready 字段检查
      const recipeReadyMissing = [];
      for (const { key, check, hint } of RECIPE_READY_KEYS) {
        const val = key === 'category' ? candidate.category : meta[key];
        if (!check(val)) {
          recipeReadyMissing.push({ field: key, hint });
        }
      }

      results.push({
        id,
        found: true,
        title: meta.title || '',
        language: candidate.language,
        missingFields: missing,
        recipeReadyMissing,
        complete: missing.length === 0 && recipeReadyMissing.length === 0,
      });
      if (missing.length > 0) needsEnrichment++;
      if (recipeReadyMissing.length > 0) needsRecipeFields++;
    } catch (err) {
      results.push({ id, found: false, error: err.message, missingFields: [], recipeReadyMissing: [] });
    }
  }

  return envelope({
    success: true,
    data: {
      total: ids.length,
      needsEnrichment,
      needsRecipeFields,
      fullyComplete: ids.length - Math.max(needsEnrichment, needsRecipeFields),
      candidates: results,
      hint: (needsEnrichment > 0 || needsRecipeFields > 0)
        ? '请 Agent 根据 missingFields（语义）和 recipeReadyMissing（Recipe 必填）自行补全后重新提交'
        : '所有候选字段完整，可直接审核为 Recipe',
    },
    meta: { tool: 'autosnippet_enrich_candidates' },
  });
}
