/**
 * ImportDecisionEngine - 头文件注入决策引擎
 *
 * 仅负责根据依赖检查结果给出决策，
 * 不执行任何副作用（不写文件、不弹窗）。
 */
class ImportDecisionEngine {
  evaluate({ ensureResult, fromTarget, toTarget }) {
  if (!ensureResult) {
    return { action: 'continue' };
  }

  if (ensureResult.ok) {
    return { action: 'continue' };
  }

  const reason = ensureResult.reason;

  if (reason === 'cycleBlocked' || reason === 'downwardDependency') {
    return {
    action: 'block',
    reason,
    message: ensureResult.message || '',
    fromTarget,
    toTarget
    };
  }

  return {
    action: 'review',
    reason,
    allowActions: ensureResult.allowActions || [],
    fromTarget,
    toTarget
  };
  }
}

module.exports = ImportDecisionEngine;
