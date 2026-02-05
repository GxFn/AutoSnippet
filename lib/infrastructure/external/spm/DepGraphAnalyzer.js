/**
 * DepGraphAnalyzer - 依赖图分析器
 * 负责层级计算、拓扑排序、依赖方向判断
 */
class DepGraphAnalyzer {
  /**
   * 分析依赖图，提取层级和拓扑信息
   * @param {Object} depGraph - 依赖图
   * @returns {Object} { levels, topology, systemModules }
   */
  analyze(depGraph) {
  return {
    levels: this._computeLevels(depGraph),
    topology: this._topologicalSort(depGraph),
    systemModules: this._identifySystemModules(depGraph)
  };
  }

  /**
   * 计算每个 target 的层级
   * L0: 无依赖的基础模块
   * L1: 只依赖 L0
   * L2: 依赖 L0/L1
   * ...
   */
  _computeLevels(depGraph) {
  const levels = {};
  const queue = [];
  if (!depGraph || !depGraph.targets) return levels;
  // 找出所有无依赖的节点（L0）
  for (const target in depGraph.targets) {
    const deps = depGraph.targets[target].dependencies || [];
    if (deps.length === 0) {
    levels[target] = 0;
    queue.push(target);
    }
  }
  // BFS 计算层级
  while (queue.length > 0) {
    const current = queue.shift();
    const currentLevel = levels[current];
    for (const target in depGraph.targets) {
    const deps = depGraph.targets[target].dependencies || [];
    if (deps.includes(current)) {
      if (levels[target] === undefined) {
      levels[target] = currentLevel + 1;
      queue.push(target);
      } else {
      levels[target] = Math.max(levels[target], currentLevel + 1);
      }
    }
    }
  }
  return levels;
  }

  /**
   * 拓扑排序
   */
  _topologicalSort(depGraph) {
  const inDegree = {};
  const result = [];
  if (!depGraph || !depGraph.targets) return result;
  for (const target in depGraph.targets) {
    inDegree[target] = 0;
  }
  for (const target in depGraph.targets) {
    const deps = depGraph.targets[target].dependencies || [];
    deps.forEach(dep => {
    if (inDegree[dep] !== undefined) inDegree[dep]++;
    });
  }
  const queue = Object.keys(inDegree).filter(t => inDegree[t] === 0);
  while (queue.length > 0) {
    const node = queue.shift();
    result.push(node);
    const deps = depGraph.targets[node].dependencies || [];
    deps.forEach(dep => {
    inDegree[dep]--;
    if (inDegree[dep] === 0) queue.push(dep);
    });
  }
  return result;
  }

  /**
   * 识别系统模块（Framework）
   */
  _identifySystemModules(depGraph) {
  const systemNames = ['Foundation', 'UIKit', 'AppKit', 'CoreData', 'CoreGraphics'];
  if (!depGraph || !depGraph.targets) return [];
  return Object.keys(depGraph.targets).filter(t =>
    systemNames.some(s => t.includes(s))
  );
  }
}

module.exports = DepGraphAnalyzer;
