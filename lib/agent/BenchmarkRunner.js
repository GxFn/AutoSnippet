/**
 * BenchmarkRunner - 性能基准测试和负载测试
 * 
 * 职责：
 * - 性能基准测试
 * - 并发负载测试
 * - 内存泄漏检测
 * - 性能瓶颈识别
 */

const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

class BenchmarkRunner {
  constructor(options = {}) {
  this.name = 'BenchmarkRunner';
  this.version = '1.0.0';

  this.config = {
    warmupIterations: options.warmupIterations || 3,
    testIterations: options.testIterations || 10,
    concurrentRequests: options.concurrentRequests || 5,
    memoryCheckInterval: options.memoryCheckInterval || 1000,
    resultDir: options.resultDir || './benchmarks',
    ...options
  };

  this.logger = options.logger || console;
  this.results = {
    benchmarks: {},
    memory: [],
    concurrent: {},
    summary: {}
  };

  // 创建结果目录
  if (!fs.existsSync(this.config.resultDir)) {
    fs.mkdirSync(this.config.resultDir, { recursive: true });
  }
  }

  /**
   * 运行基准测试
   * @param {string} name - 测试名称
   * @param {Function} testFn - 测试函数
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 测试结果
   */
  async benchmark(name, testFn, options = {}) {
  const iterations = options.iterations || this.config.testIterations;
  const warmupIterations = options.warmupIterations || this.config.warmupIterations;

  this.logger.log(`\n⏱️  基准测试: ${name}`);

  // 预热运行
  for (let i = 0; i < warmupIterations; i++) {
    await testFn();
  }

  // 实际测试
  const times = [];
  const startMemory = process.memoryUsage();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await testFn();
    const end = performance.now();
    times.push(end - start);
  }

  const endMemory = process.memoryUsage();

  // 计算统计数据
  const stats = this._calculateStats(times);
  const memoryDelta = {
    heapUsed: endMemory.heapUsed - startMemory.heapUsed,
    heapTotal: endMemory.heapTotal - startMemory.heapTotal,
    external: endMemory.external - startMemory.external
  };

  const result = {
    name,
    iterations,
    ...stats,
    memory: memoryDelta,
    timestamp: new Date().toISOString()
  };

  this.results.benchmarks[name] = result;

  // 打印结果
  this._printBenchmarkResult(result);

  return result;
  }

  /**
   * 运行并发测试
   * @param {string} name - 测试名称
   * @param {Function} testFn - 测试函数
   * @param {number} concurrentCount - 并发数
   * @returns {Promise<Object>} 测试结果
   */
  async concurrentTest(name, testFn, concurrentCount = this.config.concurrentRequests) {
  this.logger.log(`\n⚡ 并发测试: ${name} (并发数: ${concurrentCount})`);

  const startMemory = process.memoryUsage();
  const startTime = performance.now();

  // 创建并发任务
  const tasks = [];
  for (let i = 0; i < concurrentCount; i++) {
    tasks.push(testFn());
  }

  // 等待所有任务完成
  let successCount = 0;
  let errorCount = 0;
  const responseTimes = [];

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'fulfilled') {
    successCount++;
    if (result.value && result.value.time) {
      responseTimes.push(result.value.time);
    }
    } else {
    errorCount++;
    }
  }

  const totalTime = performance.now() - startTime;
  const endMemory = process.memoryUsage();

  const concurrentResult = {
    name,
    concurrentCount,
    totalTime: totalTime.toFixed(2),
    successCount,
    errorCount,
    successRate: ((successCount / concurrentCount) * 100).toFixed(2) + '%',
    avgResponseTime: responseTimes.length > 0
    ? (responseTimes.reduce((a, b) => a + b) / responseTimes.length).toFixed(2)
    : 'N/A',
    throughput: (concurrentCount / (totalTime / 1000)).toFixed(2) + ' ops/sec',
    memory: {
    heapUsed: endMemory.heapUsed - startMemory.heapUsed,
    heapTotal: endMemory.heapTotal - startMemory.heapTotal
    },
    timestamp: new Date().toISOString()
  };

  this.results.concurrent[name] = concurrentResult;
  this._printConcurrentResult(concurrentResult);

  return concurrentResult;
  }

  /**
   * 内存泄漏检测
   * @param {string} name - 测试名称
   * @param {Function} testFn - 测试函数
   * @param {number} iterations - 迭代次数
   * @returns {Promise<Object>} 检测结果
   */
  async memoryLeakTest(name, testFn, iterations = 100) {
  this.logger.log(`\n💾 内存泄漏检测: ${name}`);

  const memorySnapshots = [];
  const baseMemory = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i++) {
    if (i % 10 === 0) {
    const gc = global.gc;
    if (gc) gc();
    
    const current = process.memoryUsage().heapUsed;
    memorySnapshots.push({
      iteration: i,
      heapUsed: current,
      delta: current - baseMemory
    });
    }

    await testFn();
  }

  // 分析内存增长趋势
  const trend = this._analyzeMemoryTrend(memorySnapshots);

  const leakResult = {
    name,
    iterations,
    snapshots: memorySnapshots,
    trend,
    hasLeak: trend.slope > 1000, // 每次迭代增长超过 1KB
    timestamp: new Date().toISOString()
  };

  this._printMemoryLeakResult(leakResult);
  return leakResult;
  }

  /**
   * 端到端性能测试
   * @param {Function} workflowFn - 完整工作流函数
   * @returns {Promise<Object>} 测试结果
   */
  async endToEndTest(workflowFn) {
  this.logger.log('\n🔄 端到端性能测试');

  const stages = [];
  let stageIndex = 0;

  // 创建阶段计时函数
  const captureStage = async (stageName, fn) => {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    stages.push({ stage: stageName, duration: duration.toFixed(2) });
    this.logger.log(`  └─ ${stageName}: ${duration.toFixed(2)}ms`);
    return result;
  };

  const startTime = performance.now();
  const startMemory = process.memoryUsage();

  // 执行工作流
  await workflowFn(captureStage);

  const totalTime = performance.now() - startTime;
  const endMemory = process.memoryUsage();

  const e2eResult = {
    stages,
    totalTime: totalTime.toFixed(2),
    memory: {
    heapUsed: endMemory.heapUsed - startMemory.heapUsed,
    heapTotal: endMemory.heapTotal - startMemory.heapTotal
    },
    timestamp: new Date().toISOString()
  };

  this.results.summary = e2eResult;
  this._printE2EResult(e2eResult);

  return e2eResult;
  }

  /**
   * 计算统计数据
   * @private
   */
  _calculateStats(times) {
  times.sort((a, b) => a - b);

  const min = Math.min(...times);
  const max = Math.max(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];

  // 计算标准差
  const variance = times.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) / times.length;
  const stddev = Math.sqrt(variance);

  return {
    min: min.toFixed(2),
    max: max.toFixed(2),
    avg: avg.toFixed(2),
    median: median.toFixed(2),
    p95: p95.toFixed(2),
    p99: p99.toFixed(2),
    stddev: stddev.toFixed(2)
  };
  }

  /**
   * 分析内存增长趋势
   * @private
   */
  _analyzeMemoryTrend(snapshots) {
  if (snapshots.length < 2) {
    return { slope: 0, trend: 'insufficient_data' };
  }

  // 简单线性回归
  const n = snapshots.length;
  const xSum = snapshots.reduce((sum, s, i) => sum + i, 0);
  const ySum = snapshots.reduce((sum, s) => sum + s.delta, 0);
  const xySum = snapshots.reduce((sum, s, i) => sum + i * s.delta, 0);
  const xxSum = snapshots.reduce((sum, _, i) => sum + i * i, 0);

  const slope = (n * xySum - xSum * ySum) / (n * xxSum - xSum * xSum);
  const trend = slope > 1000 ? 'leaking' : slope > 100 ? 'increasing' : 'stable';

  return {
    slope: slope.toFixed(2),
    trend,
    firstHeap: snapshots[0].delta,
    lastHeap: snapshots[snapshots.length - 1].delta
  };
  }

  /**
   * 打印基准测试结果
   * @private
   */
  _printBenchmarkResult(result) {
  console.log(`
  📊 结果摘要:
  • 最小时间: ${result.min}ms
  • 最大时间: ${result.max}ms
  • 平均时间: ${result.avg}ms
  • 中位数:   ${result.median}ms
  • P95:      ${result.p95}ms
  • P99:      ${result.p99}ms
  • 标准差:   ${result.stddev}ms
  • 内存变化: ${(result.memory.heapUsed / 1024).toFixed(2)}KB
  `);
  }

  /**
   * 打印并发测试结果
   * @private
   */
  _printConcurrentResult(result) {
  console.log(`
  ⚡ 结果摘要:
  • 成功率:   ${result.successRate}
  • 总耗时:   ${result.totalTime}ms
  • 平均响应: ${result.avgResponseTime}ms
  • 吞吐量:   ${result.throughput}
  • 内存变化: ${(result.memory.heapUsed / 1024).toFixed(2)}KB
  `);
  }

  /**
   * 打印内存泄漏检测结果
   * @private
   */
  _printMemoryLeakResult(result) {
  console.log(`
  💾 结果摘要:
  • 趋势:     ${result.trend}
  • 斜率:     ${result.trend.slope} bytes/iter
  • 检测:     ${result.hasLeak ? '⚠️ 可能存在泄漏' : '✅ 无泄漏'}
  `);
  }

  /**
   * 打印端到端测试结果
   * @private
   */
  _printE2EResult(result) {
  console.log(`
  🔄 结果摘要:
  • 总耗时:   ${result.totalTime}ms
  • 阶段数:   ${result.stages.length}
  • 最快阶段: ${Math.min(...result.stages.map(s => parseFloat(s.duration))).toFixed(2)}ms
  • 最慢阶段: ${Math.max(...result.stages.map(s => parseFloat(s.duration))).toFixed(2)}ms
  • 内存变化: ${(result.memory.heapUsed / 1024).toFixed(2)}KB
  `);
  }

  /**
   * 生成报告
   * @param {string} reportName - 报告名称
   * @returns {string} 报告路径
   */
  generateReport(reportName = 'benchmark-report') {
  const reportPath = path.join(
    this.config.resultDir,
    `${reportName}-${Date.now()}.json`
  );

  const report = {
    name: reportName,
    generatedAt: new Date().toISOString(),
    benchmarks: this.results.benchmarks,
    concurrent: this.results.concurrent,
    e2e: this.results.summary,
    summary: {
    totalBenchmarks: Object.keys(this.results.benchmarks).length,
    totalConcurrentTests: Object.keys(this.results.concurrent).length,
    bestPerformer: this._findBestPerformer(),
    worstPerformer: this._findWorstPerformer()
    }
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  this.logger.log(`\n📄 报告已保存: ${reportPath}`);

  return reportPath;
  }

  /**
   * 找到性能最好的测试
   * @private
   */
  _findBestPerformer() {
  let best = { name: 'N/A', time: Infinity };
  for (const [name, result] of Object.entries(this.results.benchmarks)) {
    const time = parseFloat(result.avg);
    if (time < best.time) {
    best = { name, time: time.toFixed(2) };
    }
  }
  return best;
  }

  /**
   * 找到性能最差的测试
   * @private
   */
  _findWorstPerformer() {
  let worst = { name: 'N/A', time: 0 };
  for (const [name, result] of Object.entries(this.results.benchmarks)) {
    const time = parseFloat(result.avg);
    if (time > worst.time) {
    worst = { name, time: time.toFixed(2) };
    }
  }
  return worst;
  }

  /**
   * 获取结果
   */
  getResults() {
  return this.results;
  }

  /**
   * 重置结果
   */
  reset() {
  this.results = {
    benchmarks: {},
    memory: [],
    concurrent: {},
    summary: {}
  };
  }
}

module.exports = BenchmarkRunner;
