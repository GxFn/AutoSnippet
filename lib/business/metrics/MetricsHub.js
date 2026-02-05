/**
 * MetricsHub - 指标收集和管理
 * 
 * 功能：
 * - 收集系统指标（CPU、内存、搜索性能等）
 * - 自定义指标支持
 * - 指标查询和聚合
 * - 告警阈值管理
 * - 时间序列数据
 */

/**
 * 指标数据点
 */
class MetricPoint {
  constructor(name, value, tags = {}, unit = 'count') {
  this.id = Math.random().toString(36).substr(2, 9);
  this.name = name;
  this.value = value;
  this.tags = tags;
  this.unit = unit;
  this.timestamp = Date.now();
  }
}

/**
 * 指标统计
 */
class MetricStats {
  constructor(name, points = []) {
  this.name = name;
  this.count = points.length;
  this.min = points.length > 0 ? Math.min(...points.map(p => p.value)) : 0;
  this.max = points.length > 0 ? Math.max(...points.map(p => p.value)) : 0;
  this.sum = points.reduce((sum, p) => sum + p.value, 0);
  this.avg = this.count > 0 ? this.sum / this.count : 0;
  this.stdDev = this._calculateStdDev(points);
  this.p50 = this._percentile(points, 0.5);
  this.p95 = this._percentile(points, 0.95);
  this.p99 = this._percentile(points, 0.99);
  }

  _calculateStdDev(points) {
  if (points.length === 0) return 0;
  const squareDiffs = points.map(p => Math.pow(p.value - this.avg, 2));
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / points.length);
  }

  _percentile(points, p) {
  if (points.length === 0) return 0;
  const sorted = points.map(pt => pt.value).sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[index] || 0;
  }
}

/**
 * 告警规则
 */
class AlertRule {
  constructor(name, metricName, condition, threshold, duration = 60000) {
  this.id = Math.random().toString(36).substr(2, 9);
  this.name = name;
  this.metricName = metricName;
  this.condition = condition; // 'gt', 'lt', 'eq'
  this.threshold = threshold;
  this.duration = duration; // 触发告警需要的持续时间（毫秒）
  this.enabled = true;
  this.violations = [];
  this.lastViolation = null;
  }

  /**
   * 检查指标是否违反规则
   */
  check(value) {
  const violation = this._checkCondition(value);
  if (violation) {
    this.violations.push({
    timestamp: Date.now(),
    value
    });
    this.lastViolation = Date.now();
    return true;
  }
  return false;
  }

  _checkCondition(value) {
  switch (this.condition) {
    case 'gt':
    return value > this.threshold;
    case 'lt':
    return value < this.threshold;
    case 'eq':
    return value === this.threshold;
    default:
    return false;
  }
  }

  /**
   * 清空违规历史
   */
  clearViolations() {
  this.violations = [];
  this.lastViolation = null;
  return this;
  }

  /**
   * 获取规则状态
   */
  getStatus() {
  return {
    id: this.id,
    name: this.name,
    enabled: this.enabled,
    violations: this.violations.length,
    lastViolation: this.lastViolation
  };
  }
}

/**
 * 指标聚合器
 */
class MetricsHub {
  constructor(options = {}) {
  this.metrics = new Map(); // name -> MetricPoint[]
  this.customMetrics = new Map(); // name -> {type, unit, tags}
  this.alerts = new Map(); // id -> AlertRule
  this.stats = new Map(); // name -> MetricStats
  this.maxPoints = options.maxPoints || 10000;
  this.retention = options.retention || 86400000; // 24小时
  }

  /**
   * 记录指标
   */
  record(name, value, tags = {}, unit = 'count') {
  const point = new MetricPoint(name, value, tags, unit);

  // 初始化指标数组
  if (!this.metrics.has(name)) {
    this.metrics.set(name, []);
    this.customMetrics.set(name, { type: 'counter', unit, tags: {} });
  }

  const points = this.metrics.get(name);
  points.push(point);

  // 限制数据点数量
  if (points.length > this.maxPoints) {
    points.shift();
  }

  // 检查告警规则
  this._checkAlerts(name, value);

  // 更新统计
  this._updateStats(name);

  return this;
  }

  /**
   * 记录仪表（Gauge）指标
   */
  gauge(name, value, tags = {}, unit = 'count') {
  if (!this.customMetrics.has(name)) {
    this.customMetrics.set(name, { type: 'gauge', unit, tags });
  }
  return this.record(name, value, tags, unit);
  }

  /**
   * 记录计数器指标
   */
  counter(name, delta = 1, tags = {}) {
  if (!this.metrics.has(name)) {
    this.record(name, delta, tags, 'count');
  } else {
    const points = this.metrics.get(name);
    const lastValue = points.length > 0 ? points[points.length - 1].value : 0;
    this.record(name, lastValue + delta, tags, 'count');
  }
  return this;
  }

  /**
   * 记录直方图指标（用于延迟等）
   */
  histogram(name, value, tags = {}, unit = 'ms') {
  return this.record(name, value, tags, unit);
  }

  /**
   * 添加告警规则
   */
  addAlert(name, metricName, condition, threshold, duration) {
  const alert = new AlertRule(name, metricName, condition, threshold, duration);
  this.alerts.set(alert.id, alert);
  return alert.id;
  }

  /**
   * 移除告警规则
   */
  removeAlert(alertId) {
  this.alerts.delete(alertId);
  return this;
  }

  /**
   * 获取告警规则
   */
  getAlert(alertId) {
  return this.alerts.get(alertId);
  }

  /**
   * 获取所有告警规则
   */
  getAllAlerts() {
  return Array.from(this.alerts.values());
  }

  /**
   * 获取指标的最新值
   */
  getLatest(name) {
  const points = this.metrics.get(name);
  if (!points || points.length === 0) return null;
  return points[points.length - 1];
  }

  /**
   * 获取指标的所有数据点
   */
  getPoints(name, limit = null) {
  const points = this.metrics.get(name) || [];
  if (limit && limit > 0) {
    return points.slice(-limit);
  }
  return points;
  }

  /**
   * 获取指标统计
   */
  getStats(name) {
  return this.stats.get(name) || null;
  }

  /**
   * 获取时间范围内的指标
   */
  getRange(name, startTime, endTime) {
  const points = this.metrics.get(name) || [];
  return points.filter(p => p.timestamp >= startTime && p.timestamp <= endTime);
  }

  /**
   * 获取指定标签的指标
   */
  getByTags(name, tags) {
  const points = this.metrics.get(name) || [];
  return points.filter(p => {
    return Object.entries(tags).every(([k, v]) => p.tags[k] === v);
  });
  }

  /**
   * 聚合多个指标
   */
  aggregate(names, operation = 'sum') {
  const allPoints = [];

  for (const name of names) {
    const points = this.metrics.get(name) || [];
    allPoints.push(...points);
  }

  if (allPoints.length === 0) {
    return { result: 0, count: 0 };
  }

  const values = allPoints.map(p => p.value);

  let result;
  switch (operation) {
    case 'sum':
    result = values.reduce((a, b) => a + b, 0);
    break;
    case 'avg':
    result = values.reduce((a, b) => a + b, 0) / values.length;
    break;
    case 'min':
    result = Math.min(...values);
    break;
    case 'max':
    result = Math.max(...values);
    break;
    default:
    result = 0;
  }

  return { result, count: allPoints.length };
  }

  /**
   * 计算增长率
   */
  getGrowthRate(name, intervalCount = 2) {
  const points = this.metrics.get(name) || [];
  if (points.length < intervalCount) return 0;

  const recent = points.slice(-intervalCount);
  const values = recent.map(p => p.value);

  if (values[0] === 0) return 0;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
  }

  /**
   * 导出指标数据
   */
  export(format = 'json') {
  const data = {
    timestamp: Date.now(),
    metrics: {},
    stats: {},
    alerts: {}
  };

  for (const [name, points] of this.metrics) {
    data.metrics[name] = points;
    data.stats[name] = this.stats.get(name);
  }

  for (const [id, alert] of this.alerts) {
    data.alerts[id] = alert.getStatus();
  }

  return data;
  }

  /**
   * 清空所有指标
   */
  clear() {
  this.metrics.clear();
  this.customMetrics.clear();
  this.stats.clear();
  return this;
  }

  /**
   * 清空特定指标
   */
  clearMetric(name) {
  this.metrics.delete(name);
  this.stats.delete(name);
  this.customMetrics.delete(name);
  return this;
  }

  /**
   * 获取所有指标名称
   */
  getMetricNames() {
  return Array.from(this.metrics.keys());
  }

  /**
   * 获取指标数量
   */
  getMetricCount() {
  return this.metrics.size;
  }

  /**
   * 清理过期数据
   */
  cleanup() {
  const now = Date.now();
  let removed = 0;

  for (const points of this.metrics.values()) {
    const before = points.length;
    const filtered = points.filter(p => now - p.timestamp < this.retention);
    // 替换数组内容
    points.length = 0;
    points.push(...filtered);
    removed += before - points.length;
  }

  return { removed };
  }

  /**
   * 获取详细的系统统计
   */
  getSummary() {
  const summary = {
    timestamp: Date.now(),
    metricCount: this.getMetricCount(),
    totalPoints: Array.from(this.metrics.values()).reduce((sum, p) => sum + p.length, 0),
    alertCount: this.alerts.size,
    violationCount: Array.from(this.alerts.values()).reduce((sum, a) => sum + a.violations.length, 0)
  };

  return summary;
  }

  /**
   * 内部：检查告警规则
   */
  _checkAlerts(metricName, value) {
  for (const alert of this.alerts.values()) {
    if (alert.metricName === metricName && alert.enabled) {
    alert.check(value);
    }
  }
  }

  /**
   * 内部：更新统计信息
   */
  _updateStats(name) {
  const points = this.metrics.get(name) || [];
  this.stats.set(name, new MetricStats(name, points));
  }
}

module.exports = {
  MetricsHub,
  MetricPoint,
  MetricStats,
  AlertRule
};
