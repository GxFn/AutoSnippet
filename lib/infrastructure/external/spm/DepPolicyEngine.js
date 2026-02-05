/**
 * DepPolicyEngine - SPM 依赖策略引擎
 *
 * 只负责判断依赖方向与是否阻断，
 * 不执行修补与写入。
 */
class DepPolicyEngine {
  checkPolicy({ fromTarget, toTarget, depGraph, analysis, isReachable }) {
  const levels = analysis?.levels || {};
  const systemModules = analysis?.systemModules || [];

  const fromLevel = systemModules.includes(fromTarget) ? 0 : (levels[fromTarget] ?? Infinity);
  const toLevel = systemModules.includes(toTarget) ? 0 : (levels[toTarget] ?? Infinity);

  let direction = 'same-level';
  if (toLevel < fromLevel) direction = 'upward';
  else if (toLevel > fromLevel) direction = 'downward';

  const canReachBack = typeof isReachable === 'function'
    ? isReachable(depGraph, toTarget, fromTarget)
    : false;

  if (canReachBack) {
    return {
    blocked: true,
    reason: 'cycleBlocked',
    message: `会形成循环依赖：${fromTarget} -> ${toTarget} -> ... -> ${fromTarget}`,
    fromLevel,
    toLevel,
    direction
    };
  }

  if (direction === 'downward') {
    return {
    blocked: true,
    reason: 'downwardDependency',
    message: `反向依赖：${fromTarget}(L${fromLevel}) -> ${toTarget}(L${toLevel})，违反分层架构原则。`,
    fromLevel,
    toLevel,
    direction
    };
  }

  return { blocked: false, fromLevel, toLevel, direction };
  }
}

module.exports = DepPolicyEngine;
