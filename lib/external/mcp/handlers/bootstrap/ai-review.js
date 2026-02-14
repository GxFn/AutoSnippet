/**
 * Bootstrap AI Review — 公共入口（Barrel Re-export）
 *
 * v5.1 拆分为 4 个模块文件（review/ 目录下），本文件保持原始导出接口不变。
 *
 *   review/ai-pipeline.js   — 三轮审查流程 + _aiChatWithRetry
 *   review/prompts.js       — 三个 Round 的 prompt 构建函数
 *   review/drift-guard.js   — guardRound1Drift + guardRound2Drift + overlap 计算
 *   review/merge.js         — mergeCandidateGroups 合并工具
 */

// ── 审查管线 ──
export {
  reviewRound1_EligibilityGate,
  reviewRound2_ContentRefine,
  reviewRound3_DedupAndRelations,
} from './review/ai-pipeline.js';

// ── 合并工具 ──
export { mergeCandidateGroups } from './review/merge.js';

// ── 反漂移护栏 ──
export { guardRound1Drift, guardRound2Drift } from './review/drift-guard.js';
