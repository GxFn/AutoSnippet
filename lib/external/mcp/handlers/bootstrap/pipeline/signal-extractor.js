/**
 * pipeline/signal-extractor.js — 轻量信号提取器 (v7)
 *
 * 将全量启发式候选转换为轻量 Signal 格式:
 *   - 直接从候选对象的结构化字段提取信号
 *   - 优先使用 _scanResult（scanner 结构化输出），避免从 Markdown 反向提取
 *   - 保留分布统计 + 代码样本 + 启发式提示 + 关联线索
 *
 * v7 核心改进：
 *   - 移除 extractBestSnippets() — 不再从 Markdown 代码块中反向提取
 *   - 移除 extractConventionHints() — 不再从 Markdown "## 约定" 中反向解析
 *   - 移除 extractVariantStats() — 直接使用 _scanResult.variants
 *   - 新增 distribution 字段 — 直接从 _scanResult.variants 构建写法分布
 *   - 新增 samples 字段 — 直接从 _scanResult.variants[].examples 取代码样本
 *
 * @module pipeline/signal-extractor
 */

import { extractDimensionCandidates } from '../dimensions.js';

/**
 * 从全量候选中提取轻量信号
 *
 * @param {object} dim — 维度定义 (id, label, guide, ...)
 * @param {Array} allFiles — 全部项目文件
 * @param {object} targetFileMap — target → files 映射
 * @param {object} context — 提取上下文 (depGraphData, guardAudit, langStats, primaryLang, ast, pipelineCtx)
 * @returns {Array<Signal>} 信号数组
 */
export function extractDimensionSignals(dim, allFiles, targetFileMap, context) {
  // 复用现有提取器获取完整候选
  const candidates = extractDimensionCandidates(dim, allFiles, targetFileMap, context);

  if (!candidates || candidates.length === 0) {
    return { signals: [], candidates: [] };
  }

  // 将每个候选转换为轻量信号，同时返回原始候选供 Skill 生成复用
  return {
    signals: candidates.map(c => candidateToSignal(c, dim.id)),
    candidates,
  };
}

/**
 * 将单个候选对象转换为轻量信号
 *
 * v7 核心: 优先从 _scanResult 直接构建，不再从 Markdown (code 字段) 反向提取。
 *
 * @param {object} candidate — 完整候选对象
 * @param {string} dimId — 维度 ID
 * @returns {Signal}
 */
function candidateToSignal(candidate, dimId) {
  const signal = {
    dimId,
    subTopic: candidate.subTopic || 'unknown',

    evidence: {
      matchCount: 0,
      topFiles: [],
      distribution: [],    // v7: 写法分布 [{ label, fileCount, pct, boilerplate }]
      samples: [],          // v7: 代码样本 [{ file, line, code }]，直接来自 scanner
    },

    heuristicHints: [],
    relatedSignals: [],
  };

  const scanResult = candidate._scanResult;

  // ── 证据统计: 优先从 _scanResult 获取 ──
  if (scanResult && scanResult.variants) {
    signal.evidence.matchCount = scanResult.totalFiles || 0;

    // 写法分布 — 直接从 scanner 结构化数据构建
    signal.evidence.distribution = scanResult.variants
      .filter(v => v.fileCount > 0)
      .map(v => ({
        label: v.label,
        fileCount: v.fileCount,
        pct: scanResult.totalFiles > 0
          ? Math.round(v.fileCount / scanResult.totalFiles * 100)
          : 0,
        boilerplate: !!v.boilerplate,
      }));

    // 代码样本 — 直接从 scanner examples 取，不再从 Markdown 反向提取
    // 注意: ex.block 是 string[] (extractEnclosingBlock 返回行数组)
    const _blockToStr = (b) => (Array.isArray(b) ? b.join('\n') : (b || '')).trim();
    const allExamples = scanResult.variants
      .filter(v => !v.boilerplate)  // 优先非-boilerplate 变体的样本
      .flatMap(v => (v.examples || []).map(ex => ({
        file: ex.file,
        line: ex.lineNum || 0,
        code: _blockToStr(ex.block),
        variant: v.label,
      })));

    // 再补充 boilerplate 变体的样本
    const boilerplateExamples = scanResult.variants
      .filter(v => v.boilerplate)
      .flatMap(v => (v.examples || []).map(ex => ({
        file: ex.file,
        line: ex.lineNum || 0,
        code: _blockToStr(ex.block),
        variant: v.label,
      })));

    signal.evidence.samples = [...allExamples, ...boilerplateExamples]
      .filter(s => s.code.length > 5)
      .slice(0, MAX_SAMPLES_PER_SIGNAL);

    // topFiles 从变体 examples 中汇总
    const allFiles = scanResult.variants.flatMap(v => (v.examples || []).map(e => e.file));
    signal.evidence.topFiles = [...new Set(allFiles)].slice(0, 5);

  } else {
    // 降级: 无 _scanResult 时从 sources + summary 构建信号
    if (candidate.sources && Array.isArray(candidate.sources)) {
      signal.evidence.topFiles = candidate.sources.slice(0, 5);
      signal.evidence.matchCount = candidate.sources.length;
    }

    // 从 summary 中提取关键数字指标
    const metrics = _extractMetricsFromSummary(candidate.summary || '');
    if (metrics) {
      signal.evidence.metrics = metrics;
    }

    // 为 Agent 生成搜索建议: 基于 subTopic 和 tags 推断有价值的搜索词
    const searchHints = _generateSearchHints(candidate);
    if (searchHints.length > 0) {
      signal.evidence.searchHints = searchHints;
    }
  }

  // ── 启发式提示: 直接从 summary 获取 ──
  if (candidate.summary) {
    signal.heuristicHints.push(candidate.summary);
  }

  // ── 关联信号 ──
  if (candidate.relations && Array.isArray(candidate.relations)) {
    signal.relatedSignals = candidate.relations.map(r => {
      if (typeof r === 'string') return r;
      return r.target || r.title || '';
    }).filter(Boolean).slice(0, 3);
  }

  // ── Skill 增强标记 ──
  if (candidate._skillEnhanced) {
    signal.heuristicHints.push('[Skill增强] ' + (candidate._skillReference || '').slice(0, 120));
  }

  // ── 额外元数据(供 prompt 构建器使用) ──
  signal._meta = {
    knowledgeType: candidate.knowledgeType,
    tags: candidate.tags || [],
    language: candidate.language || 'swift',
    title: candidate.title || '',
  };

  return signal;
}

// ─── 常量 ──────────────────────────────────────────

/** 每子主题保留的最大代码样本数 (v9: 4→2，配合 PROMPT_LIMITS.maxSamplesPerSignal) */
const MAX_SAMPLES_PER_SIGNAL = 2;

// ─── 辅助函数 (宏观维度信号增强) ────────────────────

/**
 * 从 summary 字符串中提取关键数字指标
 * summary 格式通常为: "code-standard/naming: 命名约定：BIL 前缀，36 个类，18 个协议"
 * @param {string} summary
 * @returns {object|null} 指标对象
 */
function _extractMetricsFromSummary(summary) {
  if (!summary || summary.length < 5) return null;

  const metrics = {};
  // 匹配 "N 个X" 或 "N X" 模式
  const numMatches = summary.matchAll(/(\d+)\s*(?:个|条|处|种|层)?\s*(文件|类|协议|方法|模块|Target|边|违规|写法|框架|测试|错误|警告|常量|宏|Category|Extension)/g);
  for (const m of numMatches) {
    const key = m[2].toLowerCase().replace(/\s+/g, '_');
    metrics[key] = parseInt(m[1], 10);
  }

  // 匹配百分比
  const pctMatches = summary.matchAll(/(\d+)\s*%/g);
  for (const m of pctMatches) {
    if (!metrics._pct) metrics._pct = [];
    metrics._pct.push(parseInt(m[1], 10));
  }

  // 匹配首选写法/架构模式
  const preferMatch = summary.match(/首选\s+(.+?)(?:\s*[（(]|$)/);
  if (preferMatch) metrics._preferred = preferMatch[1].trim();

  return Object.keys(metrics).length > 0 ? metrics : null;
}

/**
 * 根据候选的 tags/subTopic/knowledgeType 生成搜索建议
 * Agent 可参考 searchHints 主动调用 search_project_code
 * @param {object} candidate
 * @returns {string[]}
 */
function _generateSearchHints(candidate) {
  const hints = [];
  const st = candidate.subTopic || '';
  const kt = candidate.knowledgeType || '';

  // 宏观维度搜索建议映射
  const hintMap = {
    'naming':       ['@interface', '@protocol', 'NS_SWIFT_NAME'],
    'file-organization': ['#pragma mark', '// MARK:', 'MARK: -'],
    'api-naming':   ['- (void)', '- (BOOL)', 'func '],
    'comment-style': ['///','/**','// TODO','// FIXME'],
    'layer-overview': ['@interface', 'ViewController', 'Manager', 'Service'],
    'dependency-graph': ['#import', '@import', 'import '],
    'boundary-rules':  ['#import', 'import Foundation'],
    'overview':     ['AppDelegate', 'main.m', '@UIApplicationMain'],
    'tech-stack':   ['UIKit', 'SwiftUI', 'Alamofire', 'Masonry'],
    'third-party-deps': ['pod ', 'Podfile', 'Cartfile', 'Package.swift'],
    'base-extensions': ['@implementation.*\\(', 'extension '],
    'base-classes': ['#define', 'extern NSString', 'static let', 'static NSString'],
    'event-hooks':  ['+load', '+initialize', 'applicationDidFinishLaunching', 'viewDidLoad'],
    'infra-services': ['sharedInstance', 'Manager', 'Service', 'Engine'],
    'runtime-and-interop': ['method_exchangeImplementations', 'objc_setAssociatedObject', '@objc'],
    'todo-fixme':   ['TODO', 'FIXME', 'HACK', 'XXX'],
    'deprecated-api': ['__deprecated', 'API_DEPRECATED', '@available'],
    'swizzle-hooks': ['method_exchangeImplementations', 'class_replaceMethod', 'Aspects'],
  };

  // 按 subTopic 查找
  for (const [key, terms] of Object.entries(hintMap)) {
    if (st.includes(key)) {
      hints.push(...terms);
      break;
    }
  }

  // 如果没有匹配到，基于 knowledgeType 给出通用建议
  if (hints.length === 0) {
    if (kt === 'architecture') hints.push('@interface', 'import ');
    else if (kt === 'code-standard') hints.push('@interface', '#pragma mark');
    else if (kt === 'call-chain' || kt === 'data-flow') hints.push('NSNotification', 'addObserver', 'delegate');
  }

  return hints.slice(0, 3);
}
