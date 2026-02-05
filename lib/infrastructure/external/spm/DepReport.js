/**
 * DepReport - 依赖报告输出
 */
class DepReport {
  buildMissingDependencyReport(packageSwiftPath, fromTarget, toTarget) {
  return `Package.swift: ${packageSwiftPath}\n在 .target(name: "${fromTarget}", ...) 的 dependencies 中添加：\n\t - "${toTarget}"`;
  }
}

module.exports = DepReport;
