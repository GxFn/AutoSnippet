/**
 * ProcessHub - 自动化流程框架
 * 
 * 功能：
 * - 进程执行和管理
 * - 重试策略（指数退避）
 * - 超时控制
 * - 进度跟踪
 * - 剪贴板保护（避免互相覆盖）
 * - Xcode 自动化支持
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');

/**
 * 重试策略配置
 */
class RetryStrategy {
  constructor(options = {}) {
  this.maxRetries = options.maxRetries || 3;
  this.initialDelay = options.initialDelay || 1000; // 毫秒
  this.maxDelay = options.maxDelay || 32000; // 32 秒
  this.backoffMultiplier = options.backoffMultiplier || 2;
  }

  /**
   * 计算当前重试次数应该延迟的时间
   */
  getDelay(retryCount) {
  const delay = this.initialDelay * Math.pow(this.backoffMultiplier, retryCount);
  return Math.min(delay, this.maxDelay);
  }

  /**
   * 是否还可以继续重试
   */
  canRetry(retryCount) {
  return retryCount < this.maxRetries;
  }

  /**
   * 获取策略摘要
   */
  toString() {
  return `RetryStrategy(max=${this.maxRetries}, initial=${this.initialDelay}ms, multiplier=${this.backoffMultiplier}x)`;
  }
}

/**
 * 进程执行上下文
 */
class ProcessContext extends EventEmitter {
  constructor(options = {}) {
  super();
  this.id = options.id || Math.random().toString(36).substr(2, 9);
  this.name = options.name || 'unnamed-process';
  this.timeout = options.timeout || 300000; // 5 分钟
  this.retryStrategy = options.retryStrategy || new RetryStrategy();
  this.environment = options.environment || {};
  
  // 状态跟踪
  this.status = 'pending'; // pending, running, success, failed, timeout
  this.startTime = null;
  this.endTime = null;
  this.retryCount = 0;
  this.stdout = '';
  this.stderr = '';
  this.exitCode = null;
  this.progress = 0; // 0-100
  this.result = null;
  }

  /**
   * 记录进度
   */
  setProgress(value) {
  this.progress = Math.max(0, Math.min(100, value));
  this.emit('progress', { id: this.id, progress: this.progress });
  return this;
  }

  /**
   * 获取执行耗时
   */
  getDuration() {
  if (!this.startTime) return 0;
  const end = this.endTime || Date.now();
  return end - this.startTime;
  }

  /**
   * 转换为 JSON
   */
  toJSON() {
  return {
    id: this.id,
    name: this.name,
    status: this.status,
    retryCount: this.retryCount,
    duration: this.getDuration(),
    progress: this.progress,
    exitCode: this.exitCode,
    stdout: this.stdout.substring(0, 500), // 限制大小
    stderr: this.stderr.substring(0, 500),
    result: this.result
  };
  }
}

/**
 * 剪贴板管理器（避免冲突）
 */
class ClipboardManager {
  constructor() {
  this.locked = false;
  this.queue = [];
  this.currentContent = null;
  }

  /**
   * 锁定剪贴板
   */
  async lock() {
  return new Promise(resolve => {
    if (!this.locked) {
    this.locked = true;
    resolve();
    } else {
    this.queue.push(resolve);
    }
  });
  }

  /**
   * 解锁剪贴板
   */
  unlock() {
  if (this.queue.length > 0) {
    const resolve = this.queue.shift();
    resolve();
  } else {
    this.locked = false;
  }
  }

  /**
   * 设置内容（同时持有锁）
   */
  async set(content) {
  await this.lock();
  try {
    this.currentContent = content;
    return true;
  } finally {
    this.unlock();
  }
  }

  /**
   * 获取内容（同时持有锁）
   */
  async get() {
  await this.lock();
  try {
    return this.currentContent;
  } finally {
    this.unlock();
  }
  }

  /**
   * 清空内容
   */
  async clear() {
  await this.lock();
  try {
    this.currentContent = null;
    return true;
  } finally {
    this.unlock();
  }
  }

  /**
   * 获取状态
   */
  getStatus() {
  return {
    locked: this.locked,
    queueLength: this.queue.length,
    hasContent: this.currentContent !== null
  };
  }
}

class ProcessHub extends EventEmitter {
  constructor(options = {}) {
  super();
  this.processes = new Map(); // id -> ProcessContext
  this.defaultRetryStrategy = options.defaultRetryStrategy || new RetryStrategy();
  this.clipboard = new ClipboardManager();
  this.stats = {
    total: 0,
    success: 0,
    failed: 0,
    timeout: 0,
    totalDuration: 0
  };
  }

  /**
   * 执行一个进程
   * 
   * 使用方式：
   * const context = await hub.execute('my-process', 'ls', ['-la'], {
   *   timeout: 5000,
   *   retryStrategy: new RetryStrategy({ maxRetries: 3 })
   * });
   */
  async execute(name, command, args = [], options = {}) {
  const context = new ProcessContext({
    name,
    timeout: options.timeout,
    retryStrategy: options.retryStrategy || this.defaultRetryStrategy,
    environment: options.environment
  });

  this.processes.set(context.id, context);

  return new Promise((resolve, reject) => {
    const attemptExecution = async (retryCount) => {
    context.retryCount = retryCount;
    context.status = 'running';
    context.startTime = Date.now();

    this.emit('execute', {
      id: context.id,
      name: context.name,
      command,
      retryCount
    });

    const proc = spawn(command, args, {
      env: { ...process.env, ...context.environment }
    });

    let completed = false;
    const timeout = setTimeout(() => {
      if (!completed) {
      completed = true;
      proc.kill();
      context.status = 'timeout';
      context.endTime = Date.now();
      this.stats.timeout++;
      reject(new Error(`Process timeout after ${context.timeout}ms`));
      }
    }, context.timeout);

    proc.stdout.on('data', (data) => {
      context.stdout += data.toString();
      this.emit('stdout', { id: context.id, data: data.toString() });
    });

    proc.stderr.on('data', (data) => {
      context.stderr += data.toString();
      this.emit('stderr', { id: context.id, data: data.toString() });
    });

    proc.on('close', async (code) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      context.endTime = Date.now();
      context.exitCode = code;

      if (code === 0) {
      context.status = 'success';
      context.progress = 100;
      this.stats.success++;
      this.stats.totalDuration += context.getDuration();
      this.emit('success', context.toJSON());
      resolve(context);
      } else {
      // 检查是否可以重试
      if (context.retryStrategy.canRetry(retryCount)) {
        const delay = context.retryStrategy.getDelay(retryCount);
        this.emit('retry', {
        id: context.id,
        retryCount: retryCount + 1,
        delay
        });

        // 等待后重试
        await new Promise(r => setTimeout(r, delay));
        attemptExecution(retryCount + 1);
      } else {
        context.status = 'failed';
        this.stats.failed++;
        this.emit('failed', context.toJSON());
        reject(new Error(`Process failed with code ${code}`));
      }
      }
    });

    proc.on('error', async (err) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);

      if (context.retryStrategy.canRetry(retryCount)) {
      const delay = context.retryStrategy.getDelay(retryCount);
      await new Promise(r => setTimeout(r, delay));
      attemptExecution(retryCount + 1);
      } else {
      context.status = 'failed';
      context.endTime = Date.now();
      this.stats.failed++;
      reject(err);
      }
    });
    };

    attemptExecution(0);
  });
  }

  /**
   * 在 Xcode 中执行自动化脚本
   */
  async executeXcodeScript(scriptPath, options = {}) {
  const context = new ProcessContext({
    name: `xcode-script-${scriptPath}`,
    timeout: options.timeout || 600000, // 10 分钟
    retryStrategy: options.retryStrategy || this.defaultRetryStrategy
  });

  try {
    // 构建 AppleScript 命令
    const applescript = `
    tell application "Xcode"
      activate
      delay 1
      set scriptPath to "${scriptPath}"
      -- 这里可以添加具体的 Xcode 自动化逻辑
    end tell
    `;

    const result = await this.execute(context.name, 'osascript', ['-e', applescript], {
    timeout: context.timeout
    });

    return result;
  } catch (err) {
    throw new Error(`Xcode automation failed: ${err.message}`);
  }
  }

  /**
   * 执行多个进程（顺序执行）
   */
  async executeSequential(processes) {
  const results = [];

  for (const proc of processes) {
    try {
    const result = await this.execute(proc.name, proc.command, proc.args, proc.options);
    results.push({ status: 'success', result });
    } catch (err) {
    results.push({ status: 'failed', error: err.message });
    }
  }

  return results;
  }

  /**
   * 执行多个进程（并行执行）
   */
  async executeParallel(processes) {
  const promises = processes.map(proc =>
    this.execute(proc.name, proc.command, proc.args, proc.options)
    .then(result => ({ status: 'success', result }))
    .catch(err => ({ status: 'failed', error: err.message }))
  );

  return Promise.all(promises);
  }

  /**
   * 获取进程状态
   */
  getProcessStatus(processId) {
  const context = this.processes.get(processId);
  return context ? context.toJSON() : null;
  }

  /**
   * 获取所有进程状态
   */
  getAllProcesses() {
  const result = [];
  for (const [id, context] of this.processes) {
    result.push(context.toJSON());
  }
  return result;
  }

  /**
   * 获取统计信息
   */
  getStats() {
  const total = Math.max(1, this.stats.success + this.stats.failed + this.stats.timeout); // 实际完成的总数
  return {
    ...this.stats,
    total,
    successRate: ((this.stats.success / total) * 100).toFixed(2) + '%',
    avgDuration: this.stats.success > 0 
    ? Math.round(this.stats.totalDuration / this.stats.success) 
    : 0
  };
  }

  /**
   * 重置统计
   */
  resetStats() {
  this.stats = {
    total: 0,
    success: 0,
    failed: 0,
    timeout: 0,
    totalDuration: 0
  };
  return this;
  }

  /**
   * 清空所有进程记录
   */
  clear() {
  this.processes.clear();
  return this;
  }
}

module.exports = {
  ProcessHub,
  ProcessContext,
  RetryStrategy,
  ClipboardManager
};
