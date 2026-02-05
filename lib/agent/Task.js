/**
 * Task - 单个任务定义
 * 
 * 表示一个可执行的任务单位，包含：
 * - 任务定义（目标、参数）
 * - 执行状态（pending, running, completed, failed）
 * - 重试配置
 * - 执行结果
 */

class Task {
  constructor(options = {}) {
  this.id = options.id || Math.random().toString(36).substr(2, 9);
  this.name = options.name || 'Unnamed Task';
  this.description = options.description || '';
  
  // 执行内容
  this.type = options.type || 'action'; // action, recipe, search, metric
  this.handler = options.handler || null; // 执行函数
  this.params = options.params || {};
  
  // 状态管理
  this.status = 'pending'; // pending, running, completed, failed, cancelled
  this.priority = options.priority || 'normal'; // high, normal, low
  this.createdAt = new Date().toISOString();
  this.startedAt = null;
  this.completedAt = null;
  
  // 重试配置
  this.retries = options.retries !== undefined ? options.retries : 3;
  this.retriesRemaining = this.retries;
  this.retryDelay = options.retryDelay || 1000; // 毫秒
  
  // 超时配置
  this.timeout = options.timeout || 30000; // 毫秒
  
  // 执行结果
  this.result = null;
  this.error = null;
  this.attempts = 0;
  
  // 依赖任务
  this.dependencies = options.dependencies || []; // task IDs
  this.tags = options.tags || [];
  }

  /**
   * 标记为运行中
   */
  start() {
  this.status = 'running';
  this.startedAt = new Date().toISOString();
  this.attempts++;
  return this;
  }

  /**
   * 标记为完成
   */
  complete(result) {
  this.status = 'completed';
  this.completedAt = new Date().toISOString();
  this.result = result;
  this.error = null;
  return this;
  }

  /**
   * 标记为失败
   */
  fail(error) {
  this.error = error;
  
  if (this.retriesRemaining > 0) {
    this.retriesRemaining--;
    this.status = 'pending'; // 重新加入队列
  } else {
    this.status = 'failed';
    this.completedAt = new Date().toISOString();
  }
  return this;
  }

  /**
   * 取消任务
   */
  cancel() {
  this.status = 'cancelled';
  this.completedAt = new Date().toISOString();
  return this;
  }

  /**
   * 检查是否应该重试
   */
  shouldRetry() {
  return this.status === 'pending' && this.retriesRemaining > 0 && this.attempts > 0;
  }

  /**
   * 获取任务信息
   */
  getInfo() {
  return {
    id: this.id,
    name: this.name,
    type: this.type,
    status: this.status,
    priority: this.priority,
    attempts: this.attempts,
    retriesRemaining: this.retriesRemaining,
    createdAt: this.createdAt,
    startedAt: this.startedAt,
    completedAt: this.completedAt,
    result: this.result,
    error: this.error ? this.error.message : null
  };
  }

  /**
   * 获取执行时间（毫秒）
   */
  getDuration() {
  if (!this.startedAt || !this.completedAt) {
    return null;
  }
  return new Date(this.completedAt) - new Date(this.startedAt);
  }

  /**
   * 检查是否完成（成功或失败）
   */
  isFinished() {
  return ['completed', 'failed', 'cancelled'].includes(this.status);
  }
}

/**
 * TaskQueue - 任务队列管理
 * 
 * 功能：
 * - 任务的入队和出队
 * - 优先级排序
 * - 依赖关系检查
 * - 队列统计
 */
class TaskQueue {
  constructor(options = {}) {
  this.tasks = new Map(); // id -> Task
  this.queue = []; // 待执行队列
  this.history = []; // 已完成/失败任务
  this.maxConcurrent = options.maxConcurrent || 5;
  this.running = 0;
  this.stats = {
    total: 0,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  };
  }

  /**
   * 添加任务到队列
   */
  enqueue(task) {
  if (!(task instanceof Task)) {
    throw new Error('Invalid task');
  }

  this.tasks.set(task.id, task);
  this.queue.push(task);
  this._updateStats();
  this._sortByPriority();

  return task.id;
  }

  /**
   * 批量添加任务
   */
  enqueueBatch(tasks) {
  const ids = [];
  for (const task of tasks) {
    ids.push(this.enqueue(task));
  }
  return ids;
  }

  /**
   * 从队列获取下一个任务
   */
  dequeue() {
  if (this.queue.length === 0) {
    return null;
  }

  // 检查依赖关系
  for (let i = 0; i < this.queue.length; i++) {
    const task = this.queue[i];
    if (this._canExecute(task)) {
    return this.queue.splice(i, 1)[0];
    }
  }

  return null;
  }

  /**
   * 获取任务
   */
  getTask(taskId) {
  return this.tasks.get(taskId) || null;
  }

  /**
   * 获取所有待执行任务
   */
  getPending() {
  return this.queue.slice();
  }

  /**
   * 获取所有运行中的任务
   */
  getRunning() {
  return Array.from(this.tasks.values()).filter(t => t.status === 'running');
  }

  /**
   * 获取所有完成的任务
   */
  getCompleted() {
  return Array.from(this.tasks.values()).filter(t => t.status === 'completed');
  }

  /**
   * 获取所有失败的任务
   */
  getFailed() {
  return Array.from(this.tasks.values()).filter(t => t.status === 'failed');
  }

  /**
   * 取消任务
   */
  cancel(taskId) {
  const task = this.tasks.get(taskId);
  if (task) {
    task.cancel();
    this._updateStats();
  }
  return task;
  }

  /**
   * 清空队列
   */
  clear() {
  this.queue = [];
  this.tasks.clear();
  this._updateStats();
  return this;
  }

  /**
   * 获取队列大小
   */
  size() {
  return this.queue.length;
  }

  /**
   * 获取队列统计
   */
  getStats() {
  this._updateStats();
  return { ...this.stats };
  }

  /**
   * 获取队列信息
   */
  getInfo() {
  return {
    queueSize: this.queue.length,
    running: this.running,
    maxConcurrent: this.maxConcurrent,
    stats: this.getStats(),
    tasks: Array.from(this.tasks.values()).map(t => t.getInfo())
  };
  }

  /**
   * 内部：检查任务是否可执行
   */
  _canExecute(task) {
  // 检查依赖
  for (const depId of task.dependencies) {
    const depTask = this.tasks.get(depId);
    if (!depTask || depTask.status !== 'completed') {
    return false;
    }
  }
  return true;
  }

  /**
   * 内部：按优先级排序
   */
  _sortByPriority() {
  const priorityMap = { high: 3, normal: 2, low: 1 };
  this.queue.sort((a, b) => {
    return priorityMap[b.priority] - priorityMap[a.priority];
  });
  }

  /**
   * 内部：更新统计信息
   */
  _updateStats() {
  this.stats = {
    total: this.tasks.size,
    pending: this.queue.length,
    running: this.getRunning().length,
    completed: this.getCompleted().length,
    failed: this.getFailed().length,
    cancelled: Array.from(this.tasks.values()).filter(t => t.status === 'cancelled').length
  };
  }
}

module.exports = {
  Task,
  TaskQueue
};
